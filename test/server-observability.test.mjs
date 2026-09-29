import test from 'node:test';
import assert from 'node:assert/strict';

import { start } from './support/server.mjs';

test('project logs require a session, simulate output in demo mode, and degrade cleanly without a host helper', async (t) => {
  const { app, base } = await start();
  t.after(() => app.close());
  await app.store.update((state) => {
    state.projects.push({
      name: 'Logs app', organization: 'Tests', slug: 'logs-app', repository: 'https://github.com/example/logs.git', branch: 'main', directory: '/', port: 3220,
      healthCheckEnabled: true, healthCheckPath: '/', protocol: 'https', credentialId: null, sshKeyId: null, buildScript: null, startScript: 'start',
      sync: { status: 'synced', at: new Date().toISOString(), detail: 'Seeded for log test.' },
      environment: { keys: ['NODE_ENV'], encryptedContent: { algorithm: 'aes-256-gcm', iv: 'AAAAAAAAAAAAAAAA', tag: 'AAAAAAAAAAAAAAAAAAAAAA==', ciphertext: 'AA==' } },
      domains: { hosts: [], updatedAt: new Date().toISOString(), syncedAt: null },
      deployment: { state: 'idle', activeReleaseId: null, previousReleaseId: null, releases: [], updatedAt: new Date().toISOString() }
    });
  });
  const unauthenticated = await fetch(`${base}/api/projects/logs-app/logs`);
  assert.equal(unauthenticated.status, 401);
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'owner@local.test', password: 'correct-horse-battery-staple' }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const missing = await fetch(`${base}/api/projects/no-such-app/logs`, { headers: { cookie } });
  assert.equal(missing.status, 404);
  const demo = await fetch(`${base}/api/projects/logs-app/logs`, { headers: { cookie } });
  assert.equal(demo.status, 200);
  const demoBody = await demo.json();
  assert.equal(demoBody.unit, 'hostmgr-project-logs-app.service');
  assert.equal(demoBody.simulated, true);
  assert.equal(demoBody.available, true);
  assert.ok(demoBody.lines.length > 0);
});

test('project logs report a clear notice on a host without a configured deployment helper', async (t) => {
  const { app, base } = await start({ mode: 'host' });
  t.after(() => app.close());
  await app.store.update((state) => {
    state.projects.push({
      name: 'Host logs app', organization: 'Tests', slug: 'host-logs-app', repository: 'https://github.com/example/host-logs.git', branch: 'main', directory: '/', port: 3221,
      healthCheckEnabled: true, healthCheckPath: '/', protocol: 'https', credentialId: null, sshKeyId: null, buildScript: null, startScript: 'start',
      sync: { status: 'synced', at: new Date().toISOString(), detail: 'Seeded for host log test.' },
      environment: { keys: ['NODE_ENV'], encryptedContent: { algorithm: 'aes-256-gcm', iv: 'AAAAAAAAAAAAAAAA', tag: 'AAAAAAAAAAAAAAAAAAAAAA==', ciphertext: 'AA==' } },
      domains: { hosts: [], updatedAt: new Date().toISOString(), syncedAt: null },
      deployment: { state: 'idle', activeReleaseId: null, previousReleaseId: null, releases: [], updatedAt: new Date().toISOString() }
    });
  });
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'owner@local.test', password: 'correct-horse-battery-staple' }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const response = await fetch(`${base}/api/projects/host-logs-app/logs`, { headers: { cookie } });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.unit, 'hostmgr-project-host-logs-app.service');
  assert.equal(body.simulated, false);
  assert.equal(body.available, false);
  assert.match(body.notice, /helper/);
  assert.deepEqual(body.lines, []);
});

test('project domains are validated, persisted, and do not expose deployment secrets', async (t) => {
  const { app, base } = await start();
  t.after(() => app.close());
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'owner@local.test', password: 'correct-horse-battery-staple' }) });
  const session = await login.json();
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const headers = { cookie, 'content-type': 'application/json', 'x-csrf-token': session.csrfToken };
  await fetch(`${base}/api/tools/git/install`, { method: 'POST', headers, body: JSON.stringify({ confirm: true }) });
  await fetch(`${base}/api/git-config`, { method: 'POST', headers, body: JSON.stringify({ name: 'Demo Owner', email: 'owner@example.test' }) });
  await fetch(`${base}/api/projects/sync`, { method: 'POST', headers, body: JSON.stringify({ name: 'Domain app', slug: 'domain-app', repository: 'https://github.com/example/domain.git', branch: 'main', port: 3000, protocol: 'https' }) });
  const response = await fetch(`${base}/api/projects/domain-app/domains`, { method: 'POST', headers, body: JSON.stringify({ domains: ['App.Example.test', 'www.example.test'] }) });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).project.domains.hosts, ['app.example.test', 'www.example.test']);
  const removed = await fetch(`${base}/api/projects/domain-app/domains`, { method: 'POST', headers, body: JSON.stringify({ domains: [] }) });
  assert.equal(removed.status, 200);
  assert.deepEqual((await removed.json()).project.domains.hosts, []);
  const rejected = await fetch(`${base}/api/projects/domain-app/domains`, { method: 'POST', headers, body: JSON.stringify({ domains: ['invalid host'] }) });
  assert.equal(rejected.status, 400);
});

