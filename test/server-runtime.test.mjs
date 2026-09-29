import test from 'node:test';
import assert from 'node:assert/strict';

import { start } from './support/server.mjs';

test('an active project reports a down runtime without exposing host diagnostics', async (t) => {
  const previousSocket = process.env.HOSTMGR_DEPLOY_HELPER_SOCKET;
  process.env.HOSTMGR_DEPLOY_HELPER_SOCKET = '/tmp/test-project-runtime.sock';
  t.after(() => {
    if (previousSocket === undefined) delete process.env.HOSTMGR_DEPLOY_HELPER_SOCKET;
    else process.env.HOSTMGR_DEPLOY_HELPER_SOCKET = previousSocket;
  });
  const { app, base } = await start({ mode: 'host', projectRuntimeProbe: async () => ({ state: 'down' }) });
  t.after(() => app.close());
  await app.store.update((state) => {
    state.projects.push({
      name: 'Down app', organization: 'Tests', slug: 'down-app', repository: 'https://example.test/down.git', branch: 'main', directory: '/', port: 3212,
      healthCheckEnabled: true, healthCheckPath: '/', protocol: 'https', sync: { status: 'synced', at: new Date().toISOString(), detail: 'Source synced.' },
      environment: { keys: [], encryptedContent: null }, domains: { hosts: ['down.example.test'] },
      deployment: { state: 'active', activeReleaseId: 'a'.repeat(36), previousReleaseId: null, updatedAt: new Date().toISOString(), releases: [{ id: 'a'.repeat(36), revision: 'release-a', status: 'active', createdAt: new Date().toISOString(), health: { status: 'passed' }, events: [] }] }
    });
  });
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'owner@local.test', password: 'correct-horse-battery-staple' }) });
  const payload = await (await fetch(`${base}/api/projects`, { headers: { cookie: login.headers.get('set-cookie').split(';')[0] } })).json();
  assert.equal(payload.projects[0].runtimeStatus.state, 'down');
  assert.equal(JSON.stringify(payload.projects[0].runtimeStatus).includes('diagnostic'), false);
});
