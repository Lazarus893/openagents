/**
 * Hermes adapter for OpenAgents workspace.
 *
 * Bridges Nous Research's Hermes Agent CLI (https://github.com/NousResearch/hermes-agent)
 * to an OpenAgents workspace by spawning `hermes chat -q <prompt> -Q` per
 * incoming message and posting the response back to the workspace channel.
 *
 * Mirrors the Python adapter at sdk/src/openagents/adapters/hermes.py:
 * - per-channel Hermes session IDs persisted to ~/.openagents/sessions/
 * - profile auto-detection from the agent name (falls back to 'default')
 * - workspace context injection (identity + recent history + agent roster)
 * - subprocess isolation (hermes manages its own HERMES_HOME per profile)
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync, spawn } = require('child_process');

const BaseAdapter = require('./base');
const { buildOpenclawSystemPrompt } = require('./workspace-prompt');
const wsl = require('../wsl');

const IS_WINDOWS = process.platform === 'win32';
const SESSION_ID_RE = /session_id:\s*(\S+)/;
const MAX_HISTORY_ENTRIES = 12;

class HermesAdapter extends BaseAdapter {
  /**
   * @param {object} opts - BaseAdapter opts plus:
   * @param {string} [opts.hermesProfile] - explicit Hermes profile, or 'auto'
   * @param {string} [opts.hermesSource]  - `--source` label (default: 'tool')
   * @param {number} [opts.maxTurns]      - `--max-turns` value
   * @param {boolean} [opts.yolo]         - pass `--yolo` to skip prompts
   * @param {Set} [opts.disabledModules]
   */
  constructor(opts) {
    super(opts);
    this.disabledModules = opts.disabledModules || new Set();
    this.hermesProfile = this._resolveProfile(opts.hermesProfile, this.agentName);
    this.hermesSource = opts.hermesSource || 'tool';
    this.maxTurns = Number.isInteger(opts.maxTurns) ? opts.maxTurns : 60;
    this.yolo = !!opts.yolo;

    this._channelSessions = {};
    this._channelProcesses = {};
    this._sessionsFile = path.join(
      os.homedir(), '.openagents', 'sessions',
      `${this.workspaceId}_${this.agentName}_hermes.json`,
    );
    this._loadSessions();

    this._hermesBin = this._findHermesBinary();
    if (this._hermesBin) {
      this._log(`Using Hermes binary: ${this._hermesBin} (profile=${this.hermesProfile})`);
    } else if (IS_WINDOWS) {
      this._log('Warning: hermes CLI not found. Install in WSL2: curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash');
    } else {
      this._log('Warning: hermes CLI not found. Install: curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash');
    }
  }

  // ------------------------------------------------------------------
  // Binary discovery (multi-tier, matching codex/claude pattern)
  // ------------------------------------------------------------------

  _findHermesBinary() {
    const home = os.homedir();

    // Tier 1: PATH (Windows host, then macOS/Linux)
    try {
      if (IS_WINDOWS) {
        const r = execSync('where hermes 2>nul', { encoding: 'utf-8', timeout: 5000, windowsHide: true });
        const found = r.split(/\r?\n/)[0].trim();
        if (found) return found;
      } else {
        const found = execSync('which hermes', { encoding: 'utf-8', timeout: 5000 }).trim();
        if (found) return found;
      }
    } catch {}

    // Tier 2 (Windows): WSL bridge — hermes has no native Windows distribution.
    // If the user installed hermes inside WSL, return a sentinel; _runHermes
    // detects it and spawns through wsl.exe.
    if (IS_WINDOWS) {
      const wslPath = wsl.wslWhich('hermes');
      if (wslPath) return wsl.makeSentinel('hermes');
      return null;
    }

    // Tier 2 (macOS/Linux): common install locations
    const candidates = [
      path.join(home, '.local', 'bin', 'hermes'),
      '/opt/homebrew/bin/hermes',
      '/usr/local/bin/hermes',
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }

    return null;
  }

  _resolveProfile(explicit, agentName) {
    if (explicit && explicit !== '' && explicit !== 'auto') return explicit;
    // On Windows the user's hermes profiles live inside WSL, not under
    // C:\Users\<u>\.hermes — and probing across the boundary on every
    // adapter construction is too slow. Skip auto-detect; caller can set
    // hermesProfile explicitly via env config.
    if (IS_WINDOWS) return 'default';
    try {
      const profileDir = path.join(os.homedir(), '.hermes', 'profiles', agentName);
      if (fs.existsSync(profileDir)) return agentName;
    } catch {}
    return 'default';
  }

  // ------------------------------------------------------------------
  // Session persistence (per-channel Hermes session IDs)
  // ------------------------------------------------------------------

  _loadSessions() {
    try {
      if (fs.existsSync(this._sessionsFile)) {
        const data = JSON.parse(fs.readFileSync(this._sessionsFile, 'utf-8'));
        if (data && typeof data === 'object') {
          Object.assign(this._channelSessions, data);
          this._log(`Loaded ${Object.keys(data).length} Hermes session(s)`);
        }
      }
    } catch {
      this._log('Could not load Hermes sessions file, starting fresh');
    }
  }

  _saveSessions() {
    try {
      fs.mkdirSync(path.dirname(this._sessionsFile), { recursive: true });
      fs.writeFileSync(this._sessionsFile, JSON.stringify(this._channelSessions));
    } catch {}
  }

  // ------------------------------------------------------------------
  // Prompt assembly
  // ------------------------------------------------------------------

  async _getAgentsText() {
    try {
      const agents = await this.client.getAgents(this.workspaceId, this.token);
      if (!Array.isArray(agents) || agents.length === 0) return '';
      const lines = agents
        .map((a) => {
          const name = a.agentName || a.agent_name || a.name;
          if (!name) return null;
          const role = a.role || 'member';
          const status = a.status || 'unknown';
          return `- ${name} (${role}, ${status})`;
        })
        .filter(Boolean);
      return lines.length ? `## Available Workspace Agents\n${lines.join('\n')}` : '';
    } catch {
      return '';
    }
  }

  async _getRecentHistoryText(channelName) {
    try {
      const messages = await this.client.pollMessages({
        workspaceId: this.workspaceId,
        channelName,
        token: this.token,
        limit: MAX_HISTORY_ENTRIES,
      });
      if (!Array.isArray(messages) || messages.length === 0) return '';
      const lines = messages
        .filter((m) => m.messageType !== 'status')
        .map((m) => {
          const sender = m.senderName || m.senderType || 'unknown';
          const content = (m.content || '').trim();
          if (!content) return null;
          return `- ${sender}: ${content.slice(0, 400)}`;
        })
        .filter(Boolean);
      return lines.length ? `## Recent Workspace Messages\n${lines.join('\n')}` : '';
    } catch {
      return '';
    }
  }

  async _buildContextPrefix(channelName) {
    const parts = [
      buildOpenclawSystemPrompt({
        agentName: this.agentName,
        workspaceId: this.workspaceId,
        channelName,
        endpoint: this.endpoint,
        token: this.token,
        mode: this._mode,
        disabledModules: this.disabledModules,
      }),
      '\n## OpenAgents-specific Rules',
      '- Your final text response is posted back to the workspace automatically.',
      '- If you need to ask the user something, ask in normal text. Do not try to open an interactive prompt.',
      '- Do not reveal secrets, tokens, raw auth headers, or internal command lines.',
      '- Keep status concise. Focus on useful output over theatre.',
    ];

    const [agentsText, historyText] = await Promise.all([
      this._getAgentsText(),
      this._getRecentHistoryText(channelName),
    ]);
    if (agentsText) parts.push('\n' + agentsText);
    if (historyText) parts.push('\n' + historyText);
    return parts.join('\n').trim();
  }

  // ------------------------------------------------------------------
  // Output parsing
  // ------------------------------------------------------------------

  _parseHermesOutput(raw) {
    let sessionId = null;
    let body = raw;

    const m = SESSION_ID_RE.exec(body);
    if (m) {
      sessionId = m[1];
      body = body.replace(SESSION_ID_RE, '');
    }

    const lines = [];
    for (const line of body.split(/\r?\n/)) {
      const stripped = line.trim();
      if (!stripped) continue;
      if (stripped.startsWith('↻ Resumed session ')) continue;
      lines.push(line);
    }
    return { text: lines.join('\n').trim(), sessionId };
  }

  // ------------------------------------------------------------------
  // Subprocess lifecycle
  // ------------------------------------------------------------------

  _buildHermesCmd(prompt, resumeSessionId) {
    if (!this._hermesBin) {
      const hint = IS_WINDOWS
        ? 'Install hermes inside WSL2: curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash'
        : 'Install with: curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash';
      throw new Error(`hermes CLI not found. ${hint}`);
    }
    const args = [];
    if (this.hermesProfile && this.hermesProfile !== 'default') {
      args.push('-p', this.hermesProfile);
    }
    args.push(
      'chat',
      '-q', prompt,
      '-Q',
      '--source', this.hermesSource,
      '--max-turns', String(this.maxTurns),
    );
    if (resumeSessionId) args.push('--resume', resumeSessionId);
    if (this.yolo) args.push('--yolo');
    return args;
  }

  async _runHermes(prompt, channelName) {
    const resumeId = this._channelSessions[channelName];
    const args = this._buildHermesCmd(prompt, resumeId);
    const viaWsl = wsl.isSentinel(this._hermesBin);
    this._log(`Running hermes (profile=${this.hermesProfile}, channel=${channelName}, resume=${!!resumeId}${viaWsl ? ', via=wsl' : ''})`);

    let cmd;
    let cmdArgs;
    let env;
    if (viaWsl) {
      cmd = wsl.WSL_BINARY;
      cmdArgs = wsl.wslArgs('hermes', args);
      env = wsl.buildWslEnv(this.agentEnv || process.env);
    } else {
      cmd = this._hermesBin;
      cmdArgs = args;
      env = { ...(this.agentEnv || process.env) };
    }

    const proc = spawn(cmd, cmdArgs, {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      // wsl.exe child should not be in its own process group — we kill it via
      // taskkill /T which walks the Win32 process tree.
      detached: !IS_WINDOWS,
      windowsHide: IS_WINDOWS,
    });
    this._channelProcesses[channelName] = proc;

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString('utf-8'); });
    proc.stderr.on('data', (d) => { stderr += d.toString('utf-8'); });

    const exitCode = await new Promise((resolve) => {
      proc.on('exit', resolve);
      proc.on('error', () => resolve(-1));
    });
    delete this._channelProcesses[channelName];

    if (exitCode !== 0) {
      if (resumeId) {
        // Resume may have failed because the session was deleted — drop it and retry fresh
        this._log(`Hermes resume failed (code=${exitCode}), retrying without resume`);
        delete this._channelSessions[channelName];
        this._saveSessions();
        return this._runHermes(prompt, channelName);
      }
      const detail = (stderr || stdout).trim().slice(0, 600);
      throw new Error(`hermes exited with code ${exitCode}: ${detail}`);
    }

    const { text, sessionId } = this._parseHermesOutput(stdout);
    if (sessionId) {
      this._channelSessions[channelName] = sessionId;
      this._saveSessions();
    }
    return text;
  }

  async _stopProcess(proc) {
    if (!proc || proc.exitCode !== null) return;
    try {
      if (IS_WINDOWS) {
        try { execSync(`taskkill /F /T /PID ${proc.pid}`, { timeout: 5000, windowsHide: true }); } catch {}
        // When we spawned through wsl.exe, taskkill kills the Windows-side
        // wsl.exe but the Linux-side hermes is sometimes left orphaned for
        // a few seconds. Best-effort cleanup — silent on failure.
        if (wsl.isSentinel(this._hermesBin)) {
          try {
            execSync(`${wsl.WSL_BINARY} -e pkill -TERM -f "^hermes( |$)"`, {
              timeout: 5000,
              stdio: 'ignore',
              windowsHide: true,
            });
          } catch {}
        }
      } else {
        try { process.kill(-proc.pid, 'SIGTERM'); } catch {
          proc.kill('SIGTERM');
        }
        await new Promise((resolve) => {
          const timeout = setTimeout(() => {
            try { process.kill(-proc.pid, 'SIGKILL'); } catch {
              proc.kill('SIGKILL');
            }
            resolve();
          }, 5000);
          proc.on('exit', () => { clearTimeout(timeout); resolve(); });
        });
      }
    } catch {}
  }

  async _onControlAction(action, _payload) {
    if (action === 'stop') {
      for (const [channel, proc] of Object.entries(this._channelProcesses)) {
        await this._stopProcess(proc);
        delete this._channelProcesses[channel];
        try { await this.sendStatus(channel, 'Execution stopped by user'); } catch {}
      }
    }
  }

  // ------------------------------------------------------------------
  // Message handler
  // ------------------------------------------------------------------

  async _handleMessage(msg) {
    const content = (msg.content || '').trim();
    if (!content) return;

    const msgChannel = msg.sessionId || this.channelName;
    const sender = msg.senderName || msg.senderType || 'user';
    this._log(`Processing workspace message from ${sender} in ${msgChannel}`);

    await this._autoTitleChannel(msgChannel, content);
    await this.sendStatus(msgChannel, 'thinking...');

    try {
      const context = await this._buildContextPrefix(msgChannel);
      const prompt = context ? `${context}\n\n---\n\nUser message:\n${content}` : content;
      const responseText = await this._runHermes(prompt, msgChannel);

      if (responseText) {
        await this.sendResponse(msgChannel, responseText);
      } else {
        await this.sendResponse(msgChannel, 'No response generated. Please try again.');
      }
    } catch (e) {
      this._log(`Hermes adapter error: ${e.message}`);
      await this.sendError(msgChannel, `Error processing message: ${e.message}`);
    }
  }
}

module.exports = HermesAdapter;
