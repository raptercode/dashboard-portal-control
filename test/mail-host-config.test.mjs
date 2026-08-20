import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMailPortPlan, renderDovecotConfiguration, renderPostfixMain, renderPostfixMaster } from '../scripts/mail-host-config.mjs';

const outbound = { ports: [{ port: 25, status: 'open' }, { port: 587, status: 'open' }, { port: 2525, status: 'blocked' }] };

test('mail port plan only enables locally permitted inbound services', () => {
  const plan = buildMailPortPlan({
    outboundMode: 'relay-587',
    outbound,
    inbound: { externalReachability: 'unverified', ports: [{ port: 25, status: 'blocked' }, { port: 587, status: 'allowed' }, { port: 993, status: 'unknown' }] }
  });
  assert.equal(plan.outboundPort, 587);
  assert.deepEqual(plan.inbound, { smtp: false, submission: true, imaps: false });
  assert.deepEqual(plan.disabledPorts, [25, 993]);
  assert.throws(() => buildMailPortPlan({ outboundMode: 'direct', outbound: { ports: [{ port: 25, status: 'blocked' }] }, inbound: { ports: [] } }), /not confirmed open/);
});

test('mail templates never create SMTP or IMAPS listeners for blocked or unknown ports', () => {
  const plan = buildMailPortPlan({
    outboundMode: 'relay-587',
    outbound,
    inbound: { ports: [{ port: 25, status: 'blocked' }, { port: 587, status: 'unknown' }, { port: 993, status: 'blocked' }] }
  });
  const main = renderPostfixMain({ hostname: 'mail.example.test', domains: ['example.test'], outboundMode: 'relay-587', relay: { host: 'smtp.example.test', port: 587 }, plan });
  assert.match(main, /inet_interfaces = loopback-only/);
  assert.match(main, /reject_unauth_destination/);
  assert.doesNotMatch(renderPostfixMaster(plan), /^smtp\s+inet/m);
  assert.doesNotMatch(renderPostfixMaster(plan), /^submission\s+inet/m);
  assert.match(renderPostfixMaster(plan), /^127\.0\.0\.1:25 inet/m);
  assert.match(renderDovecotConfiguration({ plan }), /listen = 127\.0\.0\.1/);
});
