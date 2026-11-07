import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { InputError, validateNotificationHook } from '../src/core.mjs';
import { WebhookDestinationError, createPublicLookup, deliverWebhook, isPublicAddress, postWebhook, webhookHostProblem } from '../src/webhook-delivery.mjs';
import { start, login } from './support/server.mjs';

test('only addresses on the public Internet are accepted', () => {
  for (const address of ['93.184.216.34', '8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '2001:4860:4860::8888', '[2606:4700:4700::1111]']) assert.equal(isPublicAddress(address), true, address);
  for (const address of [
    '127.0.0.1', '127.255.255.254', '0.0.0.0', '10.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '224.0.0.1', '255.255.255.255', '198.18.0.1', '192.0.2.1',
    '::', '::1', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1', '2001:db8::1', '2002:7f00:1::', 'fec0::1',
    '::ffff:127.0.0.1', '::ffff:7f00:1', '::FFFF:10.1.2.3', '::ffff:169.254.169.254', '64:ff9b::7f00:1', '64:ff9b::192.168.0.1', '::127.0.0.1', '::ffff:0:7f00:1', '::ffff:0:0:7f00:1', '64:ff9b:1::7f00:1', '64:ff9b:1:ffff::1', '0:0:0:ffff:0:0:7f00:1', '4000::1', '3fff::1', '8000::1', 'e000::1', '1000::1',
    'fe80::1%eth0', 'localhost', '', 'not an ip', '1.2.3', null, undefined
  ]) assert.equal(isPublicAddress(address), false, String(address));
  // A mapped or NAT64 address is judged by the IPv4 address it carries, both ways.
  assert.equal(isPublicAddress('::ffff:8.8.8.8'), true);
  assert.equal(isPublicAddress('64:ff9b::808:808'), true);
});

test('a webhook host is refused early when it can only mean a private network', () => {
  for (const host of ['discord.com', 'hooks.slack.com', 'chat.googleapis.com', 'example.co.th', '93.184.216.34', '[2606:4700:4700::1111]']) assert.equal(webhookHostProblem(host), null, host);
  for (const host of ['localhost', 'LOCALHOST', 'app.localhost', 'printer.local', 'nas.lan', 'router.home.arpa', 'db.internal', 'intranet', 'server', 'x.corp', '127.0.0.1', '169.254.169.254', '10.0.0.5', '[::1]', '[::ffff:7f00:1]', 'localhost.', '']) assert.ok(webhookHostProblem(host), host);
});

test('saving a hook refuses a private destination unless the host owner opted in', () => {
  const hook = (endpoint) => ({ name: 'ops', provider: 'generic', endpoint, events: ['deployment.failed'] });
  assert.equal(validateNotificationHook(hook('https://discord.com/api/webhooks/1/abc')).endpoint, 'https://discord.com/api/webhooks/1/abc');
  for (const endpoint of ['https://127.0.0.1:3100/api/health', 'https://169.254.169.254/latest/meta-data/', 'https://[::1]/hook', 'https://localhost/hook', 'https://2130706433/hook', 'https://0x7f.1/hook', 'https://10.0.0.8/hook', 'https://nas.lan/hook']) {
    assert.throws(() => validateNotificationHook(hook(endpoint)), InputError, endpoint);
    assert.equal(validateNotificationHook(hook(endpoint), { allowPrivate: true }).provider, 'generic', `opt-in: ${endpoint}`);
  }
});

test('the connection lookup refuses a name with any non-public answer and hands back only checked addresses', async () => {
  const answering = (...addresses) => (_host, _options, callback) => callback(null, addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })));
  const resolve = (lookup, options = {}, allowPrivate = false) => new Promise((done) => createPublicLookup({ lookup, allowPrivate })('hook.example.test', options, (...args) => done(args)));
  assert.deepEqual(await resolve(answering('93.184.216.34')), [null, '93.184.216.34', 4]);
  assert.deepEqual(await resolve(answering('93.184.216.34', '2606:4700::1111'), { all: true }), [null, [{ address: '93.184.216.34', family: 4 }, { address: '2606:4700::1111', family: 6 }]]);
  for (const lookup of [answering('127.0.0.1'), answering('93.184.216.34', '10.0.0.1'), answering('::ffff:169.254.169.254'), answering()]) {
    const [error] = await resolve(lookup);
    assert.ok(error instanceof WebhookDestinationError);
  }
  assert.deepEqual(await resolve(answering('10.0.0.1'), {}, true), [null, '10.0.0.1', 4]);
  const [failure] = await resolve((_h, _o, callback) => callback(new Error('ENOTFOUND')));
  assert.equal(failure.message, 'ENOTFOUND');
  // A plain callback form, as dns.lookup allows, works too.
  assert.deepEqual(await new Promise((done) => createPublicLookup({ lookup: answering('93.184.216.34') })('hook.example.test', (...args) => done(args))), [null, '93.184.216.34', 4]);
});

