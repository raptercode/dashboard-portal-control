import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import { start } from './support/server.mjs';

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

test('manual git sync auto deploys only when auto deploy is enabled', async (t) => {
  let revision = 'c'.repeat(40);
  const projectSyncer = async () => ({ status: 'synced', at: new Date().toISOString(), revision, detail: 'Repository checked.' });
  const { app, base } = await start({ autoSyncPollingEnabled: false, projectSyncer });
  t.after(() => app.close());
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'owner@local.test', password: 'correct-horse-battery-staple' }) });
  const session = await login.json();
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const headers = { cookie, 'content-type': 'application/json', 'x-csrf-token': session.csrfToken };
  await fetch(`${base}/api/tools/git/install`, { method: 'POST', headers, body: JSON.stringify({ confirm: true }) });
  await fetch(`${base}/api/git-config`, { method: 'POST', headers, body: JSON.stringify({ name: 'Demo Owner', email: 'owner@example.test' }) });
  const first = await fetch(`${base}/api/projects/sync`, { method: 'POST', headers, body: JSON.stringify({ name: 'Manual auto', slug: 'manual-auto', repository: 'https://github.com/example/manual.git', branch: 'main', port: 3002, protocol: 'https' }) });
  assert.equal(first.status, 200);
  assert.equal((await first.json()).activation, undefined);
  await fetch(`${base}/api/projects/manual-auto/environment`, { method: 'POST', headers, body: JSON.stringify({ content: 'NODE_ENV=production\n' }) });
  revision = 'd'.repeat(40);
  const disabled = await fetch(`${base}/api/projects/sync`, { method: 'POST', headers, body: JSON.stringify({ name: 'Manual auto', slug: 'manual-auto', repository: 'https://github.com/example/manual.git', branch: 'main', port: 3002, protocol: 'https' }) });
  const disabledPayload = await disabled.json();
  assert.equal(disabled.status, 200);
  assert.equal(disabledPayload.activation, undefined);
  assert.equal(disabledPayload.project.deployment.state, 'idle');
  await fetch(`${base}/api/projects/manual-auto/auto-sync`, { method: 'POST', headers, body: JSON.stringify({ enabled: true }) });
  revision = 'e'.repeat(40);
  const enabled = await fetch(`${base}/api/projects/sync`, { method: 'POST', headers, body: JSON.stringify({ name: 'Manual auto', slug: 'manual-auto', repository: 'https://github.com/example/manual.git', branch: 'main', port: 3002, protocol: 'https' }) });
  const enabledPayload = await enabled.json();
  assert.equal(enabled.status, 200);
  assert.equal(enabledPayload.activation, 'complete');
  assert.equal(enabledPayload.project.deployment.state, 'active');
  assert.equal(enabledPayload.project.sync.revision, revision);
  assert.equal(enabledPayload.project.deployment.releases[0]?.revision, revision);
});

