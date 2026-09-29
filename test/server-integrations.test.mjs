import test from 'node:test';
import assert from 'node:assert/strict';

import { start } from './support/server.mjs';

test('mail packages can be certified after manual SSH installation on a host', async (t) => {
  const { app, base } = await start({
    mode: 'host',
    toolProbe: async (tools) => tools.map((tool) => tool.id === 'mail'
      ? { ...tool, status: 'Installed', version: 'Postfix 3.8 · Dovecot 2.3 · OpenDKIM' }
      : tool)
  });
  t.after(() => app.close());

  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'owner@local.test', password: 'correct-horse-battery-staple' }) });
  const session = await login.json();
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const headers = { cookie, 'content-type': 'application/json', 'x-csrf-token': session.csrfToken };

  const verified = await fetch(`${base}/api/tools/mail/manual-verify`, { method: 'POST', headers, body: JSON.stringify({ confirm: true }) });
  assert.equal(verified.status, 200);
  const body = await verified.json();
  assert.equal(body.tool.status, 'Installed');
  assert.equal(body.tool.version, 'Postfix 3.8 · Dovecot 2.3 · OpenDKIM');
  assert.equal(body.tool.simulated, false);

  const audit = await (await fetch(`${base}/api/audit`, { headers: { cookie } })).json();
  assert.ok(audit.events.some((event) => event.action === 'tool.manual_verify' && event.target === 'mail'));
});

test('Git identity, encrypted credential, and HTTPS project sync never return a token value', async (t) => {
  const { app, base } = await start();
  t.after(() => app.close());
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'owner@local.test', password: 'correct-horse-battery-staple' }) });
  const session = await login.json();
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const headers = { cookie, 'content-type': 'application/json', 'x-csrf-token': session.csrfToken };
  const gitInstall = await fetch(`${base}/api/tools/git/install`, { method: 'POST', headers, body: JSON.stringify({ confirm: true }) });
  assert.equal(gitInstall.status, 200);
  const identity = await fetch(`${base}/api/git-config`, { method: 'POST', headers, body: JSON.stringify({ name: 'Demo Owner', email: 'owner@example.test' }) });
  assert.equal(identity.status, 200);
  const credential = await fetch(`${base}/api/credentials`, { method: 'POST', headers, body: JSON.stringify({ name: 'github-private', token: 'ghp_private_token_is_never_returned', defaultCredential: true }) });
  assert.equal(credential.status, 201);
  const credentialPayload = await credential.json();
  assert.equal(credentialPayload.credential.isDefault, true);
  const listedCredentials = await (await fetch(`${base}/api/credentials`, { headers: { cookie } })).json();
  assert.equal(listedCredentials.defaultCredentialId, credentialPayload.credential.id);
  assert.equal(listedCredentials.credentials[0].isDefault, true);
  assert.equal(listedCredentials.credentials[0].host, 'github.com');
  assert.equal(JSON.stringify(listedCredentials).includes('ghp_private_token'), false);
  const mismatchedHost = await fetch(`${base}/api/git/branches`, { method: 'POST', headers, body: JSON.stringify({ repository: 'https://gitlab.example/private/demo.git', protocol: 'https', credentialId: credentialPayload.credential.id }) });
  assert.equal(mismatchedHost.status, 400);
  assert.match((await mismatchedHost.json()).error, /scoped to github\.com/);
  const sync = await fetch(`${base}/api/projects/sync`, { method: 'POST', headers, body: JSON.stringify({ name: 'Demo app', slug: 'demo-app', repository: 'https://github.com/example/demo.git', branch: 'main', port: 3000, protocol: 'https', credentialId: credentialPayload.credential.id }) });
  assert.equal(sync.status, 200);
  const projects = await fetch(`${base}/api/projects`, { headers: { cookie } });
  const payload = await projects.json();
  assert.equal(payload.projects[0].credentialId, credentialPayload.credential.id);
  assert.equal(JSON.stringify(payload).includes('ghp_private_token'), false);
  assert.equal(payload.projects[0].sync.status, 'synced');
});

test('credentials and notification hooks can be deleted without returning secret values', async (t) => {
  const { app, base } = await start();
  t.after(() => app.close());
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'owner@local.test', password: 'correct-horse-battery-staple' }) });
  const session = await login.json();
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const headers = { cookie, 'content-type': 'application/json', 'x-csrf-token': session.csrfToken };
  const credential = await fetch(`${base}/api/credentials`, { method: 'POST', headers, body: JSON.stringify({ name: 'remove-me', token: 'never-return-this-token' }) });
  const credentialBody = await credential.json();
  const defaulted = await fetch(`${base}/api/credentials/default`, { method: 'POST', headers, body: JSON.stringify({ credentialId: credentialBody.credential.id }) });
  assert.equal(defaulted.status, 200);
  assert.equal((await defaulted.json()).defaultCredentialId, credentialBody.credential.id);
  const listedCredentials = await fetch(`${base}/api/credentials`, { headers: { cookie } });
  const listedCredentialPayload = await listedCredentials.json();
  assert.equal(listedCredentialPayload.defaultCredentialId, credentialBody.credential.id);
  assert.equal(JSON.stringify(listedCredentialPayload).includes('never-return-this-token'), false);
  assert.equal((await fetch(`${base}/api/credentials/${credentialBody.credential.id}`, { method: 'DELETE', headers, body: '{}' })).status, 200);
  assert.equal((await (await fetch(`${base}/api/credentials`, { headers: { cookie } })).json()).defaultCredentialId, null);
  const hook = await fetch(`${base}/api/notification-hooks`, { method: 'POST', headers, body: JSON.stringify({ name: 'production-discord', provider: 'discord', endpoint: 'https://discord.com/api/webhooks/not-a-real-secret', projectSlug: '', events: ['deployment.succeeded', 'deployment.failed'] }) });
  assert.equal(hook.status, 201);
  const hookBody = await hook.json();
  const listedHooks = await fetch(`${base}/api/notification-hooks`, { headers: { cookie } });
  const hooksPayload = await listedHooks.json();
  assert.equal(JSON.stringify(hooksPayload).includes('not-a-real-secret'), false);
  assert.equal((await fetch(`${base}/api/notification-hooks/${hookBody.hook.id}`, { method: 'DELETE', headers, body: '{}' })).status, 200);
});


test('host project sync checks the live Git probe instead of stale persisted tool state', async (t) => {
  const toolProbe = async (tools) => tools.map((tool) => ({ ...tool, status: 'Installed', version: 'git version test', simulated: false }));
  const { app, base } = await start({ mode: 'host', toolProbe });
  t.after(() => app.close());
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'owner@local.test', password: 'correct-horse-battery-staple' }) });
  const session = await login.json();
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const response = await fetch(`${base}/api/projects/sync`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json', 'x-csrf-token': session.csrfToken },
    body: JSON.stringify({ name: 'Test app', slug: 'test-app', repository: 'https://example.test/test.git', branch: 'main', port: 3000, protocol: 'https' })
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /Configure Git identity/);
});
