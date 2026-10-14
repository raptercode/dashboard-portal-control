import test from 'node:test';
import assert from 'node:assert/strict';
import { start, login, request } from './support/server.mjs';
import { MaintenanceLockError } from '../scripts/maintenance-lock.mjs';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StateStore } from '../src/core.mjs';

const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
function control() {
  const state = { busy: false, held: 0, released: 0 };
  state.acquire = async () => {
    if (state.busy) throw new MaintenanceLockError('maintenance busy', 'MAINTENANCE_BUSY');
    state.held++;
    let released = false;
    return { assertHeld() { assert.equal(released, false); }, async release() { if (!released) { released = true; state.held--; state.released++; } } };
  };
  return state;
}

test('queued deployment retry defers under maintenance and does not reschedule after close', { timeout: 10000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'portal-queue-maintenance-'));
  const dataPath = join(directory, 'state.sqlite');
  // StateStore retains SQLite handles until process exit, as do the standard
  // server fixtures. Windows cannot unlink an open SQLite file.
  if (process.platform !== 'win32') t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new StateStore(dataPath);
  await store.load();
  await store.update((state) => { state.jobs.push({ id: 'queued-fixture', projectSlug: 'queued-app', status: 'queued', createdAt: new Date().toISOString() }); });
  let attempts = 0;
  const attempted = deferred();
  const { app } = await start({ dataPath, mode: 'host', autoSyncPollingEnabled: false,
    acquireMaintenanceLease: async () => { attempts++; attempted.resolve(); throw new MaintenanceLockError('maintenance busy', 'MAINTENANCE_BUSY'); } });
  t.after(() => app.server.listening ? app.close() : undefined);
  await attempted.promise;
  assert.equal(app.store.snapshot().jobs[0].status, 'queued');
  await app.close();
  await delay(1200);
  assert.equal(attempts, 1);
  assert.equal(app.store.snapshot().jobs[0].status, 'queued');
});

test('background source poll defers while busy, holds lease through sync and stops after close', { timeout: 10000 }, async (t) => {
  const lock = control();
  lock.busy = true;
  let syncs = 0;
  const entered = deferred(); const resume = deferred(); const completed = deferred();
  const { app } = await start({ mode: 'host', acquireMaintenanceLease: lock.acquire, autoSyncIntervalMs: 40,
    projectSyncer: async () => { syncs++; entered.resolve(); await resume.promise; assert.ok(lock.held > 0); completed.resolve(); return { status: 'synced', at: new Date().toISOString(), revision: 'same', detail: 'fixture' }; } });
  t.after(() => app.server.listening ? app.close() : undefined);
  await app.store.update((state) => { state.projects.push({ slug: 'poll-app', name: 'Poll', sync: { revision: 'same' }, autoSync: { enabled: false }, deployment: { state: 'idle', releases: [] } }); });
  await delay(120);
  assert.equal(syncs, 0);
  lock.busy = false;
  await entered.promise;
  assert.ok(lock.held > 0);
  // Stop new work while the first callback is deliberately in progress.
  await app.close();
  resume.resolve();
  await completed.promise;
  await delay(120);
  assert.equal(syncs, 1);
  assert.equal(lock.held, 0);
});

test('host maintenance rejects HTTP mutations with 503 and preserves state while reads remain available', async (t) => {
  const lock = control();
  const { app, base } = await start({ mode: 'host', acquireMaintenanceLease: lock.acquire, autoSyncPollingEnabled: false });
  t.after(() => app.close());
  const headers = await login(base);
  await new Promise((resolve) => setImmediate(resolve));
  const before = app.store.snapshot();
  lock.busy = true;
  const result = await request(base, '/api/organizations', headers, 'POST', { name: 'Blocked organization' });
  assert.equal(result.status, 503);
  assert.deepEqual(app.store.snapshot(), before);
  assert.equal((await request(base, '/api/health')).status, 200);
  assert.equal(lock.held, 0);
});

test('monitor GET usage persistence respects maintenance and resumes after the lease is available', async (t) => {
  const lock = control();
  const { app, base } = await start({ mode: 'host', acquireMaintenanceLease: lock.acquire, autoSyncPollingEnabled: false });
  t.after(() => app.close());
  const headers = await login(base);
  await app.store.update(state => { state.projects.push({ slug: 'monitor-lease-app', name: 'Monitor lease', organizationId: state.organizations[0].id, deployment: { state: 'idle', releases: [] } }); });
  const created = await request(base, '/api/monitor-tokens', headers, 'POST', { name: 'lease-monitor', projectSlug: 'monitor-lease-app' });
  assert.equal(created.status, 201);
  await new Promise(resolve => setImmediate(resolve));
  const before = app.store.snapshot();
  lock.busy = true;
  const url = '/api/monitor/v1/projects/monitor-lease-app/deployments';
  const bearer = { authorization: `Bearer ${created.body.token}` };
  assert.equal((await request(base, url, bearer)).status, 503);
  assert.deepEqual(app.store.snapshot(), before);
  assert.equal(lock.held, 0);
  lock.busy = false;
  assert.equal((await request(base, url, bearer)).status, 200);
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(app.store.snapshot().monitorTokens[0].lastUsedAt);
  assert.equal(lock.held, 0);
  assert.equal((await request(base, url, { authorization: 'Bearer dpm_invalid' })).status, 403);
});

for (const fail of [false, true]) {
  test(`HTTP lease remains held through asynchronous DNS callback and releases after ${fail ? 'exception' : 'success'}`, async (t) => {
    const lock = control();
    const entered = deferred(); const resume = deferred();
    const { app, base } = await start({ mode: 'host', acquireMaintenanceLease: lock.acquire, autoSyncPollingEnabled: false,
      domainDnsCheck: async () => { entered.resolve(); await resume.promise; assert.ok(lock.held > 0); if (fail) throw new Error('fixture DNS failure'); return { status: 'passed', records: [] }; } });
    t.after(() => app.close());
    const headers = await login(base);
    await app.store.update((state) => { state.projects.push({ slug: 'leased-app', name: 'Leased', organizationId: state.organizations[0].id, domains: { hosts: ['leased.example.test'] }, deployment: { state: 'idle', releases: [] } }); });
    const pending = request(base, '/api/projects/leased-app/domains/check', headers, 'POST', { hostname: 'leased.example.test' });
    await entered.promise;
    assert.ok(lock.held > 0);
    resume.resolve();
    await pending;
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(lock.held, 0);
  });
}
