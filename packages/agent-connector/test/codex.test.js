'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const CodexAdapter = require('../src/adapters/codex');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-codex-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function createAdapter(opts = {}) {
  const adapter = Object.create(CodexAdapter.prototype);
  Object.assign(adapter, {
    agentEnv: process.env,
    workingDir: undefined,
    _codexBin: 'codex',
    _directApiKey: '',
    _directBaseUrl: '',
    _directModel: '',
    _channelThreads: {},
    _channelProcesses: {},
    _log: () => {},
    _saveSessions: () => {},
    ...opts,
  });
  return adapter;
}

describe('CodexAdapter', () => {
  it('passes subprocess prompts via stdin instead of argv', async () => {
    const adapter = createAdapter();
    adapter._buildSystemContext = () => 'SYSTEM CONTEXT';

    let captured;
    let response = null;
    adapter._spawnCodex = async (cmd, _env, msgChannel, prompt) => {
      captured = { cmd, msgChannel, prompt };
      return { responseText: 'ok', exitCode: 0, stderr: '' };
    };
    adapter.sendResponse = async (_channel, text) => { response = text; };

    await adapter._handleViaSubprocess('who are you', 'channel-de77435e');

    assert.equal(response, 'ok');
    assert.equal(captured.msgChannel, 'channel-de77435e');
    assert.match(captured.prompt, /SYSTEM CONTEXT/);
    assert.match(captured.prompt, /User message:\nwho are you/);
    assert.ok(!captured.cmd.some((arg) => arg.includes('who are you')));
    assert.ok(!captured.cmd.some((arg) => arg.includes('SYSTEM CONTEXT')));
  });

  it('writes the prompt to codex stdin', async () => {
    const scriptPath = path.join(tmpDir, 'fake-codex.js');
    fs.writeFileSync(scriptPath, `
'use strict';

let stdin = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk) => { stdin += chunk; });
process.stdin.on('end', () => {
  const payload = {
    argv: process.argv.slice(2),
    stdin,
  };
  process.stdout.write(JSON.stringify({
    type: 'item.completed',
    item: { type: 'agent_message', text: JSON.stringify(payload) },
  }) + '\\n');
});
`, 'utf-8');

    const adapter = createAdapter({ workingDir: tmpDir });
    adapter.sendThinking = async () => {};

    const prompt = 'who are you\nwith multiple words';
    const result = await adapter._spawnCodex(
      [process.execPath, scriptPath, 'exec', '--json'],
      process.env,
      'channel-de77435e',
      prompt
    );

    const payload = JSON.parse(result.responseText);
    assert.deepEqual(payload.argv, ['exec', '--json']);
    assert.equal(payload.stdin, prompt);
  });
});
