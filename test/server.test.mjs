import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copyCandidateSource, createApplication, installCandidateDependencies, resolveProjectPort } from '../src/server.mjs';

async function start(options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'hostmgr-server-'));
  const app = await createApplication({ dataPath: join(dir, 'state.json'), password: 'correct-horse-battery-staple', secretKey: Buffer.alloc(32, 7).toString('base64'), mode: 'demo', sandboxClone: false, metricsEnabled: false, ...options });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const address = app.server.address();
  return { app, base: `http://127.0.0.1:${address.port}` };
}

test('candidate source copy works on Node 24 and excludes repository internals', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'hostmgr-candidate-copy-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const source = join(dir, 'source');
  const destination = join(dir, 'candidate');
  await mkdir(join(source, 'node_modules'), { recursive: true });
  await mkdir(join(source, '.git'), { recursive: true });
  await writeFile(join(source, 'package.json'), '{"name":"candidate"}');
  await writeFile(join(source, 'node_modules', 'ignored.js'), 'ignored');
  await writeFile(join(source, '.git', 'HEAD'), 'ref: refs/heads/main');

  await copyCandidateSource(source, destination);

  assert.equal((await readFile(join(destination, 'package.json'), 'utf8')).includes('candidate'), true);
  await assert.rejects(access(join(destination, 'node_modules')));
  await assert.rejects(access(join(destination, '.git')));
});

test('candidate dependency install uses npm install only when a lockfile is absent or unusable', async () => {
  const calls = [];
  const events = [];
  const reportPhase = async (...event) => events.push(event);
  const runner = async (args) => { calls.push(args); };

  assert.equal(await installCandidateDependencies({ hasLockfile: false, runNpm: runner, options: {}, reportPhase }), 'unlocked');
  assert.deepEqual(calls, [['install']]);
  assert.match(events.at(-1)[2], /synced Git checkout was not changed/);

  calls.length = 0;
  events.length = 0;
  assert.equal(await installCandidateDependencies({ hasLockfile: true, runNpm: runner, options: {}, reportPhase }), 'locked');
  assert.deepEqual(calls, [['ci']]);

  calls.length = 0;
  events.length = 0;
  const staleLockRunner = async (args) => {
    calls.push(args);
    if (args[0] === 'ci') throw new Error('npm error code EUSAGE\nnpm error Missing: @esbuild/linux-x64 from lock file');
  };
  assert.equal(await installCandidateDependencies({ hasLockfile: true, runNpm: staleLockRunner, options: {}, reportPhase }), 'unlocked');
  assert.deepEqual(calls, [['ci'], ['install']]);
  assert.match(events[1][2], /Retrying npm install/);

  await assert.rejects(
    installCandidateDependencies({ hasLockfile: true, runNpm: async () => { throw new Error('npm error code ECONNRESET'); }, options: {} }),
    /Candidate dependency installation failed/
  );
});

test('Bun candidate installs use a frozen lockfile and fall back only for a lock mismatch', async () => {
  const calls = [];
  const runner = async (args) => { calls.push(args); };
  assert.equal(await installCandidateDependencies({ hasLockfile: true, runtime: 'bun', runNpm: runner, options: {} }), 'locked');
  assert.deepEqual(calls, [['install', '--frozen-lockfile']]);

  calls.length = 0;
  const staleLockRunner = async (args) => {
    calls.push(args);
    if (args.includes('--frozen-lockfile')) throw new Error('error: lockfile had changes, but lockfile is frozen');
  };
  assert.equal(await installCandidateDependencies({ hasLockfile: true, runtime: 'bun', runNpm: staleLockRunner, options: {} }), 'unlocked');
  assert.deepEqual(calls, [['install', '--frozen-lockfile'], ['install']]);
});

test('automatic project ports retry reserved and listening ports, including their candidate ports', async () => {
  const attempts = [12_000, 13_000, 14_000];
  const checked = [];
  const port = await resolveProjectPort(
    { slug: 'new-app', runtime: 'bun', port: null },
    null,
    [{ slug: 'existing-app', runtime: 'node', port: 12_000 }],
    async (candidate) => { checked.push(candidate); return candidate !== 13_000; },
    () => attempts.shift()
  );
  assert.equal(port, 14_000);
  assert.deepEqual(checked, [13_000, 14_000, 24_000]);
});

