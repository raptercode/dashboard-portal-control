import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { start, login, request } from './support/server.mjs';

const releaseId = 'd22189ce-59a8-48fc-9b11-526ea43dce39';
async function fixture(t, helper) {
  const previous = process.env.HOSTMGR_DEPLOY_HELPER_SOCKET;
  process.env.HOSTMGR_DEPLOY_HELPER_SOCKET = '/fixture-restart.sock';
  const result = await start({ mode: 'host', autoSyncPollingEnabled: false, projectRestartHelper: helper, projectRuntimeProbe: async () => ({ state: 'active' }) });
  t.after(async () => { await result.app.close(); if (previous === undefined) delete process.env.HOSTMGR_DEPLOY_HELPER_SOCKET; else process.env.HOSTMGR_DEPLOY_HELPER_SOCKET = previous; });
  await result.app.store.update(state => state.projects.push({
    name: 'Restart fixture', slug: 'restart-fixture', runtime: 'node', port: 3000,
    sync: { status: 'failed', revision: 'new-commit' },
    environment: { keys: ['NEW_BUILD_SETTING'], encryptedContent: { private: 'saved-for-next-deploy' } },
    deployment: { state: 'active', activeReleaseId: releaseId, previousReleaseId: null, releases: [{ id: releaseId, status: 'active', revision: 'deployed-commit' }] }
  }));
  return { ...result, headers: await login(result.base) };
}

test('restart after a source failure preserves the active release and saved ENV, and blocks overlapping mutations', async t => {
  let finish;
  let called;
  const { app, base, headers } = await fixture(t, async (_socket, message) => { called = message; return new Promise(resolve => { finish = resolve; }); });
  const before = structuredClone(app.store.snapshot().projects[0]);
  const pending = request(base, '/api/projects/restart-fixture/restart', headers, 'POST', { confirm: true });
  for (let n = 0; !finish && n < 30; n++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(finish);
  assert.deepEqual(called, { operation: 'restart-project', slug: 'restart-fixture', releaseId });
  for (const action of ['restart', 'deploy', 'rollback', 'domains']) {
    assert.equal((await request(base, '/api/projects/restart-fixture/' + action, headers, 'POST', { confirm: true })).status, 400, action);
  }
  const syncing = await request(base, '/api/projects/sync', headers, 'POST', { slug: 'restart-fixture' });
  assert.equal(syncing.status, 400);
  assert.match(syncing.body.error, /Restart/);
  finish({ ok: true, state: 'active', releaseId });
  const result = await pending;
  assert.equal(result.status, 200);
  assert.equal(result.body.project.runtimeOperation.status, 'succeeded');
  assert.deepEqual(app.store.snapshot().projects[0].deployment, before.deployment);
  assert.deepEqual(app.store.snapshot().projects[0].environment, before.environment);
  assert.equal(app.store.snapshot().jobs.length, 0);
});

test('a restart failure is visible without leaking helper output or changing the active release', async t => {
  const { base, headers } = await fixture(t, async () => ({ ok: false, error: 'private-fixture-secret', buildOutput: 'private-fixture-secret' }));
  const result = await request(base, '/api/projects/restart-fixture/restart', headers, 'POST', { confirm: true });
  assert.equal(result.status, 422);
  assert.equal(result.body.project.runtimeOperation.status, 'failed');
  assert.equal(result.body.project.deployment.activeReleaseId, releaseId);
  assert.ok(!JSON.stringify(result.body).includes('private-fixture-secret'));
});

test('restart requires confirmation, an active release and a supported runtime', async t => {
  const { app, base, headers } = await fixture(t, async () => assert.fail('helper must not run'));
  const call = () => request(base, '/api/projects/restart-fixture/restart', headers, 'POST', { confirm: true });
  assert.equal((await request(base, '/api/projects/restart-fixture/restart', headers, 'POST', {})).status, 400);
  assert.equal((await request(base, '/api/projects/restart-fixture/restart', headers, 'POST', { confirm: true, releaseId: 'stale-release' })).status, 400);
  await app.store.update(state => { state.projects[0].runtime = 'docker-compose'; });
  assert.equal((await call()).status, 400);
  await app.store.update(state => { state.projects[0].runtime = 'node'; state.projects[0].deployment.activeReleaseId = null; });
  assert.equal((await call()).status, 400);
});

test('Portal startup marks an unfinished restart as unconfirmed instead of leaving the card permanently busy', async t => {
  const first = await start({ autoSyncPollingEnabled: false });
  await first.app.store.update(state => state.projects.push({ slug: 'interrupted-restart', name: 'Interrupted', deployment: { state: 'active', activeReleaseId: releaseId }, runtimeOperation: { kind: 'restart', status: 'running', releaseId } }));
  await first.app.close();
  const second = await start({ dataPath: first.dataPath, autoSyncPollingEnabled: false });
  t.after(() => second.app.close());
  const project = second.app.store.snapshot().projects[0];
  assert.equal(project.runtimeOperation.status, 'failed');
  assert.match(project.runtimeOperation.detail, /ยังยืนยันผลไม่ได้/);
  assert.ok(project.runtimeOperation.finishedAt);
  assert.equal(project.deployment.activeReleaseId, releaseId);
});

test('the root restart helper targets only the verified active systemd unit and never rewrites ENV or Nginx', async () => {
  const source = await readFile(new URL('../scripts/hostmgr-deploy-helper.mjs', import.meta.url), 'utf8');
  const restart = source.match(/async function restartProject\([^]*?\n\}/)[0];
  const calls = [];
  let target = '/releases/' + releaseId;
  const run = vm.runInNewContext(`(${restart})`, {
    loadProject: async () => ({ runtime: 'node', healthCheckEnabled: false, deployment: { state: 'active', activeReleaseId: releaseId } }),
    validateReleaseId() {}, projectIdentity: () => ({ current: '/current', releases: '/releases', service: 'hostmgr-project-fixture.service' }),
    readlink: async () => target, join: (...parts) => parts.join('/'),
    run: async (command, args) => calls.push([command, Array.from(args)]),
    checkWorkerProcess: async () => calls.push(['process-stability']), HelperError: Error
  });
  const result = await run('fixture', releaseId);
  assert.equal(result.state, 'active');
  assert.deepEqual(calls, [['/usr/bin/systemctl', ['restart', 'hostmgr-project-fixture.service']], ['process-stability']]);
  calls.length = 0;
  target = '/releases/different';
  await assert.rejects(run('fixture', releaseId), /does not match/);
  assert.deepEqual(calls, []);
});
