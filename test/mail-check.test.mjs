import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkSmtpOutbound, probeSmtpTarget, recommendOutboundPlan } from '../src/mail-check.mjs';
import { createApplication } from '../src/server.mjs';

function listen(handler) {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

async function freePort() {
  const { server, port } = await listen(() => {});
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test('SMTP probe requires the 220 greeting and classifies silent or refused endpoints', async (t) => {
  const greeting = await listen((socket) => socket.write('220 test.local ESMTP ready\r\n'));
  const silent = await listen(() => {});
  const chatty = await listen((socket) => socket.write('HTTP/1.1 400 Bad Request\r\n'));
  t.after(() => { greeting.server.close(); silent.server.close(); chatty.server.close(); });

  const open = await probeSmtpTarget('127.0.0.1', greeting.port, 2_000);
  assert.equal(open.status, 'open');
  assert.match(open.banner, /^220 test\.local/);

  assert.equal((await probeSmtpTarget('127.0.0.1', silent.port, 300)).status, 'filtered');
  assert.equal((await probeSmtpTarget('127.0.0.1', chatty.port, 2_000)).status, 'filtered');
  assert.equal((await probeSmtpTarget('127.0.0.1', await freePort(), 2_000)).status, 'blocked');
});

test('outbound check falls back to the second target and stops after the first greeting', async () => {
  const calls = [];
  const probe = async (host, port) => {
    calls.push(`${host}:${port}`);
    if (port === 25) return { host, port, status: 'blocked', latencyMs: 1 };
    if (host === 'first.example.test') return { host, port, status: 'filtered', latencyMs: 1 };
    return { host, port, status: 'open', banner: '220 relay', latencyMs: 1 };
  };
  const report = await checkSmtpOutbound({
    ports: [25, 587],
    targets: { 25: ['mx.example.test'], 587: ['first.example.test', 'second.example.test'] },
    probe
  });
  assert.deepEqual(report.ports.map((item) => `${item.port}=${item.status}`), ['25=blocked', '587=open']);
  assert.equal(report.ports[1].target, 'second.example.test');
  assert.equal(report.recommendation.mode, 'relay-587');
  assert.deepEqual(calls, ['mx.example.test:25', 'first.example.test:587', 'second.example.test:587']);
});

test('outbound recommendation covers direct, relay, and API-only plans', () => {
  const results = (open) => [25, 587, 2525].map((port) => ({ port, status: open.includes(port) ? 'open' : 'blocked' }));
  assert.equal(recommendOutboundPlan(results([25, 587, 2525])).mode, 'direct');
  assert.equal(recommendOutboundPlan(results([587, 2525])).mode, 'relay-587');
  assert.equal(recommendOutboundPlan(results([2525])).mode, 'relay-2525');
  assert.equal(recommendOutboundPlan(results([])).mode, 'api-only');
  // Filtered ports must not count as usable.
  assert.equal(recommendOutboundPlan([{ port: 25, status: 'filtered' }, { port: 587, status: 'filtered' }, { port: 2525, status: 'filtered' }]).mode, 'api-only');
});

test('mail outbound check API needs an owner session with CSRF and records an audit event', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'hostmgr-mail-'));
  const fixedReport = {
    checkedAt: '2026-08-15T00:00:00.000Z',
    ports: [{ port: 25, status: 'blocked', target: null, latencyMs: null, detail: 'Connection timed out.', attempts: [] }, { port: 587, status: 'open', target: 'smtp.example.test', latencyMs: 12, detail: null, attempts: [] }, { port: 2525, status: 'open', target: 'relay.example.test', latencyMs: 15, detail: null, attempts: [] }],
    recommendation: { mode: 'relay-587', usablePorts: [587, 2525], summary: 'test', requirements: [] }
  };
  const app = await createApplication({ dataPath: join(dir, 'state.sqlite'), password: 'correct-horse-battery-staple', secretKey: Buffer.alloc(32, 7).toString('base64'), mode: 'demo', sandboxClone: false, metricsEnabled: false, mailOutboundCheck: async () => fixedReport });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;

  const anonymous = await fetch(`${base}/api/mail/outbound-check`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(anonymous.status, 401);

  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'owner@local.test', password: 'correct-horse-battery-staple' }) });
  const session = await login.json();
  const cookie = login.headers.get('set-cookie').split(';')[0];

  const missingCsrf = await fetch(`${base}/api/mail/outbound-check`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '{}' });
  assert.equal(missingCsrf.status, 403);

  const checked = await fetch(`${base}/api/mail/outbound-check`, { method: 'POST', headers: { cookie, 'content-type': 'application/json', 'x-csrf-token': session.csrfToken }, body: '{}' });
  assert.equal(checked.status, 200);
  assert.deepEqual(await checked.json(), fixedReport);

  const audit = await (await fetch(`${base}/api/audit`, { headers: { cookie } })).json();
  const event = audit.events.find((item) => item.action === 'mail.outbound_check');
  assert.ok(event);
  assert.match(event.detail, /587=open/);
  assert.match(event.detail, /relay-587/);
});
