'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const wsl = require('../src/wsl');

const IS_WINDOWS = process.platform === 'win32';

describe('wsl helpers', () => {
  describe('makeSentinel / isSentinel', () => {
    it('round-trips a binary name', () => {
      const s = wsl.makeSentinel('hermes');
      assert.equal(s, 'wsl:hermes');
      assert.equal(wsl.isSentinel(s), true);
    });

    it('isSentinel is false for real paths', () => {
      assert.equal(wsl.isSentinel('/usr/local/bin/hermes'), false);
      assert.equal(wsl.isSentinel('C:\\Program Files\\hermes.exe'), false);
    });

    it('isSentinel handles null / undefined / non-strings', () => {
      assert.equal(wsl.isSentinel(null), false);
      assert.equal(wsl.isSentinel(undefined), false);
      assert.equal(wsl.isSentinel(42), false);
      assert.equal(wsl.isSentinel({}), false);
    });
  });

  describe('wslArgs', () => {
    it('produces [-e, binary, ...args]', () => {
      const argv = wsl.wslArgs('hermes', ['chat', '-q', 'hello']);
      assert.deepEqual(argv, ['-e', 'hermes', 'chat', '-q', 'hello']);
    });

    it('handles empty args', () => {
      assert.deepEqual(wsl.wslArgs('hermes', []), ['-e', 'hermes']);
      assert.deepEqual(wsl.wslArgs('hermes'), ['-e', 'hermes']);
    });

    it('preserves args with shell metacharacters as-is (no quoting)', () => {
      // The whole point of -e is bypassing shell parsing — argv is forwarded
      // to execvp directly, so we MUST NOT quote or escape on the way in.
      const prompt = 'echo $HOME `pwd` "quoted"';
      const argv = wsl.wslArgs('hermes', ['-q', prompt]);
      assert.equal(argv[3], prompt);
    });
  });

  describe('buildWslEnv', () => {
    it('forwards default whitelisted keys via WSLENV', () => {
      const env = wsl.buildWslEnv({
        OPENAI_API_KEY: 'sk-x',
        ANTHROPIC_API_KEY: 'sk-y',
        GITHUB_TOKEN: 'ghp_z',
        HERMES_PROFILE: 'dev',
        PATH: '/usr/bin',
        HOME: '/home/x',
      });
      const entries = env.WSLENV.split(':');
      assert.ok(entries.includes('OPENAI_API_KEY/u'), `missing OPENAI_API_KEY: ${env.WSLENV}`);
      assert.ok(entries.includes('ANTHROPIC_API_KEY/u'));
      assert.ok(entries.includes('GITHUB_TOKEN/u'));
      assert.ok(entries.includes('HERMES_PROFILE/u'));
      // Non-whitelisted keys must NOT leak across the boundary
      assert.ok(!env.WSLENV.includes('PATH'));
      assert.ok(!env.WSLENV.includes('HOME'));
    });

    it('always sets WSL_UTF8=1', () => {
      const env = wsl.buildWslEnv({ FOO: 'bar' });
      assert.equal(env.WSL_UTF8, '1');
    });

    it('preserves existing WSLENV entries and dedupes', () => {
      const env = wsl.buildWslEnv({
        WSLENV: 'EXISTING_VAR/u:OPENAI_API_KEY/u',
        OPENAI_API_KEY: 'sk-x',
        GITHUB_TOKEN: 'ghp_z',
      });
      const entries = env.WSLENV.split(':');
      // existing entries kept
      assert.ok(entries.includes('EXISTING_VAR/u'));
      assert.ok(entries.includes('OPENAI_API_KEY/u'));
      // new key appended
      assert.ok(entries.includes('GITHUB_TOKEN/u'));
      // OPENAI_API_KEY appears exactly once (no duplicate)
      const occurrences = entries.filter((e) => e === 'OPENAI_API_KEY/u').length;
      assert.equal(occurrences, 1);
    });

    it('does not mutate input env', () => {
      const input = { OPENAI_API_KEY: 'sk-x' };
      const before = JSON.stringify(input);
      wsl.buildWslEnv(input);
      assert.equal(JSON.stringify(input), before);
    });

    it('accepts custom passKeys (regex)', () => {
      const env = wsl.buildWslEnv(
        { MY_THING: 'foo', OPENAI_API_KEY: 'sk-x' },
        { passKeys: [/^MY_/] },
      );
      assert.ok(env.WSLENV.includes('MY_THING/u'));
      // Custom whitelist replaces default — API_KEY no longer leaks
      assert.ok(!env.WSLENV.includes('OPENAI_API_KEY'));
    });

    it('accepts custom passKeys (string exact-match)', () => {
      const env = wsl.buildWslEnv(
        { CUSTOM_VAR: '1', OTHER: '2' },
        { passKeys: ['CUSTOM_VAR'] },
      );
      assert.ok(env.WSLENV.includes('CUSTOM_VAR/u'));
      assert.ok(!env.WSLENV.includes('OTHER'));
    });

    it('skips WSLENV/WSL_UTF8 from being added to themselves', () => {
      const env = wsl.buildWslEnv({}, { passKeys: [/^WSL/] });
      // Must not add WSLENV/u or WSL_UTF8/u entries (would be infinite recursion)
      if (env.WSLENV) {
        assert.ok(!env.WSLENV.includes('WSLENV/u'));
        assert.ok(!env.WSLENV.includes('WSL_UTF8/u'));
      }
    });

    it('handles null/undefined env', () => {
      const env = wsl.buildWslEnv(null);
      assert.equal(env.WSL_UTF8, '1');
    });
  });

  describe('isWslAvailable / wslWhich (non-Windows)', () => {
    it('isWslAvailable returns false on non-Windows', () => {
      if (IS_WINDOWS) return;
      wsl._resetCache();
      assert.equal(wsl.isWslAvailable(), false);
    });

    it('wslWhich returns null on non-Windows', () => {
      if (IS_WINDOWS) return;
      assert.equal(wsl.wslWhich('hermes'), null);
    });

    it('wslWhich returns null for falsy binary', () => {
      assert.equal(wsl.wslWhich(''), null);
      assert.equal(wsl.wslWhich(null), null);
      assert.equal(wsl.wslWhich(undefined), null);
    });
  });
});