test('signed GitHub push syncs the configured branch and deploys only a new commit', async (t) => {
  let revision = 'a'.repeat(40);
  const { app, base } = await start({ autoSyncPollingEnabled: false, projectSyncer: async () => ({ status: 'synced', at: new Date().toISOString(), revision, detail: 'Repository checked.' }) });
  t.after(() => app.close());
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'owner@local.test', password: 'correct-horse-battery-staple' }) });
  const session = await login.json();
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const headers = { cookie, 'content-type': 'application/json', 'x-csrf-token': session.csrfToken };
  await fetch(`${base}/api/tools/git/install`, { method: 'POST', headers, body: JSON.stringify({ confirm: true }) });
  await fetch(`${base}/api/git-config`, { method: 'POST', headers, body: JSON.stringify({ name: 'Demo Owner', email: 'owner@example.test' }) });
  const synced = await fetch(`${base}/api/projects/sync`, { method: 'POST', headers, body: JSON.stringify({ name: 'GitHub app', slug: 'github-app', repository: 'https://github.com/example/web.git', branch: 'main', port: 3003, protocol: 'https' }) });
  assert.equal(synced.status, 200);
  await fetch(`${base}/api/projects/github-app/environment`, { method: 'POST', headers, body: JSON.stringify({ content: 'NODE_ENV=production\n' }) });
  const configured = await fetch(`${base}/api/projects/github-app/github-webhook`, { method: 'POST', headers, body: JSON.stringify({ action: 'rotate' }) });
  const { secret, project } = await configured.json();
  assert.equal(configured.status, 200);
  assert.equal(project.autoSync.hasSecret, true);
  assert.equal(project.autoSync.encryptedSecret, undefined);
  assert.equal(project.autoSync.mode, 'github');
  const readProject = async () => (await (await fetch(`${base}/api/projects`, { headers: { cookie } })).json()).projects.find((item) => item.slug === 'github-app');
  const sendPush = (payload, signatureSecret = secret, event = 'push') => {
    const body = JSON.stringify(payload);
    return fetch(`${base}/api/webhooks/github/github-app`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-github-event': event, 'x-hub-signature-256': `sha256=${createHmac('sha256', signatureSecret).update(body).digest('hex')}` }, body });
  };
  const payload = { ref: 'refs/heads/main', repository: { full_name: 'example/web' } };
  revision = 'b'.repeat(40);
  assert.equal((await sendPush(payload, 'wrong-secret')).status, 401);
  assert.equal((await sendPush({ ...payload, ref: 'refs/heads/staging' })).status, 202);
  assert.equal((await sendPush({ ...payload, repository: { full_name: 'example/other' } })).status, 202);
  assert.equal((await readProject()).deployment.state, 'idle');
  assert.equal((await sendPush(payload)).status, 202);
  let current;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    current = await readProject();
    if (current.deployment.state === 'active') break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(current.deployment.releases[0].revision, revision);
  const releaseCount = current.deployment.releases.length;
  assert.equal((await sendPush(payload)).status, 202);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal((await readProject()).deployment.releases.length, releaseCount);
  assert.equal((await sendPush(payload, secret, 'ping')).status, 202);
  const rotated = await fetch(`${base}/api/projects/github-app/github-webhook`, { method: 'POST', headers, body: JSON.stringify({ action: 'rotate' }) });
  const replacementSecret = (await rotated.json()).secret;
  assert.equal((await sendPush(payload)).status, 401);
  assert.equal((await sendPush(payload, replacementSecret)).status, 202);
  const disabled = await fetch(`${base}/api/projects/github-app/github-webhook`, { method: 'POST', headers, body: JSON.stringify({ action: 'disable' }) });
  assert.equal(disabled.status, 200);
  assert.equal((await sendPush(payload, replacementSecret)).status, 404);
});

