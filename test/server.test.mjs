import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copyCandidateSource, createApplication } from '../src/server.mjs';

async function start(options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'hostmgr-server-'));
  const app = await createApplication({ dataPath: join(dir, 'state.json'), password: 'correct-horse-battery-staple', secretKey: Buffer.alloc(32, 7).toString('base64'), mode: 'demo', sandboxClone: false, ...options });
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

test('dashboard URLs reload their matching application shell', async (t) => {
  const { app, base } = await start();
  t.after(() => app.close());
  for (const path of ['/', '/setup', '/projects', '/credentials', '/activity', '/settings']) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get('content-type'), /text\/html/);
    assert.match(await response.text(), /data-page="projects"/);
  }
  assert.equal((await fetch(`${base}/not-a-dashboard-page`)).status, 404);
});

test('dashboard API authenticates, protects CSRF, and audits a sandbox install', async (t) => {
  const { app, base } = await start();
  t.after(() => app.close());
  assert.equal((await fetch(`${base}/api/doctor`)).status, 401);
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'correct-horse-battery-staple' }) });
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

test('Git identity, encrypted credential, and HTTPS project sync never return a token value', async (t) => {
  const { app, base } = await start();
  t.after(() => app.close());
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'correct-horse-battery-staple' }) });
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


test('invalid request data returns a client error without crashing the backend', async (t) => {
  const { app, base } = await start();
  t.after(() => app.close());
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'correct-horse-battery-staple' }) });
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
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'correct-horse-battery-staple' }) });
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
  const login = await fetch(`${first.base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'correct-horse-battery-staple' }) });
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
  assert.deepEqual(await session.json(), { authenticated: true, csrfToken: (await login.clone().json()).csrfToken, mode: 'demo' });
});

test('local UI demo simulates sync and activates a release without cloning', async (t) => {
  const { app, base } = await start();
  t.after(() => app.close());
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'correct-horse-battery-staple' }) });
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

test('project domains are validated, persisted, and do not expose deployment secrets', async (t) => {
  const { app, base } = await start();
  t.after(() => app.close());
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'correct-horse-battery-staple' }) });
  const session = await login.json();
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const headers = { cookie, 'content-type': 'application/json', 'x-csrf-token': session.csrfToken };
  await fetch(`${base}/api/tools/git/install`, { method: 'POST', headers, body: JSON.stringify({ confirm: true }) });
  await fetch(`${base}/api/git-config`, { method: 'POST', headers, body: JSON.stringify({ name: 'Demo Owner', email: 'owner@example.test' }) });
  await fetch(`${base}/api/projects/sync`, { method: 'POST', headers, body: JSON.stringify({ name: 'Domain app', slug: 'domain-app', repository: 'https://github.com/example/domain.git', branch: 'main', port: 3000, protocol: 'https' }) });
  const response = await fetch(`${base}/api/projects/domain-app/domains`, { method: 'POST', headers, body: JSON.stringify({ domains: ['App.Example.test', 'www.example.test'] }) });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).project.domains.hosts, ['app.example.test', 'www.example.test']);
  const rejected = await fetch(`${base}/api/projects/domain-app/domains`, { method: 'POST', headers, body: JSON.stringify({ domains: ['invalid host'] }) });
  assert.equal(rejected.status, 400);
});

test('domain DNS check returns structured soft-check status and rejects invalid hostnames', async (t) => {
  const { app, base } = await start({
    domainDnsCheck: async (hostname) => {
      if (hostname === 'ok.example.test') return { hostname, resolved: ['203.0.113.9'], expected: ['203.0.113.9'], matched: true, status: 'ok' };
      if (hostname === 'boom.example.test') throw new Error('resolver exploded');
      return { hostname, resolved: [], expected: ['203.0.113.9'], matched: false, status: 'unresolved' };
    },
  });
  t.after(() => app.close());
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'correct-horse-battery-staple' }) });
  const session = await login.json();
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const headers = { cookie, 'content-type': 'application/json', 'x-csrf-token': session.csrfToken };
  await fetch(`${base}/api/tools/git/install`, { method: 'POST', headers, body: JSON.stringify({ confirm: true }) });
  await fetch(`${base}/api/git-config`, { method: 'POST', headers, body: JSON.stringify({ name: 'Demo Owner', email: 'owner@example.test' }) });
  await fetch(`${base}/api/projects/sync`, { method: 'POST', headers, body: JSON.stringify({ name: 'Check app', slug: 'check-app', repository: 'https://github.com/example/check.git', branch: 'main', port: 3000, protocol: 'https' }) });
  const ok = await fetch(`${base}/api/projects/check-app/domains/check`, { method: 'POST', headers, body: JSON.stringify({ hostname: 'ok.example.test' }) });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { hostname: 'ok.example.test', resolved: ['203.0.113.9'], expected: ['203.0.113.9'], matched: true, status: 'ok' });
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
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'correct-horse-battery-staple' }) });
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
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'correct-horse-battery-staple' }) });
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
