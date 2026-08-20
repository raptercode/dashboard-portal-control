import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from '../src/server.mjs';

test('mail readiness stores separate outbound and inbound evidence without claiming external SMTP reachability', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'hostmgr-mail-ready-'));
  const app = await createApplication({
    dataPath: join(dir, 'state.sqlite'), password: 'correct-horse-battery-staple', secretKey: Buffer.alloc(32, 7).toString('base64'), mode: 'demo', sandboxClone: false, metricsEnabled: false,
    mailOutboundCheck: async () => ({ checkedAt: '2026-08-21T00:00:00.000Z', ports: [{ port: 25, status: 'blocked' }, { port: 587, status: 'open' }, { port: 2525, status: 'blocked' }], recommendation: { mode: 'relay-587' } }),
    mailInboundCheck: async () => ({ scope: 'local-firewall', checkedAt: '2026-08-21T00:00:00.000Z', externalReachability: 'unverified', ports: [{ port: 25, status: 'blocked', source: 'ufw' }, { port: 587, status: 'allowed', source: 'ufw' }, { port: 993, status: 'unknown', source: 'ufw' }] })
  });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'owner@local.test', password: 'correct-horse-battery-staple' }) });
  const session = await login.json();
  const headers = { cookie: login.headers.get('set-cookie').split(';')[0], 'content-type': 'application/json', 'x-csrf-token': session.csrfToken };
  const response = await fetch(`${base}/api/mail/readiness-check`, { method: 'POST', headers, body: '{}' });
  assert.equal(response.status, 200);
  const report = await response.json();
  assert.equal(report.outbound.recommendation.mode, 'relay-587');
  assert.equal(report.inbound.externalReachability, 'unverified');
  const settings = await (await fetch(`${base}/api/mail`, { headers: { cookie: headers.cookie } })).json();
  assert.equal(settings.mail.readiness.inbound.ports[1].status, 'allowed');
});
