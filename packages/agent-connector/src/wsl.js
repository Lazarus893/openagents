/**
 * WSL bridging helpers for Windows.
 *
 * Lets the launcher detect and invoke Linux-side binaries that the user
 * has installed inside WSL2. Used today by the hermes agent (which has
 * no native Windows distribution); other agents can opt in via the
 * registry's `install.windows_strategy: wsl` flag.
 *
 * On non-Windows platforms every function here is a no-op / returns null,
 * so callers can require this module unconditionally.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const IS_WINDOWS = process.platform === 'win32';
const WSL_BINARY = 'wsl.exe';

// Probe / lookup timeouts (ms). Kept tight so a slow or cold WSL distro
// can't stall catalog walks (CLI search, install info polling, etc.) —
// if WSL really is that slow we fall back to "not installed" and the
// user can refresh after WSL warms up.
const PROBE_TIMEOUT_MS = 2000;
const WHICH_TIMEOUT_MS = 3000;

// Sentinel used by adapters: when binary discovery yields one of these, the
// adapter knows to spawn through wsl.exe instead of executing the path
// directly. Using a fixed prefix keeps it grep-able and easy to test.
const WSL_SENTINEL_PREFIX = 'wsl:';

// Default whitelist of env vars to forward into WSL via WSLENV.
// Keep this conservative — anything matched here is shared across the
// Win/Linux boundary, so we limit it to things hermes actually needs:
// API keys, tokens, and hermes-specific tuning vars.
const DEFAULT_PASS_KEY_PATTERNS = [/_API_KEY$/, /_TOKEN$/, /^HERMES_/];

let _wslAvailableCache = null;
let _wslPathCache = null;

/**
 * Cheap fs check for wsl.exe in System32. Lets us skip the slow `wsl -e true`
 * probe entirely on hosts where WSL was never installed — a single fs.stat
 * is microseconds vs. multiple seconds for cold-starting the WSL VM.
 */
function _wslExists() {
  if (!IS_WINDOWS) return false;
  if (_wslPathCache !== null) return _wslPathCache !== '';
  const sysRoot = process.env.SystemRoot || 'C:\\Windows';
  const candidates = [
    path.join(sysRoot, 'System32', 'wsl.exe'),
    path.join(sysRoot, 'Sysnative', 'wsl.exe'), // 32-bit Node on 64-bit Windows
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        _wslPathCache = p;
        return true;
      }
    } catch {}
  }
  _wslPathCache = '';
  return false;
}

/**
 * Return true if `wsl.exe` is on PATH and a default distro responds.
 * Caches the result for the lifetime of the process — a Windows host
 * doesn't gain or lose WSL between launcher invocations.
 *
 * Skips the subprocess probe entirely if wsl.exe isn't even installed.
 * Allows opt-out via OPENAGENTS_DISABLE_WSL=1 (mainly for tests / CI).
 */
function isWslAvailable() {
  if (!IS_WINDOWS) return false;
  if (process.env.OPENAGENTS_DISABLE_WSL === '1') return false;
  if (_wslAvailableCache !== null) return _wslAvailableCache;
  if (!_wslExists()) {
    _wslAvailableCache = false;
    return false;
  }
  try {
    execSync(`${WSL_BINARY} -e true`, {
      stdio: 'ignore',
      timeout: PROBE_TIMEOUT_MS,
      windowsHide: true,
    });
    _wslAvailableCache = true;
  } catch {
    _wslAvailableCache = false;
  }
  return _wslAvailableCache;
}

/**
 * Run `wsl which <binary>` and return the Linux-side path, or null if
 * not found / WSL unavailable. We swallow stderr so "no hermes in (...)"
 * doesn't leak into launcher logs.
 */
function wslWhich(binary) {
  if (!IS_WINDOWS || !binary) return null;
  if (!isWslAvailable()) return null;
  try {
    const out = execSync(`${WSL_BINARY} -e which ${binary}`, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: WHICH_TIMEOUT_MS,
      windowsHide: true,
    }).trim();
    return out ? out.split(/\r?\n/)[0] : null;
  } catch {
    return null;
  }
}

/**
 * Format a sentinel string the adapter stores in place of a real path
 * when it has detected the binary lives inside WSL.
 */
function makeSentinel(binary) {
  return `${WSL_SENTINEL_PREFIX}${binary}`;
}

/**
 * True if `value` is a sentinel produced by makeSentinel().
 */
function isSentinel(value) {
  return typeof value === 'string' && value.startsWith(WSL_SENTINEL_PREFIX);
}

/**
 * Build the env object passed to spawn() when launching a binary via
 * wsl.exe. Adds WSLENV entries for any env keys matching the whitelist
 * so the Linux side can see them, and forces WSL_UTF8 so stdout decodes
 * cleanly under Node.
 *
 * Existing WSLENV entries are preserved and de-duplicated.
 *
 * @param {object} env - source env (typically agentEnv or process.env)
 * @param {object} [options]
 * @param {Array<RegExp|string>} [options.passKeys] - patterns of keys to forward
 * @returns {object} new env (does not mutate input)
 */
function buildWslEnv(env, options = {}) {
  const result = { ...(env || {}) };
  const patterns = options.passKeys || DEFAULT_PASS_KEY_PATTERNS;

  const matched = Object.keys(result).filter((key) => {
    if (key === 'WSLENV' || key === 'WSL_UTF8') return false;
    return patterns.some((p) => (p instanceof RegExp ? p.test(key) : p === key));
  });

  // Preserve any existing WSLENV entries, de-dupe against new ones
  const existingRaw = result.WSLENV ? String(result.WSLENV).split(':').filter(Boolean) : [];
  const existingNames = new Set(existingRaw.map((entry) => entry.split('/')[0]));
  const additions = matched
    .filter((key) => !existingNames.has(key))
    .map((key) => `${key}/u`);

  const merged = [...existingRaw, ...additions];
  if (merged.length > 0) {
    result.WSLENV = merged.join(':');
  }
  // Force UTF-8 stdout — without this wsl.exe on some Windows builds emits
  // UTF-16LE which Node decodes as garbage when stdio: 'pipe'.
  result.WSL_UTF8 = '1';

  return result;
}

/**
 * Build argv for spawn('wsl.exe', argv) that runs `<binary> <...args>`
 * inside the default distro. Uses `-e` so wsl.exe forwards argv directly
 * to execvp without an intermediate shell — critical when args contain
 * shell metachars (prompts often do).
 *
 * @param {string} binary - Linux binary name (e.g. 'hermes')
 * @param {string[]} args - argv tail
 * @returns {string[]} argv for spawn('wsl.exe', argv)
 */
function wslArgs(binary, args) {
  return ['-e', binary, ...(args || [])];
}

/**
 * Reset cached probes. For tests.
 */
function _resetCache() {
  _wslAvailableCache = null;
  _wslPathCache = null;
}

module.exports = {
  WSL_BINARY,
  WSL_SENTINEL_PREFIX,
  DEFAULT_PASS_KEY_PATTERNS,
  isWslAvailable,
  wslWhich,
  makeSentinel,
  isSentinel,
  buildWslEnv,
  wslArgs,
  _resetCache,
};