test('project-scoped monitor tokens expose safe deployment status without an owner session', async (t) => {
  const { app, base } = await start();
  t.after(() => app.close());
  await app.store.update((state) => {
    state.projects.push({
      name: 'Monitor app', organization: 'Tests', slug: 'monitor-app', repository: 'https://token@example.test/private.git', branch: 'main', directory: '/', port: 3211,
      healthCheckEnabled: true, healthCheckPath: '/', protocol: 'https', credentialId: 'private-credential', sync: { status: 'synced', at: new Date().toISOString(), detail: 'Source synced.' },
      environment: { keys: ['SECRET'], encryptedContent: { ciphertext: 'never-returned' } }, domains: { hosts: ['monitor.example.test'] },
      deployment: { state: 'failed', activeReleaseId: null, previousReleaseId: null, updatedAt: new Date().toISOString(), releases: [{ id: 'a'.repeat(36), revision: 'deadbeef', status: 'failed', createdAt: new Date().toISOString(), failure: 'Build failed.', health: { status: 'failed' }, events: [{ at: new Date().toISOString(), phase: 'build', status: 'failed', message: 'Build failed.' }] }] }
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
  const revoked = await fetch(`${base}/api/monitor-tokens/${createdBody.monitorToken.id}`, { method: 'DELETE', headers, body: '{}' });
  assert.equal(revoked.status, 200);
  assert.equal((await fetch(`${base}/api/monitor/v1/projects/monitor-app/deployments`, { headers: { authorization: `Bearer ${createdBody.token}` } })).status, 403);
});

test('dashboard URLs reload their matching application shell', async (t) => {
  const { app, base } = await start();
  t.after(() => app.close());
  const pages = {
    '/': 'overview',
    '/setup': 'setup',
    '/projects': 'projects',
    '/credentials': 'credentials',
    '/databases': 'databases',
    '/activity': 'activity',
    '/settings': 'settings'
  };
  for (const [path, page] of Object.entries(pages)) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get('content-type'), /text\/html/);
    const html = await response.text();
    assert.match(html, new RegExp(`data-page="${page}"`));
    assert.match(html, /\/ui\/app\.js/);
  }
  for (const path of ['/projects/new', '/projects/new/repository', '/projects/new/review']) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 200, path);
    assert.match(await response.text(), /data-page="projects"/);
  }
  assert.equal((await fetch(`${base}/not-a-dashboard-page`)).status, 404);
  assert.equal((await fetch(`${base}/index.html`)).status, 404);
  assert.equal((await fetch(`${base}/app.js`)).status, 404);
});

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
  const credential = await fetch(`${base}/api/credentials`, { method: 'POST', headers, body: JSON.stringify({ name: 'github-private', token: 'ghp_private_token_is_never_returned' }) });
  assert.equal(credential.status, 201);
  const credentialPayload = await credential.json();
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
  const listedCredentials = await fetch(`${base}/api/credentials`, { headers: { cookie } });
  assert.equal(JSON.stringify(await listedCredentials.json()).includes('never-return-this-token'), false);
  assert.equal((await fetch(`${base}/api/credentials/${credentialBody.credential.id}`, { method: 'DELETE', headers, body: '{}' })).status, 200);
  const hook = await fetch(`${base}/api/notification-hooks`, { method: 'POST', headers, body: JSON.stringify({ name: 'production-discord', provider: 'discord', endpoint: 'https://discord.com/api/webhooks/not-a-real-secret', projectSlug: '', events: ['deployment.succeeded', 'deployment.failed'] }) });
  assert.equal(hook.status, 201);
  const hookBody = await hook.json();
  const listedHooks = await fetch(`${base}/api/notification-hooks`, { headers: { cookie } });
  const hooksPayload = await listedHooks.json();
  assert.equal(JSON.stringify(hooksPayload).includes('not-a-real-secret'), false);
  assert.equal((await fetch(`${base}/api/notification-hooks/${hookBody.hook.id}`, { method: 'DELETE', headers, body: '{}' })).status, 200);
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

test('local UI demo simulates sync and activates a release without cloning', async (t) => {
  const { app, base } = await start();
  t.after(() => app.close());
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'owner@local.test', password: 'correct-horse-battery-staple' }) });
  const session = await login.json();
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const headers = { cookie, 'content-type': 'application/json', 'x-csrf-token': session.csrfToken };
  await fetch(`${base}/api/tools/git/install`, { method: 'POST', headers, body: JSON.stringify({ confirm: true }) });
  await fetch(`${base}/api/git-config`, { method: 'POST', headers, body: JSON.stringify({ name: 'Demo Owner', email: 'owner@example.test' }) });
  const sync = await fetch(`${base}/api/projects/sync`, { method: 'POST', headers, body: JSON.stringify({ name: 'Demo app', slug: 'demo-app', repository: 'https://github.com/example/demo.git', branch: 'main', port: 3000, protocol: 'https' }) });
  assert.equal(sync.status, 200);
  assert.equal((await sync.json()).project.sync.status, 'synced');
  const environment = await fetch(`${base}/api/projects/demo-app/environment`, { method: 'POST', headers, body: JSON.stringify({ content: '' }) });
  assert.equal(environment.status, 200);
  assert.deepEqual((await environment.clone().json()).project.environment.keys, ['NODE_ENV']);
  const deploy = await fetch(`${base}/api/projects/demo-app/deploy`, { method: 'POST', headers, body: '{}' });
  assert.equal(deploy.status, 200);
  const payload = await deploy.json();
  assert.equal(payload.activation, 'complete');
  assert.equal(payload.project.deployment.state, 'active');
  assert.ok(payload.project.deployment.activeReleaseId);
});