test('domain DNS check returns structured soft-check status and rejects invalid hostnames', async (t) => {
  const { app, base } = await start({
    domainDnsCheck: async (hostname) => {
      if (hostname === 'ok.example.test') return { hostname, resolved: ['203.0.113.9'], expected: ['203.0.113.9'], matched: true, status: 'ok' };
      if (hostname === 'proxied.example.test') return { hostname, resolved: ['104.21.51.31'], expected: ['203.0.113.9'], matched: false, status: 'proxied', proxy: { detected: true, provider: 'Cloudflare' }, detail: 'DNS is routed through Cloudflare Proxy.' };
      if (hostname === 'boom.example.test') throw new Error('resolver exploded');
      return { hostname, resolved: [], expected: ['203.0.113.9'], matched: false, status: 'unresolved' };
    },
  });
  t.after(() => app.close());
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'owner@local.test', password: 'correct-horse-battery-staple' }) });
  const session = await login.json();
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const headers = { cookie, 'content-type': 'application/json', 'x-csrf-token': session.csrfToken };
  await fetch(`${base}/api/tools/git/install`, { method: 'POST', headers, body: JSON.stringify({ confirm: true }) });
  await fetch(`${base}/api/git-config`, { method: 'POST', headers, body: JSON.stringify({ name: 'Demo Owner', email: 'owner@example.test' }) });
  await fetch(`${base}/api/projects/sync`, { method: 'POST', headers, body: JSON.stringify({ name: 'Check app', slug: 'check-app', repository: 'https://github.com/example/check.git', branch: 'main', port: 3000, protocol: 'https' }) });
  const ok = await fetch(`${base}/api/projects/check-app/domains/check`, { method: 'POST', headers, body: JSON.stringify({ hostname: 'ok.example.test' }) });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { hostname: 'ok.example.test', resolved: ['203.0.113.9'], expected: ['203.0.113.9'], matched: true, status: 'ok' });
  const proxied = await fetch(`${base}/api/projects/check-app/domains/check`, { method: 'POST', headers, body: JSON.stringify({ hostname: 'proxied.example.test' }) });
  assert.equal(proxied.status, 200);
  assert.deepEqual(await proxied.json(), { hostname: 'proxied.example.test', resolved: ['104.21.51.31'], expected: ['203.0.113.9'], matched: false, status: 'proxied', detail: 'DNS is routed through Cloudflare Proxy.', proxy: { detected: true, provider: 'Cloudflare' } });
  const unresolved = await fetch(`${base}/api/projects/check-app/domains/check`, { method: 'POST', headers, body: JSON.stringify({ hostname: 'missing.example.test' }) });
  assert.equal(unresolved.status, 200);
  assert.equal((await unresolved.json()).status, 'unresolved');
  const failed = await fetch(`${base}/api/projects/check-app/domains/check`, { method: 'POST', headers, body: JSON.stringify({ hostname: 'boom.example.test' }) });
  assert.equal(failed.status, 200);
  const failedBody = await failed.json();
  assert.equal(failedBody.status, 'error');
  assert.equal(failedBody.hostname, 'boom.example.test');
  assert.match(failedBody.detail, /DNS check failed/i);
  const rejected = await fetch(`${base}/api/projects/check-app/domains/check`, { method: 'POST', headers, body: JSON.stringify({ hostname: 'invalid host' }) });
  assert.equal(rejected.status, 400);
  assert.match((await rejected.json()).error, /valid DNS hostname/i);
  const missingProject = await fetch(`${base}/api/projects/missing-app/domains/check`, { method: 'POST', headers, body: JSON.stringify({ hostname: 'ok.example.test' }) });
  assert.equal(missingProject.status, 404);
  assert.match((await missingProject.json()).error, /not found/i);
});

test('project edge check reports nginx probe steps after a domain is saved', async (t) => {
  const { app, base } = await start();
  t.after(() => app.close());
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'owner@local.test', password: 'correct-horse-battery-staple' }) });
  const session = await login.json();
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const headers = { cookie, 'content-type': 'application/json', 'x-csrf-token': session.csrfToken };
  await fetch(`${base}/api/tools/git/install`, { method: 'POST', headers, body: JSON.stringify({ confirm: true }) });
  await fetch(`${base}/api/git-config`, { method: 'POST', headers, body: JSON.stringify({ name: 'Demo Owner', email: 'owner@example.test' }) });
  await fetch(`${base}/api/projects/sync`, { method: 'POST', headers, body: JSON.stringify({ name: 'Edge app', slug: 'edge-app', repository: 'https://github.com/example/edge.git', branch: 'main', port: 3002, protocol: 'https' }) });
  const missing = await fetch(`${base}/api/projects/edge-app/edge/check`, { method: 'POST', headers, body: '{}' });
  assert.equal(missing.status, 400);
  await fetch(`${base}/api/projects/edge-app/domains`, { method: 'POST', headers, body: JSON.stringify({ domains: ['helpdesk-api.example.test'] }) });
  const checked = await fetch(`${base}/api/projects/edge-app/edge/check`, { method: 'POST', headers, body: '{}' });
  assert.equal(checked.status, 200);
  const body = await checked.json();
  assert.equal(body.passed, false);
  assert.equal(body.status, 'unavailable');
  assert.equal(body.hostname, 'helpdesk-api.example.test');
  assert.equal(body.checks[0].id, 'host');
});
