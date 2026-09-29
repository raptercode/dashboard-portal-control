import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { start } from './support/server.mjs';

test('dashboard API authenticates, protects CSRF, and audits a sandbox install', async (t) => {
  const { app, base } = await start();
  t.after(() => app.close());
  assert.equal((await fetch(`${base}/api/doctor`)).status, 401);
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'owner@local.test', password: 'correct-horse-battery-staple' }) });
  assert.equal(login.status, 200);
  const session = await login.json();
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const rejected = await fetch(`${base}/api/tools/nginx/install`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ confirm: true }) });
  assert.equal(rejected.status, 403);
  const installed = await fetch(`${base}/api/tools/nginx/install`, { method: 'POST', headers: { cookie, 'content-type': 'application/json', 'x-csrf-token': session.csrfToken }, body: JSON.stringify({ confirm: true }) });
  assert.equal(installed.status, 200);
  const managedRuntime = await fetch(`${base}/api/tools/go/install`, { method: 'POST', headers: { cookie, 'content-type': 'application/json', 'x-csrf-token': session.csrfToken }, body: JSON.stringify({ confirm: true }) });
  assert.equal(managedRuntime.status, 400);
  assert.match((await managedRuntime.json()).error, /Dashboard Portal installer/);
  const doctor = await fetch(`${base}/api/doctor`, { headers: { cookie } });
  const report = await doctor.json();
  assert.equal(report.mode, 'demo');
  assert.equal(report.tools.find((tool) => tool.id === 'nginx').status, 'Installed');
  const audit = await fetch(`${base}/api/audit`, { headers: { cookie } });
  assert.ok((await audit.json()).events.some((event) => event.action === 'tool.install'));
});

test('owner can change the password, which invalidates every existing session', async (t) => {
  const { app, base } = await start();
  t.after(() => app.close());
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'owner@local.test', password: 'correct-horse-battery-staple' }) });
  const session = await login.json();
  const oldCookie = login.headers.get('set-cookie').split(';')[0];
  const change = await fetch(`${base}/api/settings/password`, {
    method: 'POST',
    headers: { cookie: oldCookie, 'content-type': 'application/json', 'x-csrf-token': session.csrfToken },
    body: JSON.stringify({ currentPassword: 'correct-horse-battery-staple', newPassword: 'New-correct-horse1!' })
  });
  assert.equal(change.status, 200);
  const changed = await change.json();
  const renewedCookie = change.headers.get('set-cookie').split(';')[0];
  assert.notEqual(renewedCookie, oldCookie);
  assert.equal((await fetch(`${base}/api/doctor`, { headers: { cookie: oldCookie } })).status, 401);
  assert.equal((await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'owner@local.test', password: 'correct-horse-battery-staple' }) })).status, 401);
  const nextLogin = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'owner@local.test', password: 'New-correct-horse1!' }) });
  assert.equal(nextLogin.status, 200);
  assert.equal(changed.csrfToken.length, 43);
  const audit = await fetch(`${base}/api/audit`, { headers: { cookie: renewedCookie } });
  const auditText = JSON.stringify(await audit.json());
  assert.match(auditText, /auth.password_changed/);
  assert.equal(auditText.includes('New-correct-horse1!'), false);
});

test('invalid request data returns a client error without crashing the backend', async (t) => {
  const { app, base } = await start();
  t.after(() => app.close());
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'owner@local.test', password: 'correct-horse-battery-staple' }) });
  const session = await login.json();
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const headers = { cookie, 'content-type': 'application/json', 'x-csrf-token': session.csrfToken };
  const invalidCredential = await fetch(`${base}/api/credentials`, { method: 'POST', headers, body: JSON.stringify({ name: 'GitHub Personal', token: 'token-value' }) });
  assert.equal(invalidCredential.status, 400);
  assert.match((await invalidCredential.json()).error, /lowercase letters/);
  const malformedLogin = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' });
  assert.equal(malformedLogin.status, 400);
  assert.equal((await fetch(`${base}/api/health`)).status, 200);
});

test('session cookie persists for seven days and survives an application restart without storing its raw id', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'hostmgr-session-'));
  const dataPath = join(dir, 'state.json');
  const first = await start({ dataPath, secureCookie: true });
  const login = await fetch(`${first.base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'owner@local.test', password: 'correct-horse-battery-staple' }) });
  const setCookie = login.headers.get('set-cookie');
  const cookie = setCookie.split(';')[0];
  assert.match(setCookie, /Max-Age=604800/);
  assert.match(setCookie, /HttpOnly; SameSite=Strict; Path=\/; Max-Age=604800; Secure/);
  await first.app.close();
  const persisted = await readFile(dataPath, 'utf8');
  assert.equal(persisted.includes(cookie.slice('hostmgr_session='.length)), false);
  const second = await start({ dataPath, secureCookie: true });
  t.after(() => second.app.close());
  const session = await fetch(`${second.base}/api/session`, { headers: { cookie } });
  const body = await session.json();
  assert.equal(body.authenticated, true);
  assert.equal(body.mode, 'demo');
  assert.equal(body.bootstrapRequired, false);
  assert.equal(body.owner.email, 'owner@local.test');
  assert.equal(body.csrfToken, (await login.clone().json()).csrfToken);
});
