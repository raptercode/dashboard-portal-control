import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

test('public bootstrap verifies releases and uses a controlling terminal for piped/sudo installs', {
  skip: process.platform !== 'linux' ? 'Requires Linux Python 3 and POSIX PTYs; also runnable through WSL.' : false,
  timeout: 30_000
}, async () => {
  const helper = fileURLToPath(new URL('./support/bootstrap-check.py', import.meta.url));
  const { stderr } = await promisify(execFile)('python3', [helper], { timeout: 25_000 });
  assert.match(stderr, /Ran 7 tests/);
  assert.match(stderr, /\bOK\b/);
});
