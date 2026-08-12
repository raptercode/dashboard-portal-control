import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InputError, StateStore } from '../src/core.mjs';
import { publicMetricSample, resetCpuSampleState, sampleCpuPercent, validateMetricRangeDays } from '../src/metrics.mjs';
import { createApplication } from '../src/server.mjs';

test('metric ranges accept only the supported day windows', () => {
  assert.equal(validateMetricRangeDays('7'), 7);
  assert.equal(validateMetricRangeDays(30), 30);
  assert.throws(() => validateMetricRangeDays('2'), InputError);
});

test('cpu sampler returns a bounded percent across two readings', () => {
  resetCpuSampleState();
  const first = [
    { times: { user: 100, nice: 0, sys: 50, idle: 850, irq: 0 } },
    { times: { user: 100, nice: 0, sys: 50, idle: 850, irq: 0 } }
  ];
  const second = [
    { times: { user: 200, nice: 0, sys: 100, idle: 900, irq: 0 } },
    { times: { user: 200, nice: 0, sys: 100, idle: 900, irq: 0 } }
  ];
  assert.equal(sampleCpuPercent(() => first), 0);
  const percent = sampleCpuPercent(() => second);
  assert.ok(percent > 0 && percent <= 100);
});

test('metric samples persist, list by range, and prune beyond retention', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hostmgr-metrics-'));
  const store = new StateStore(join(dir, 'state.sqlite'));
  await store.load();
  const now = Date.now();
  store.recordMetricSample({ at: now - 40 * 24 * 60 * 60 * 1000, cpuPercent: 10, memoryUsedBytes: 1, memoryTotalBytes: 10, diskUsedBytes: 2, diskTotalBytes: 10 });
  store.recordMetricSample({ at: now - 60_000, cpuPercent: 20, memoryUsedBytes: 3, memoryTotalBytes: 10, diskUsedBytes: 4, diskTotalBytes: 10 });
  store.recordMetricSample({ at: now, cpuPercent: 30, memoryUsedBytes: 5, memoryTotalBytes: 10, diskUsedBytes: 6, diskTotalBytes: 10 });
  store.pruneMetricSamples(now - 30 * 24 * 60 * 60 * 1000);
  const samples = store.listMetricSamples(now - 7 * 24 * 60 * 60 * 1000);
  assert.equal(samples.length, 2);
  assert.equal(publicMetricSample(samples[1]).memoryPercent, 50);
});

test('metrics API requires a session and returns the selected range', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'hostmgr-metrics-api-'));
  let app;
  t.after(async () => {
    if (app) await app.close().catch(() => {});
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  });
  app = await createApplication({
    dataPath: join(dir, 'state.sqlite'),
    password: 'correct-horse-battery-staple',
    secretKey: Buffer.alloc(32, 9).toString('base64'),
    mode: 'demo',
    sandboxClone: false,
    metricsEnabled: false
  });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  assert.equal((await fetch(`${base}/api/metrics?range=7`)).status, 401);
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'owner@local.test', password: 'correct-horse-battery-staple' }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const rejected = await fetch(`${base}/api/metrics?range=2`, { headers: { cookie } });
  assert.equal(rejected.status, 400);
  const ok = await fetch(`${base}/api/metrics?range=7`, { headers: { cookie } });
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(body.rangeDays, 7);
  assert.equal(body.retentionDays, 30);
  assert.equal(body.intervalMinutes, 5);
  assert.ok(Array.isArray(body.samples));
  assert.ok(body.current);
  assert.equal(typeof body.current.cpuPercent, 'number');
});