test('environment drawer reveals only explicitly non-sensitive values and retains blank sensitive values', async (t) => {
  const { app, base } = await start();
  t.after(() => app.close());
  await app.store.update((state) => {
    state.projects.push({ name: 'Environment app', slug: 'environment-app', environment: { keys: [] } });
  });
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'owner@local.test', password: 'correct-horse-battery-staple' }) });
  const session = await login.json();
  const headers = { cookie: login.headers.get('set-cookie').split(';')[0], 'content-type': 'application/json', 'x-csrf-token': session.csrfToken };
  const saved = await fetch(`${base}/api/projects/environment-app/environment`, {
    method: 'POST', headers,
    body: JSON.stringify({ variables: [
      { key: 'NODE_ENV', value: 'production', sensitive: false },
      { key: 'API_KEY', value: 'never-return-this', sensitive: true }
    ] })
  });
  assert.equal(saved.status, 200);
  const firstRead = await fetch(`${base}/api/projects/environment-app/environment`, { headers: { cookie: headers.cookie } });
  assert.equal(firstRead.status, 200);
  const firstPayload = await firstRead.json();
  assert.deepEqual(firstPayload.environment.variables, [
    { key: 'API_KEY', sensitive: true, value: null },
    { key: 'NODE_ENV', sensitive: false, value: 'production' }
  ]);
  assert.equal(JSON.stringify(firstPayload).includes('never-return-this'), false);
  const retained = await fetch(`${base}/api/projects/environment-app/environment`, {
    method: 'POST', headers,
    body: JSON.stringify({ variables: [
      { key: 'API_KEY', value: '', sensitive: true },
      { key: 'NODE_ENV', value: '', sensitive: false }
    ] })
  });
  assert.equal(retained.status, 200);
  const secondPayload = await (await fetch(`${base}/api/projects/environment-app/environment`, { headers: { cookie: headers.cookie } })).json();
  assert.deepEqual(secondPayload.environment.variables, firstPayload.environment.variables);
});

test('deploy configuration marks a missing package lock as invalid and selects npm install', async (t) => {
  const { app, base } = await start();
  t.after(() => app.close());
  await app.store.update((state) => {
    state.projects.push({ name: 'Unlocked app', slug: 'unlocked-app', runtime: 'node', branch: 'main', directory: '/', buildScript: 'build', startScript: 'start' });
  });
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'owner@local.test', password: 'correct-horse-battery-staple' }) });
  const payload = await (await fetch(`${base}/api/projects/unlocked-app/deploy-configuration`, { headers: { cookie: login.headers.get('set-cookie').split(';')[0] } })).json();
  assert.deepEqual(payload.configuration.lockfile, { name: 'package-lock.json', valid: false });
  assert.equal(payload.configuration.packageManager, 'npm install');
  assert.equal(payload.configuration.buildScript, 'npm run build');
});

test('host deployment returns immediately with a durable queued job instead of holding the HTTP request', async (t) => {
  const { app, base } = await start({ mode: 'host', sandboxClone: false });
  t.after(() => app.close());
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'owner@local.test', password: 'correct-horse-battery-staple' }) });
  const session = await login.json();
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const headers = { cookie, 'content-type': 'application/json', 'x-csrf-token': session.csrfToken };
  await app.store.update((state) => {
    state.projects.push({
      name: 'Queued app', organization: 'Tests', slug: 'queued-app', repository: 'https://github.com/example/queued.git', branch: 'main', directory: '/', port: 3210,
      healthCheckEnabled: true, healthCheckPath: '/', protocol: 'https', credentialId: null, sshKeyId: null, buildScript: null, startScript: 'start',
      sync: { status: 'synced', at: new Date().toISOString(), detail: 'Seeded for queue test.' },
      environment: { keys: ['NODE_ENV'], encryptedContent: { algorithm: 'aes-256-gcm', iv: 'AAAAAAAAAAAAAAAA', tag: 'AAAAAAAAAAAAAAAAAAAAAA==', ciphertext: 'AA==' } },
      domains: { hosts: ['queued.example.test'], updatedAt: new Date().toISOString(), syncedAt: null },
      deployment: { state: 'idle', activeReleaseId: null, previousReleaseId: null, releases: [], updatedAt: new Date().toISOString() }
    });
  });
  const deploy = await fetch(`${base}/api/projects/queued-app/deploy`, { method: 'POST', headers, body: '{}' });
  assert.equal(deploy.status, 202);
  const payload = await deploy.json();
  assert.equal(payload.activation, 'queued');
  assert.match(payload.job.id, /^[a-f0-9-]{36}$/);
  const status = await fetch(`${base}/api/jobs/${payload.job.id}`, { headers: { cookie } });
  assert.equal(status.status, 200);
  assert.ok(['queued', 'running', 'failed'].includes((await status.json()).job.status));
});

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