function fakeRequest(statusCode, { log = [], location } = {}) {
  return (url, options, onResponse) => {
    const outgoing = new EventEmitter();
    outgoing.destroy = (error) => { outgoing.destroyed = true; if (error) queueMicrotask(() => outgoing.emit('error', error)); outgoing.emit('close'); };
    outgoing.end = (body) => {
      log.push({ url: String(url), options, body: body.toString() });
      const response = new EventEmitter();
      response.statusCode = statusCode;
      response.headers = location ? { location } : {};
      response.destroy = () => { response.destroyed = true; };
      queueMicrotask(() => { onResponse(response); response.emit('data', Buffer.from('ignored')); response.emit('end'); outgoing.emit('close'); });
    };
    return outgoing;
  };
}

test('delivery posts JSON, reports only the status, and never follows a redirect', async () => {
  const log = [];
  const result = await postWebhook('https://discord.com/api/webhooks/1/abc', { hello: 'world' }, { request: fakeRequest(204, { log }) });
  assert.deepEqual(result, { status: 204 });
  assert.equal(log.length, 1);
  assert.equal(log[0].options.method, 'POST');
  assert.equal(log[0].options.agent, false);
  assert.equal(log[0].options.headers['user-agent'], 'Strckro', 'fetch sent a User-Agent and some webhook hosts refuse a request without one');
  assert.equal(log[0].options.headers['content-type'], 'application/json');
  assert.equal(log[0].options.headers['content-length'], Buffer.byteLength('{"hello":"world"}'));
  assert.equal(log[0].body, '{"hello":"world"}');
  assert.equal(typeof log[0].options.lookup, 'function');
  const redirectLog = [];
  const redirected = await postWebhook('https://discord.com/hook', {}, { request: fakeRequest(302, { log: redirectLog, location: 'https://169.254.169.254/' }) });
  assert.deepEqual(redirected, { status: 302 });
  assert.equal(redirectLog.length, 1, 'a redirect is a status, not a second request');
});

test('delivery refuses non-HTTPS, malformed and non-public destinations before any connection', async () => {
  const log = [];
  const request = fakeRequest(200, { log });
  for (const endpoint of ['http://discord.com/hook', 'ftp://discord.com/hook', 'not a url', 'https://127.0.0.1:3100/api/health', 'https://169.254.169.254/latest', 'https://[::1]/', 'https://localhost/', 'https://nas.lan/hook', 'https://[::ffff:7f00:1]/']) {
    await assert.rejects(postWebhook(endpoint, {}, { request }), WebhookDestinationError, endpoint);
  }
  assert.equal(log.length, 0, 'nothing was sent');
  assert.deepEqual(await postWebhook('https://10.0.0.8/hook', {}, { request, allowPrivate: true }), { status: 200 });
});

test('a name that resolves to a private address is refused at connect time with the real HTTPS stack', async () => {
  const privateLookup = (_host, _options, callback) => callback(null, [{ address: '127.0.0.1', family: 4 }]);
  await assert.rejects(postWebhook('https://rebind.example.test/hook', {}, { lookup: privateLookup, timeoutMs: 3000 }), WebhookDestinationError);
});

test('a hung destination is cut off at the deadline', async () => {
  const hung = (_url, _options) => {
    const outgoing = new EventEmitter();
    outgoing.destroy = (error) => { queueMicrotask(() => outgoing.emit('error', error)); outgoing.emit('close'); };
    outgoing.end = () => {};
    return outgoing;
  };
  await assert.rejects(postWebhook('https://discord.com/hook', {}, { request: hung, timeoutMs: 50 }), /timed out/);
});

