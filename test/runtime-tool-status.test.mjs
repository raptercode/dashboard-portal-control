import test from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS, createInitialState } from '../src/core.mjs';
import { probeHostTools } from '../src/server.mjs';

test('Go and Python venv appear as non-installable runtime tools', () => {
  const state = createInitialState();
  assert.equal(TOOLS.go.installable, false);
  assert.equal(TOOLS.python.installable, false);
  assert.equal(TOOLS.php.installable, false);
  assert.equal(state.tools.go.status, 'Missing');
  assert.equal(state.tools.python.status, 'Missing');
  assert.equal(state.tools.php.status, 'Missing');
});

test('host doctor reports Go and Python venv availability from fixed probes', async () => {
  const calls = [];
  const tools = [{ id: 'go', ...TOOLS.go }, { id: 'python', ...TOOLS.python }, { id: 'php', ...TOOLS.php }];
  const report = await probeHostTools(tools, async (command, args) => {
    calls.push([command, args]);
    if (command === '/usr/local/bin/go') return { ok: true, output: 'go version go1.27.1 linux/amd64' };
    if (command === '/usr/bin/php') return { ok: true, output: 'PHP 8.4.5' };
    if (command === '/usr/local/bin/composer') return { ok: true, output: 'Composer 2.8.4' };
    if (args[0] === '--version') return { ok: true, output: 'Python 3.13.5' };
    return { ok: true, output: '' };
  });
  assert.deepEqual(calls, [
    ['/usr/local/bin/go', ['version']],
    ['/usr/bin/python3', ['--version']],
    ['/usr/bin/python3', ['-c', 'import venv']],
    ['/usr/bin/php', ['-v']],
    ['/usr/local/bin/composer', ['--version']]
  ]);
  assert.equal(report[0].status, 'Installed');
  assert.equal(report[0].version, 'go version go1.27.1 linux/amd64');
  assert.equal(report[1].status, 'Installed');
  assert.equal(report[1].version, 'Python 3.13.5');
  assert.equal(report[2].status, 'Installed');
  assert.match(report[2].version, /PHP 8\.4\.5/);
});

test('host doctor treats Python without venv as missing', async () => {
  const [python] = await probeHostTools([{ id: 'python', ...TOOLS.python }], async (_command, args) => ({ ok: args[0] === '--version', output: 'Python 3.13.5' }));
  assert.equal(python.status, 'Missing');
  assert.equal(python.version, null);
});
