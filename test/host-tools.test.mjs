import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState } from '../src/core.mjs';
import { probeHostTools } from '../src/server.mjs';

test('host tool inventory probes executables instead of trusting persisted state', async () => {
  const stored = Object.values(createInitialState().tools);
  const calls = [];
  const tools = await probeHostTools(stored, async (command, args) => {
    calls.push([command, args.join(' ')]);
    if (command === '/usr/bin/certbot') return { ok: false, output: '' };
    return { ok: true, output: `${command} ${args.join(' ')} version` };
  });
  assert.equal(tools.find((tool) => tool.id === 'nginx').status, 'Installed');
  assert.equal(tools.find((tool) => tool.id === 'git').status, 'Installed');
  assert.equal(tools.find((tool) => tool.id === 'docker').status, 'Installed');
  assert.equal(tools.find((tool) => tool.id === 'certbot').status, 'Missing');
  assert.equal(tools.every((tool) => tool.simulated === false), true);
  assert.deepEqual(calls.find(([command]) => command === '/usr/sbin/nginx'), ['/usr/sbin/nginx', '-v']);
  assert.equal(calls.filter(([command]) => command === '/usr/bin/docker').length, 2);
});