test('the server refuses to save a private webhook and accepts a public one', async (t) => {
  const { app, base } = await start({ autoSyncPollingEnabled: false });
  t.after(() => app.close());
  const headers = await login(base);
  const create = (endpoint, name) => fetch(`${base}/api/notification-hooks`, { method: 'POST', headers, body: JSON.stringify({ name, provider: 'discord', endpoint, projectSlug: '', events: ['deployment.succeeded', 'deployment.failed'] }) });
  for (const [index, endpoint] of ['https://127.0.0.1:3100/api/health', 'https://169.254.169.254/latest/meta-data/', 'https://router.lan/hook'].entries()) {
    const refused = await create(endpoint, `bad-${index}`);
    assert.equal(refused.status, 400, endpoint);
    assert.match((await refused.json()).error, /public/);
  }
  assert.equal((await create('https://discord.com/api/webhooks/1/abc', 'good')).status, 201);
});

test('a host owner who opts in can notify a private network', async (t) => {
  const { app, base } = await start({ autoSyncPollingEnabled: false, webhookAllowPrivate: true });
  t.after(() => app.close());
  const headers = await login(base);
  const created = await fetch(`${base}/api/notification-hooks`, { method: 'POST', headers, body: JSON.stringify({ name: 'lan', provider: 'generic', endpoint: 'https://10.0.0.8/hook', projectSlug: '', events: ['deployment.failed'] }) });
  assert.equal(created.status, 201);
});

test('a delivery is recorded as sent or failed, and a refused destination is named without the target error', async () => {
  const calls = [];
  const sender = (status) => async (endpoint, payload, options) => { calls.push({ endpoint, payload, options }); return { status }; };
  const options = { allowPrivate: false, timeoutMs: 8000 };
  assert.deepEqual(await deliverWebhook(sender(204), 'https://discord.com/hook', { a: 1 }, options), { status: 'sent', httpStatus: 204 });
  assert.deepEqual(await deliverWebhook(sender(200), 'https://discord.com/hook', {}, options), { status: 'sent', httpStatus: 200 });
  assert.deepEqual(await deliverWebhook(sender(302), 'https://discord.com/hook', {}, options), { status: 'failed', httpStatus: 302 });
  assert.deepEqual(await deliverWebhook(sender(500), 'https://discord.com/hook', {}, options), { status: 'failed', httpStatus: 500 });
  assert.deepEqual(calls[0], { endpoint: 'https://discord.com/hook', payload: { a: 1 }, options });
  const refuse = async () => { throw new WebhookDestinationError(); };
  assert.deepEqual(await deliverWebhook(refuse, 'https://hooks.example.test/in', {}, options), { status: 'failed', httpStatus: null, reason: 'destination-not-public' });
  // A bad URL is named differently from a refused destination, so the owner knows what to fix.
  for (const endpoint of ['http://discord.com/hook', 'not a url']) {
    const error = await postWebhook(endpoint, {}, { request: fakeRequest(200) }).catch((failure) => failure);
    assert.ok(error instanceof WebhookDestinationError);
    assert.deepEqual(await deliverWebhook(async () => { throw error; }, endpoint, {}, options), { status: 'failed', httpStatus: null, reason: 'invalid-url' }, endpoint);
  }
  const refusedHost = await postWebhook('https://127.0.0.1/', {}, { request: fakeRequest(200) }).catch((failure) => failure);
  assert.equal(refusedHost.reason, 'destination-not-public');
  const unreachable = async () => { throw Object.assign(new Error('connect ECONNREFUSED 10.0.0.9:443'), { code: 'ECONNREFUSED' }); };
  const outcome = await deliverWebhook(unreachable, 'https://hooks.example.test/in', {}, options);
  assert.deepEqual(outcome, { status: 'failed', httpStatus: null });
  assert.equal(JSON.stringify(outcome).includes('ECONNREFUSED'), false, 'the target error is not stored where a member can read it');
});

test('the server sends every notification through the checked sender', async () => {
  const server = await readFile(new URL('../src/server.mjs', import.meta.url), 'utf8');
  assert.match(server, /options\.webhookSender \?\? postWebhook/);
  assert.match(server, /deliverWebhook\(webhookSender, endpoint,/);
  assert.match(server, /allowPrivate: webhookAllowPrivate/);
  assert.doesNotMatch(server, /await fetch\(endpoint/, 'notifications must not use a bare fetch, which follows redirects and resolves names unchecked');
});