test('a failed repository sync is recorded as failure and never overwrites an active release', async (t) => {
  const { app, base } = await start({ sandboxClone: true });
  t.after(() => app.close());
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'owner@local.test', password: 'correct-horse-battery-staple' }) });
  const session = await login.json();
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const headers = { cookie, 'content-type': 'application/json', 'x-csrf-token': session.csrfToken };
  await fetch(`${base}/api/tools/git/install`, { method: 'POST', headers, body: JSON.stringify({ confirm: true }) });
  await fetch(`${base}/api/git-config`, { method: 'POST', headers, body: JSON.stringify({ name: 'Demo Owner', email: 'owner@example.test' }) });
  const sync = await fetch(`${base}/api/projects/sync`, { method: 'POST', headers, body: JSON.stringify({ name: 'Unreachable app', slug: 'unreachable-app', repository: 'https://127.0.0.1:1/unreachable.git', branch: 'main', port: 3000, protocol: 'https' }) });
  assert.equal(sync.status, 422);
  const projects = await fetch(`${base}/api/projects`, { headers: { cookie } });
  const project = (await projects.json()).projects[0];
  assert.equal(project.sync.status, 'failed');
  assert.equal(project.deployment.activeReleaseId, null);
  const audit = await fetch(`${base}/api/audit`, { headers: { cookie } });
  assert.ok((await audit.json()).events.some((event) => event.action === 'project.sync_configure' && event.outcome === 'failure'));
});

test('projects support a repository subdirectory, fetched branch choices, editing, and deletion', async (t) => {
  const { app, base } = await start({ branchFetcher: async () => ['release/2026', 'main', 'feature/example'] });
  t.after(() => app.close());
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'owner@local.test', password: 'correct-horse-battery-staple' }) });
  const session = await login.json();
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const headers = { cookie, 'content-type': 'application/json', 'x-csrf-token': session.csrfToken };
  await fetch(`${base}/api/tools/git/install`, { method: 'POST', headers, body: JSON.stringify({ confirm: true }) });
  await fetch(`${base}/api/git-config`, { method: 'POST', headers, body: JSON.stringify({ name: 'Demo Owner', email: 'owner@example.test' }) });
  const branches = await fetch(`${base}/api/git/branches`, { method: 'POST', headers, body: JSON.stringify({ repository: 'https://github.com/example/monorepo.git', protocol: 'https' }) });
  assert.deepEqual((await branches.json()).branches, ['feature/example', 'main', 'release/2026']);
  const sync = await fetch(`${base}/api/projects/sync`, { method: 'POST', headers, body: JSON.stringify({ name: 'Examples app', slug: 'examples-app', repository: 'https://github.com/example/monorepo.git', directory: '/examples', branch: 'release/2026', port: 3100, protocol: 'https', buildScript: 'build', startScript: 'start' }) });
  assert.equal(sync.status, 200);
  assert.equal((await sync.json()).project.directory, '/examples');
  const edit = await fetch(`${base}/api/projects/sync`, { method: 'POST', headers, body: JSON.stringify({ name: 'Examples app renamed', slug: 'examples-app', repository: 'https://github.com/example/monorepo.git', directory: '/apps/web', branch: 'main', port: 3200, protocol: 'https', buildScript: '', startScript: 'start' }) });
  assert.equal(edit.status, 200);
  const edited = (await edit.json()).project;
  assert.equal(edited.name, 'Examples app renamed');
  assert.equal(edited.directory, '/apps/web');
  assert.equal(edited.port, 3200);
  const removed = await fetch(`${base}/api/projects/examples-app`, { method: 'DELETE', headers, body: '{}' });
  assert.equal(removed.status, 200);
  assert.deepEqual((await (await fetch(`${base}/api/projects`, { headers: { cookie } })).json()).projects, []);
  const audit = await fetch(`${base}/api/audit`, { headers: { cookie } });
  assert.ok((await audit.json()).events.some((event) => event.action === 'project.delete'));
});