test('Actions mode waits for the hook even after polling syncs the new commit', async (t) => {
  let revision = '1'.repeat(40);
  const { app, base } = await start({ autoSyncIntervalMs: 15, projectSyncer: async () => ({ status: 'synced', at: new Date().toISOString(), revision, detail: 'Repository checked.' }) });
  t.after(() => app.close());
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'owner@local.test', password: 'correct-horse-battery-staple' }) });
  const session = await login.json();
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const headers = { cookie, 'content-type': 'application/json', 'x-csrf-token': session.csrfToken };
  await fetch(`${base}/api/tools/git/install`, { method: 'POST', headers, body: JSON.stringify({ confirm: true }) });
  await fetch(`${base}/api/git-config`, { method: 'POST', headers, body: JSON.stringify({ name: 'Demo Owner', email: 'owner@example.test' }) });
  const synced = await fetch(`${base}/api/projects/sync`, { method: 'POST', headers, body: JSON.stringify({ name: 'Actions app', slug: 'actions-app', repository: 'https://gitlab.com/example/web.git', branch: 'main', port: 3004, protocol: 'https' }) });
  assert.equal(synced.status, 200);
  await fetch(`${base}/api/projects/actions-app/environment`, { method: 'POST', headers, body: JSON.stringify({ content: 'NODE_ENV=production\n' }) });
  const url = `${base}/api/webhooks/actions/actions-app`;
  assert.equal((await fetch(url, { method: 'POST' })).status, 404);
  const configured = await fetch(`${base}/api/projects/actions-app/actions-hook`, { method: 'POST', headers, body: JSON.stringify({ action: 'rotate' }) });
  const { secret, project } = await configured.json();
  assert.equal(configured.status, 200);
  assert.equal(project.autoSync.enabled, true);
  assert.equal(project.autoSync.mode, 'actions');
  assert.equal(project.autoSync.hasActionsSecret, true);
  assert.equal(project.autoSync.encryptedActionsSecret, undefined);
  assert.equal((await fetch(url, { method: 'POST' })).status, 401);
  assert.equal((await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${'0'.repeat(64)}` } })).status, 401);
  revision = '2'.repeat(40);
  const readProject = async () => (await (await fetch(`${base}/api/projects`, { headers: { cookie } })).json()).projects.find((item) => item.slug === 'actions-app');
  let current;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    current = await readProject();
    if (current.sync.revision === revision) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(current.sync.revision, revision);
  assert.equal(current.deployment.state, 'idle');
  const manualSync = await fetch(`${base}/api/projects/sync`, { method: 'POST', headers, body: JSON.stringify({ name: 'Actions app', slug: 'actions-app', repository: 'https://gitlab.com/example/web.git', branch: 'main', port: 3004, protocol: 'https' }) });
  assert.equal((await manualSync.json()).activation, undefined);
  assert.equal((await readProject()).deployment.state, 'idle');
  assert.equal((await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${secret}` } })).status, 202);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    current = await readProject();
    if (current.deployment.state === 'active') break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(current.deployment.releases[0].revision, revision);
  const disabled = await fetch(`${base}/api/projects/actions-app/actions-hook`, { method: 'POST', headers, body: JSON.stringify({ action: 'disable' }) });
  assert.equal(disabled.status, 200);
  assert.equal((await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${secret}` } })).status, 404);
  assert.equal((await readProject()).autoSync.enabled, false);
  const polling = await fetch(`${base}/api/projects/actions-app/auto-sync`, { method: 'POST', headers, body: JSON.stringify({ enabled: true }) });
  assert.equal((await polling.json()).project.autoSync.mode, 'poll');
  revision = '3'.repeat(40);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    current = await readProject();
    if (current.deployment.releases[0]?.revision === revision) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(current.deployment.releases[0].revision, revision);
});

test('five-minute source polling updates commit state and only auto deploys a new commit when enabled', async (t) => {
  let revision = 'a'.repeat(40);
  const projectSyncer = async () => ({ status: 'synced', at: new Date().toISOString(), revision, detail: 'Repository checked.' });
  const { app, base } = await start({ autoSyncIntervalMs: 15, projectSyncer });
  t.after(() => app.close());
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'owner@local.test', password: 'correct-horse-battery-staple' }) });
  const session = await login.json();
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const headers = { cookie, 'content-type': 'application/json', 'x-csrf-token': session.csrfToken };
  await fetch(`${base}/api/tools/git/install`, { method: 'POST', headers, body: JSON.stringify({ confirm: true }) });
  await fetch(`${base}/api/git-config`, { method: 'POST', headers, body: JSON.stringify({ name: 'Demo Owner', email: 'owner@example.test' }) });
  await fetch(`${base}/api/projects/sync`, { method: 'POST', headers, body: JSON.stringify({ name: 'Auto app', slug: 'auto-app', repository: 'https://github.com/example/auto.git', branch: 'main', port: 3001, protocol: 'https' }) });
  await fetch(`${base}/api/projects/auto-app/environment`, { method: 'POST', headers, body: JSON.stringify({ content: 'NODE_ENV=production\n' }) });
  const configured = await fetch(`${base}/api/projects/auto-app/auto-sync`, { method: 'POST', headers, body: JSON.stringify({ enabled: true }) });
  assert.equal(configured.status, 200);
  assert.equal((await configured.json()).webhookSecret, undefined);
  await new Promise((resolve) => setTimeout(resolve, 35));
  let project = (await (await fetch(`${base}/api/projects`, { headers: { cookie } })).json()).projects.find((item) => item.slug === 'auto-app');
  assert.equal(project.deployment.state, 'idle');
  assert.equal(project.autoSync.lastResult.status, 'unchanged');

  revision = 'b'.repeat(40);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    project = (await (await fetch(`${base}/api/projects`, { headers: { cookie } })).json()).projects.find((item) => item.slug === 'auto-app');
    if (project.deployment?.state === 'active' && project.deployment.releases[0]?.revision === revision) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(project.deployment.state, 'active');
  assert.equal(project.autoSync.enabled, true);
  assert.equal(project.sync.revision, revision);
  assert.equal(project.deployment.releases[0].revision, revision);
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
  const projectHook = await fetch(`${base}/api/notification-hooks`, { method: 'POST', headers, body: JSON.stringify({ name: 'examples-deploy', provider: 'discord', endpoint: 'https://discord.com/api/webhooks/examples-secret', projectSlug: 'examples-app', events: ['deployment.succeeded'] }) });
  assert.equal(projectHook.status, 201);
  const allProjectsHook = await fetch(`${base}/api/notification-hooks`, { method: 'POST', headers, body: JSON.stringify({ name: 'all-deploys', provider: 'slack', endpoint: 'https://hooks.slack.com/services/all-projects-secret', projectSlug: '', events: ['deployment.failed'] }) });
  assert.equal(allProjectsHook.status, 201);
  const removed = await fetch(`${base}/api/projects/examples-app`, { method: 'DELETE', headers, body: '{}' });
  assert.equal(removed.status, 200);
  assert.deepEqual((await (await fetch(`${base}/api/projects`, { headers: { cookie } })).json()).projects, []);
  const remainingHooks = await fetch(`${base}/api/notification-hooks`, { headers: { cookie } });
  assert.deepEqual((await remainingHooks.json()).hooks.map((hook) => hook.name), ['all-deploys']);
  const audit = await fetch(`${base}/api/audit`, { headers: { cookie } });
  assert.ok((await audit.json()).events.some((event) => event.action === 'project.delete'));
});
