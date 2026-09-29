import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { hashPassword } from '../src/auth.mjs';
import { createRelease, beginDeployment } from '../src/native-project.mjs';
import { start, login, request } from './support/server.mjs';

const PASSWORD = 'Hardening-Test-Password-739!';
const password = hashPassword(PASSWORD);

async function fixture(t, permissions) {
  const { app, base } = await start({ autoSyncPollingEnabled: false });
  t.after(() => app.close());
  const organizationId = randomUUID();
  const userId = randomUUID();
  await app.store.update((state) => {
    state.organizations.push({ id: organizationId, name: 'Hardening' });
    state.users.push({ id: userId, email: 'hardening@example.test', password, role: 'user', status: 'active', authVersion: 1 });
    state.memberships.push({ userId, organizationId, permissions });
  });
  return { app, base, organizationId, master: await login(base), member: await login(base, 'hardening@example.test', PASSWORD) };
}

test('Anonymous invitation acceptance rejects invalid tokens and limits the twenty-first attempt', async (t) => {
  const { app, base } = await start();
  t.after(() => app.close());
  const usersBefore = app.store.snapshot().users.length;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = await request(base, '/api/invitations/accept', {}, 'POST', { token: `invalid-token-${attempt}`, password: PASSWORD, passwordConfirmation: PASSWORD });
    assert.equal(result.status, 410, `attempt ${attempt + 1}`);
  }
  assert.equal((await request(base, '/api/invitations/accept', {}, 'POST', { token: 'another-invalid-token', password: PASSWORD, passwordConfirmation: PASSWORD })).status, 429);
  assert.equal(app.store.snapshot().users.length, usersBefore);
});

test('Integration and audit grants without project.view cannot expose project records', async (t) => {
  const { app, base, organizationId, member } = await fixture(t, ['webhooks.manage', 'audit.read']);
  await app.store.update((state) => {
    state.projects.push({ name: 'hidden', slug: 'hidden', organizationId });
    state.monitorTokens.push({ id: randomUUID(), name: 'hidden-token', projectSlug: 'hidden', tokenHash: 'private' });
    state.notificationHooks.push({ id: randomUUID(), name: 'hidden-hook', projectSlug: 'hidden', events: ['deploy.succeeded'] });
    state.audit.push({ id: randomUUID(), at: new Date().toISOString(), action: 'project.hidden', target: 'hidden', projectSlug: 'hidden', organizationId });
  });
  assert.deepEqual((await request(base, '/api/projects', member)).body.projects, []);
  assert.deepEqual((await request(base, '/api/monitor-tokens', member)).body.tokens, []);
  assert.deepEqual((await request(base, '/api/notification-hooks', member)).body.hooks, []);
  assert.deepEqual((await request(base, '/api/audit', member)).body.events, []);
});

test('Source sync permission cannot trigger immediate auto deployment without deploy.start', async (t) => {
  const { app, base, organizationId, master, member } = await fixture(t, ['project.view', 'source.sync']);
  assert.equal((await request(base, '/api/tools/git/install', master, 'POST', { confirm: true })).status, 200);
  assert.equal((await request(base, '/api/git-config', master, 'POST', { name: 'Master', email: 'owner@example.test' })).status, 200);
  const configuration = { name: 'Sync only', slug: 'sync-only', organizationId, repository: 'https://example.test/app.git', branch: 'main', directory: '/', port: 3010, protocol: 'https' };
  assert.equal((await request(base, '/api/projects/sync', master, 'POST', configuration)).status, 200);
  assert.equal((await request(base, '/api/projects/sync-only/environment', master, 'POST', { content: 'NODE_ENV=production\n' })).status, 200);
  await app.store.update((state) => {
    state.projects.find((project) => project.slug === 'sync-only').autoSync = { enabled: true, mode: 'poll' };
  });
  const before = app.store.snapshot().projects.find((project) => project.slug === 'sync-only');
  const sync = await request(base, '/api/projects/sync', member, 'POST', configuration);
  assert.equal(sync.status, 200, JSON.stringify(sync));
  assert.equal(sync.body.activation, undefined);
  assert.equal(sync.body.job, undefined);
  const after = app.store.snapshot();
  assert.notEqual(after.projects.find((project) => project.slug === 'sync-only').sync.revision, before.sync.revision);
  assert.deepEqual(after.projects.find((project) => project.slug === 'sync-only').deployment, before.deployment);
  assert.equal(after.jobs.length, 0);
  const authorized = await request(base, '/api/projects/sync', master, 'POST', configuration);
  assert.equal(authorized.status, 200);
  assert.equal(authorized.body.activation, 'complete');
  assert.equal(authorized.body.project.deployment.state, 'active');
});

test('Project visibility without logs.read removes deployment failure output and events', async (t) => {
  const { app, base, organizationId, master, member } = await fixture(t, ['project.view']);
  await app.store.update((state) => {
    state.projects.push({ name: 'logs', slug: 'logs', organizationId, sync: { status: 'failed', detail: 'private-sync-detail' }, deployment: { state: 'failed', releases: [{ id: randomUUID(), failureLog: 'private-build-output', failure: 'private-failure-detail', events: [{ message: 'private-event-detail' }] }] } });
  });
  const limited = JSON.stringify((await request(base, '/api/projects', member)).body);
  for (const value of ['private-sync-detail', 'private-build-output', 'private-failure-detail', 'private-event-detail']) assert.equal(limited.includes(value), false, value);
  assert.equal((await request(base, '/api/projects/logs/logs', member)).status, 403);
  const complete = JSON.stringify((await request(base, '/api/projects', master)).body);
  assert.equal(complete.includes('private-build-output'), true);
});

test('A revoked queued deployment fails both its job and candidate after restart', async (t) => {
  const first = await start({ autoSyncPollingEnabled: false });
  const organizationId = randomUUID();
  const jobId = randomUUID();
  const missingUserId = randomUUID();
  const project = { name: 'Revoked queue', slug: 'revoked-queue', organizationId, organization: 'Revoked', repository: 'https://example.test/app.git', branch: 'main', directory: '/', port: 3021, runtime: 'node', environment: {} };
  const release = createRelease(project, 'revoked-revision');
  project.deployment = beginDeployment(null, release);
  try {
    await first.app.store.update((state) => {
      state.organizations.push({ id: organizationId, name: 'Revoked' });
      state.projects.push(project);
      state.jobs.push({ id: jobId, kind: 'deploy', projectSlug: project.slug, releaseId: release.id, status: 'queued', createdAt: new Date().toISOString(), initiatedByUserId: missingUserId, organizationId, events: [] });
    });
  } finally {
    await first.app.close();
  }
  const restarted = await start({ dataPath: first.dataPath, autoSyncPollingEnabled: false });
  t.after(() => restarted.app.close());
  for (let attempt = 0; attempt < 50 && restarted.app.store.snapshot().jobs.find((job) => job.id === jobId).status === 'queued'; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  const snapshot = restarted.app.store.snapshot();
  const job = snapshot.jobs.find((item) => item.id === jobId);
  const deployment = snapshot.projects.find((item) => item.slug === project.slug).deployment;
  assert.equal(job.status, 'failed');
  assert.match(job.failure, /permission was revoked/i);
  assert.equal(deployment.releases.find((item) => item.id === release.id).status, 'failed');
  assert.equal(deployment.state, 'failed');
  assert.equal(deployment.activeReleaseId, null);
});
