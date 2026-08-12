import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from '../src/server.mjs';
import { createServer } from 'node:net';

async function listen(app) {
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${app.server.address().port}`;
}

test('first-run bootstrap creates an owner and enables email login', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'hostmgr-bootstrap-'));
  let app;
  t.after(async () => {
    if (app) await app.close().catch(() => {});
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  });
  app = await createApplication({
    dataPath: join(dir, 'state.sqlite'),
    secretKey: Buffer.alloc(32, 3).toString('base64'),
    mode: 'demo',
    sandboxClone: false,
    metricsEnabled: false
  });
  const base = await listen(app);
  const session = await (await fetch(`${base}/api/session`)).json();
  assert.equal(session.bootstrapRequired, true);
  const rejected = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'owner@example.com', password: 'ValidPass123!' }) });
  assert.equal(rejected.status, 409);
  const boot = await fetch(`${base}/api/bootstrap`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'Owner@Example.com', password: 'ValidPass123!', confirmPassword: 'ValidPass123!' })
  });
  assert.equal(boot.status, 200);
  const created = await boot.json();
  assert.equal(created.owner.email, 'owner@example.com');
  const cookie = boot.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(`${base}/api/doctor`, { headers: { cookie } })).status, 200);
  await fetch(`${base}/api/logout`, { method: 'POST', headers: { cookie, 'content-type': 'application/json', 'x-csrf-token': created.csrfToken }, body: '{}' });
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'owner@example.com', password: 'ValidPass123!' }) });
  assert.equal(login.status, 200);
});

test('database connectors store metadata only and can probe TCP reachability', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'hostmgr-dbconn-'));
  let app;
  let probe;
  t.after(async () => {
    if (app) await app.close().catch(() => {});
    if (probe) await new Promise((resolve) => probe.close(resolve));
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  });
  probe = createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  app = await createApplication({
    dataPath: join(dir, 'state.sqlite'),
    password: 'correct-horse-battery-staple',
    secretKey: Buffer.alloc(32, 4).toString('base64'),
    mode: 'demo',
    sandboxClone: false,
    metricsEnabled: false
  });
  const base = await listen(app);
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'owner@local.test', password: 'correct-horse-battery-staple' }) });
  const session = await login.json();
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const headers = { cookie, 'content-type': 'application/json', 'x-csrf-token': session.csrfToken };
  const created = await fetch(`${base}/api/databases`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: 'local-redis', provider: 'redis', host: '127.0.0.1', port, password: 'secret-token' })
  });
  assert.equal(created.status, 201);
  const body = await created.json();
  assert.equal(body.connection.hasPassword, true);
  assert.equal(JSON.stringify(body).includes('secret-token'), false);
  const check = await fetch(`${base}/api/databases/${body.connection.id}/check`, { method: 'POST', headers, body: '{}' });
  assert.equal(check.status, 200);
  assert.equal((await check.json()).result.ok, true);
});
