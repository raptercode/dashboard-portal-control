import test from 'node:test';
import assert from 'node:assert/strict';

import { start } from './support/server.mjs';

test('project-scoped monitor tokens expose safe deployment status without an owner session', async (t) => {
  const { app, base } = await start();
  t.after(() => app.close());
  await app.store.update((state) => {
    state.projects.push({
      name: 'Monitor app', organization: 'Tests', slug: 'monitor-app', repository: 'https://token@example.test/private.git', branch: 'main', directory: '/', port: 3211,
      healthCheckEnabled: true, healthCheckPath: '/', protocol: 'https', credentialId: 'private-credential', sync: { status: 'synced', at: new Date().toISOString(), detail: 'Source synced.' },
      environment: { keys: ['SECRET'], encryptedContent: { ciphertext: 'never-returned' } }, domains: { hosts: ['monitor.example.test'] },
      deployment: { state: 'failed', activeReleaseId: null, previousReleaseId: null, updatedAt: new Date().toISOString(), releases: [{ id: 'a'.repeat(36), revision: 'deadbeef', status: 'failed', createdAt: new Date().toISOString(), failure: 'Build failed.', failureLog: 'owner-only-build-output', health: { status: 'failed' }, events: [{ at: new Date().toISOString(), phase: 'build', status: 'failed', message: 'Build failed.' }] }] }
    });
  });
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'owner@local.test', password: 'correct-horse-battery-staple' }) });
  const session = await login.json();
  const headers = { cookie: login.headers.get('set-cookie').split(';')[0], 'content-type': 'application/json', 'x-csrf-token': session.csrfToken };
  const created = await fetch(`${base}/api/monitor-tokens`, { method: 'POST', headers, body: JSON.stringify({ name: 'ai-monitor', projectSlug: 'monitor-app' }) });
  assert.equal(created.status, 201);
  const createdBody = await created.json();
  assert.match(createdBody.token, /^dpm_/);
  assert.equal(JSON.stringify(createdBody.monitorToken).includes(createdBody.token), false);
  assert.equal((await fetch(`${base}/api/monitor/v1/projects/monitor-app/deployments`)).status, 401);
  const monitored = await fetch(`${base}/api/monitor/v1/projects/monitor-app/deployments`, { headers: { authorization: `Bearer ${createdBody.token}` } });
  assert.equal(monitored.status, 200);
  const payload = await monitored.json();
  assert.equal(payload.project.slug, 'monitor-app');
  assert.equal(JSON.stringify(payload).includes('token@example.test'), false);
  assert.equal(JSON.stringify(payload).includes('never-returned'), false);
  assert.equal(JSON.stringify(payload).includes('owner-only-build-output'), false);
  const ownerProjects = await (await fetch(`${base}/api/projects`, { headers: { cookie: headers.cookie } })).json();
  assert.equal(ownerProjects.projects[0].deployment.releases[0].failureLog, 'owner-only-build-output');
  const revoked = await fetch(`${base}/api/monitor-tokens/${createdBody.monitorToken.id}`, { method: 'DELETE', headers, body: '{}' });
  assert.equal(revoked.status, 200);
  assert.equal((await fetch(`${base}/api/monitor/v1/projects/monitor-app/deployments`, { headers: { authorization: `Bearer ${createdBody.token}` } })).status, 403);
});
