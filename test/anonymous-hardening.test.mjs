import test from 'node:test';
import assert from 'node:assert/strict';
import { connect } from 'node:net';
import { StateStore } from '../src/core.mjs';
import { createFailureWindow } from '../src/failure-window.mjs';
import { GateFullError, createGate, hashPassword, verifyPassword, verifyPasswordAsync } from '../src/auth.mjs';
import { start, login, OWNER_PASSWORD } from './support/server.mjs';

const TOKEN = 'f3a9'.repeat(16);
const stamped = (ip) => ({ 'x-real-ip': ip, 'x-strckro-proxy-token': TOKEN });
const post = (base, path, body = {}, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const signIn = (base, email, password, headers = {}) => post(base, '/api/login', { email, password }, headers);

test('the failure window counts only failures, expires, clears, and drops the oldest key when full', () => {
  let now = 1_000;
  const window = createFailureWindow({ windowMs: 100, maxKeys: 3, now: () => now });
  assert.equal(window.blocked('a', 2), false);
  window.fail('a'); assert.equal(window.blocked('a', 2), false);
  window.fail('a'); assert.equal(window.blocked('a', 2), true);
  assert.equal(window.blocked('b', 2), false, 'keys are independent');
  now += 100;
  assert.equal(window.blocked('a', 2), false, 'the window expires');
  window.fail('a'); window.fail('a'); window.clear('a');
  assert.equal(window.blocked('a', 2), false, 'a success clears the key');
  for (const key of ['k1', 'k2', 'k3', 'k4']) window.fail(key);
  assert.equal(window.size, 3);
  window.fail('k4');
  assert.equal(window.blocked('k4', 2), true, 'the newest key is kept, never refused');
  window.fail('k1'); assert.equal(window.blocked('k1', 2), false, 'the oldest key was dropped and starts again');
});

test('requests with no valid credential never clone or write the state', async (t) => {
  const { app, base } = await start();
  t.after(() => app.close());
  await new Promise((resolve) => setTimeout(resolve, 100));
  const snapshot = t.mock.method(StateStore.prototype, 'snapshot');
  const update = t.mock.method(StateStore.prototype, 'update');
  const before = [snapshot.mock.callCount(), update.mock.callCount()];
  const bearer = (value) => ({ authorization: `Bearer ${value}` });
  const statuses = [
    (await fetch(`${base}/api/session`)).status,
    (await fetch(`${base}/api/projects`)).status,
    (await fetch(`${base}/api/projects`, { headers: { cookie: `hostmgr_session=${'x'.repeat(43)}` } })).status,
    (await fetch(`${base}/api/projects`, { headers: bearer(`dp_${'A'.repeat(43)}`) })).status,
    (await fetch(`${base}/api/projects`, { headers: bearer('not-a-token') })).status,
    (await post(base, '/api/webhooks/github/ghost')).status,
    (await post(base, '/api/webhooks/actions/ghost')).status,
    (await fetch(`${base}/api/monitor/v1/projects/ghost/deployments`, { headers: bearer(`dpm_${'x'.repeat(43)}`) })).status,
    (await post(base, '/api/cli/device/poll', { deviceCode: 'A'.repeat(43) })).status
  ];
  assert.deepEqual(statuses, [200, 401, 401, 401, 401, 404, 404, 403, 410]);
  assert.deepEqual([snapshot.mock.callCount(), update.mock.callCount()], before, 'no clone and no write for a stranger');
});

test('a signed-in session still works without cloning the state to find it', async (t) => {
  const { app, base } = await start();
  t.after(() => app.close());
  const headers = await login(base);
  assert.equal((await fetch(`${base}/api/projects`, { headers })).status, 200);
  const session = await (await fetch(`${base}/api/session`, { headers })).json();
  assert.equal(session.authenticated, true);
  assert.equal(session.user.email, 'owner@local.test');
  // The user handed to a request is a copy: changing it cannot change the stored account.
  assert.equal((await post(base, '/api/logout', {}, headers)).status, 200);
  assert.equal((await fetch(`${base}/api/projects`, { headers })).status, 401);
});

test('polling a CLI login pays for a write only when it can change something', async (t) => {
  const { app, base } = await start();
  t.after(() => app.close());
  const started = await (await post(base, '/api/cli/device/start', {})).json();
  const update = t.mock.method(StateStore.prototype, 'update');
  const poll = (deviceCode = started.deviceCode) => post(base, '/api/cli/device/poll', { deviceCode });
  assert.equal((await poll()).status, 200);
  assert.equal(update.mock.callCount(), 1, 'the first poll records when the next one is allowed');
  assert.equal((await poll()).status, 429);
  assert.equal((await poll()).status, 429);
  assert.equal((await poll('B'.repeat(43))).status, 410);
  assert.equal(update.mock.callCount(), 1, 'too-early and unknown polls are refused from a read');
});

test('polling is limited per visitor', async (t) => {
  const { app, base } = await start({ proxyToken: TOKEN });
  t.after(() => app.close());
  const poll = (headers) => post(base, '/api/cli/device/poll', { deviceCode: 'C'.repeat(43) }, headers);
  for (let sent = 0; sent < 1200; sent += 100) assert.ok((await Promise.all(Array.from({ length: 100 }, () => poll(stamped('203.0.113.7'))))).every((response) => response.status === 410));
  assert.equal((await poll(stamped('203.0.113.7'))).status, 429);
  assert.equal((await poll(stamped('198.51.100.9'))).status, 410, 'another visitor is not affected');
});

test('guesses spread over many addresses are still bounded per account, existing or not', async (t) => {
  const { app, base } = await start({ proxyToken: TOKEN });
  t.after(() => app.close());
  const refusals = [];
  for (const [index, email] of ['owner@local.test', 'ghost@example.test'].entries()) {
    // At most four failures from any one address, so only the account counter can stop the tenth.
    for (let guess = 0; guess < 10; guess += 1) assert.equal((await signIn(base, email, 'wrong-password-123', stamped(`203.0.113.${index * 10 + 1 + Math.floor(guess / 4)}`))).status, 401);
    const fresh = await signIn(base, email, OWNER_PASSWORD, stamped(`198.51.100.${77 + index}`));
    refusals.push([fresh.status, await fresh.json()]);
  }
  assert.equal(refusals[0][0], 429, 'even the right password is refused while the account is locked');
  assert.deepEqual(refusals[1], refusals[0], 'a made-up email is refused exactly like a real one');
});

test('an account that was not locked can still sign in, and success clears its count', async (t) => {
  const { app, base } = await start({ proxyToken: TOKEN });
  t.after(() => app.close());
  for (let round = 0; round < 3; round += 1) {
    for (let guess = 0; guess < 4; guess += 1) assert.equal((await signIn(base, 'owner@local.test', 'wrong-password-123', stamped(`203.0.113.${round + 1}`))).status, 401);
    assert.equal((await signIn(base, 'owner@local.test', OWNER_PASSWORD, stamped('198.51.100.9'))).status, 200);
  }
});

test('an unknown email takes about as long to refuse as a wrong password', async (t) => {
  const { app, base } = await start({ proxyToken: TOKEN });
  t.after(() => app.close());
  const median = async (email) => {
    const durations = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const begun = process.hrtime.bigint();
      assert.equal((await signIn(base, email, 'wrong-password-123', stamped(`203.0.113.${attempt + 10}`))).status, 401);
      durations.push(Number(process.hrtime.bigint() - begun) / 1e6);
    }
    return durations.sort((a, b) => a - b)[2];
  };
  const wrong = await median('owner@local.test');
  const unknown = await median('ghost@example.test');
  // A scrypt verification dominates both. Before the fix an unknown email returned in about a
  // twentieth of the time; allow generous jitter either way.
  assert.ok(unknown > wrong * 0.4, `unknown email ${unknown.toFixed(1)}ms vs wrong password ${wrong.toFixed(1)}ms`);
});

test('guessing the installer password at first run is throttled per visitor and overall', async (t) => {
  process.env.HOSTMGR_ADMIN_PASSWORD = 'Installer-Password-1';
  t.after(() => { delete process.env.HOSTMGR_ADMIN_PASSWORD; });
  const { app, base } = await start({ password: undefined, proxyToken: TOKEN });
  t.after(() => app.close());
  const bootstrap = (currentPassword, headers) => post(base, '/api/bootstrap', { email: 'owner@example.com', password: 'ValidPass123!', confirmPassword: 'ValidPass123!', currentPassword }, headers);
  for (let guess = 0; guess < 5; guess += 1) assert.equal((await bootstrap('wrong-installer-1', stamped('203.0.113.1'))).status, 401);
  assert.equal((await bootstrap('Installer-Password-1', stamped('203.0.113.1'))).status, 429, 'one visitor gets five guesses, even if the sixth is right');
  for (let visitor = 2; visitor <= 40; visitor += 1) for (let guess = 0; guess < 5; guess += 1) assert.equal((await bootstrap('wrong-installer-1', stamped(`203.0.113.${visitor}`))).status, 401);
  assert.equal((await bootstrap('Installer-Password-1', stamped('198.51.100.9'))).status, 429, 'two hundred failures in all close the door to every address');
});

// Sends only the headers of `count` requests, so every one of them is past the checks that come
// before the body is read; then release() sends all the bodies at once. This is how a burst of
// simultaneous guesses reaches the handler when the early check cannot see any of them yet.
function heldRequests(base, path, count, headers, body) {
  const payload = JSON.stringify(body);
  const sockets = Array.from({ length: count }, () => {
    const socket = connect(Number(new URL(base).port), '127.0.0.1');
    let received = '';
    socket.setEncoding('utf8');
    const status = new Promise((resolve) => {
      socket.on('data', (chunk) => {
        received += chunk;
        const line = received.match(/^HTTP\/1\.1 (\d{3})/);
        if (line) { resolve(Number(line[1])); socket.destroy(); }
      });
      socket.on('error', () => resolve(0));
    });
    const extra = Object.entries(headers).map(([name, value]) => `${name}: ${value}\r\n`).join('');
    socket.write(`POST ${path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\ncontent-type: application/json\r\ncontent-length: ${Buffer.byteLength(payload)}\r\n${extra}\r\n`);
    return { socket, status };
  });
  return {
    release() { for (const { socket } of sockets) socket.write(payload); },
    statuses: async () => (await Promise.all(sockets.map(({ status }) => status))).sort()
  };
}

test('guesses whose bodies arrive together are counted together, not one by one after the fact', async (t) => {
  process.env.HOSTMGR_ADMIN_PASSWORD = 'Installer-Password-1';
  t.after(() => { delete process.env.HOSTMGR_ADMIN_PASSWORD; });
  const bootstrapped = await start({ password: undefined, proxyToken: TOKEN });
  t.after(() => bootstrapped.app.close());
  const bootstrapGuesses = heldRequests(bootstrapped.base, '/api/bootstrap', 12, stamped('203.0.113.81'), { email: 'owner@example.com', password: 'ValidPass123!', confirmPassword: 'ValidPass123!', currentPassword: 'wrong-installer-1' });
  await new Promise((resolve) => setTimeout(resolve, 300));
  bootstrapGuesses.release();
  assert.deepEqual(await bootstrapGuesses.statuses(), [401, 401, 401, 401, 401, 429, 429, 429, 429, 429, 429, 429], 'bootstrap');
  delete process.env.HOSTMGR_ADMIN_PASSWORD;
  const { app, base } = await start({ proxyToken: TOKEN });
  t.after(() => app.close());
  const loginGuesses = heldRequests(base, '/api/login', 12, stamped('203.0.113.82'), { email: 'owner@local.test', password: 'wrong-password-123' });
  await new Promise((resolve) => setTimeout(resolve, 300));
  loginGuesses.release();
  assert.deepEqual(await loginGuesses.statuses(), [401, 401, 401, 401, 401, 429, 429, 429, 429, 429, 429, 429], 'login');
});

test('simultaneous guesses at the installer password get five attempts, not as many as arrive together', async (t) => {
  process.env.HOSTMGR_ADMIN_PASSWORD = 'Installer-Password-1';
  t.after(() => { delete process.env.HOSTMGR_ADMIN_PASSWORD; });
  const { app, base } = await start({ password: undefined, proxyToken: TOKEN });
  t.after(() => app.close());
  const guess = () => post(base, '/api/bootstrap', { email: 'owner@example.com', password: 'ValidPass123!', confirmPassword: 'ValidPass123!', currentPassword: 'wrong-installer-1' }, stamped('203.0.113.80'));
  const statuses = (await Promise.all(Array.from({ length: 12 }, guess))).map((response) => response.status).sort();
  assert.deepEqual(statuses, [401, 401, 401, 401, 401, 429, 429, 429, 429, 429, 429, 429]);
});

test('the owner can still be created with the right installer password after a few mistakes', async (t) => {
  process.env.HOSTMGR_ADMIN_PASSWORD = 'Installer-Password-1';
  t.after(() => { delete process.env.HOSTMGR_ADMIN_PASSWORD; });
  const { app, base } = await start({ password: undefined, proxyToken: TOKEN });
  t.after(() => app.close());
  const bootstrap = (currentPassword) => post(base, '/api/bootstrap', { email: 'owner@example.com', password: 'ValidPass123!', confirmPassword: 'ValidPass123!', currentPassword }, stamped('203.0.113.1'));
  assert.equal((await bootstrap('wrong-installer-1')).status, 401);
  assert.equal((await bootstrap('wrong-installer-2')).status, 401);
  assert.equal((await bootstrap('Installer-Password-1')).status, 200);
});

test('a failure window can give one counted failure back without forgetting the rest', () => {
  const window = createFailureWindow();
  for (let count = 0; count < 3; count += 1) window.fail('a');
  window.forgive('a');
  assert.equal(window.blocked('a', 3), false, 'two failures remain');
  window.forgive('a');
  window.forgive('a');
  window.forgive('a');
  assert.equal(window.size, 0, 'a key that reaches zero is dropped');
  window.forgive('never-seen');
});

test('all the addresses of one IPv6 /64 are one visitor for the sign-in limit', async (t) => {
  const { app, base } = await start({ proxyToken: TOKEN });
  t.after(() => app.close());
  for (let address = 1; address <= 5; address += 1) assert.equal((await signIn(base, 'owner@local.test', 'wrong-password-123', stamped(`2001:db8:1:2::${address}`))).status, 401);
  assert.equal((await signIn(base, 'owner@local.test', 'wrong-password-123', stamped('2001:db8:1:2:ffff:ffff:ffff:9'))).status, 429, 'a fresh address in the same /64 has no fresh budget');
  assert.equal((await signIn(base, 'owner@local.test', 'wrong-password-123', stamped('2001:db8:1:3::1'))).status, 401, 'another /64 is another visitor');
});

test('an address that has signed in keeps its way in while strangers lock the account from elsewhere', async (t) => {
  const { app, base } = await start({ proxyToken: TOKEN });
  t.after(() => app.close());
  assert.equal((await signIn(base, 'owner@local.test', OWNER_PASSWORD, stamped('203.0.113.50'))).status, 200);
  for (let guess = 0; guess < 10; guess += 1) assert.equal((await signIn(base, 'owner@local.test', 'wrong-password-123', stamped(`203.0.113.${1 + Math.floor(guess / 4)}`))).status, 401);
  assert.equal((await signIn(base, 'owner@local.test', OWNER_PASSWORD, stamped('198.51.100.77'))).status, 429, 'the account is locked for an address that never signed in');
  assert.equal((await signIn(base, 'owner@local.test', OWNER_PASSWORD, stamped('203.0.113.50'))).status, 200, 'the owner signs in from where they always do');
  assert.equal((await signIn(base, 'owner@local.test', OWNER_PASSWORD, stamped('198.51.100.77'))).status, 200, 'and the account is open again for everyone once they have');
});

test('simultaneous guesses from one visitor get five attempts, not as many as arrive together', async (t) => {
  const { app, base } = await start({ proxyToken: TOKEN });
  t.after(() => app.close());
  const statuses = (await Promise.all(Array.from({ length: 12 }, () => signIn(base, 'owner@local.test', 'wrong-password-123', stamped('203.0.113.60'))))).map((response) => response.status).sort();
  assert.deepEqual(statuses, [401, 401, 401, 401, 401, 429, 429, 429, 429, 429, 429, 429]);
});

test('signing in successfully does not reset the address counter, so spraying between logins gains nothing', async (t) => {
  const { app, base } = await start({ proxyToken: TOKEN });
  t.after(() => app.close());
  const from = stamped('203.0.113.70');
  for (let guess = 0; guess < 4; guess += 1) assert.equal((await signIn(base, `ghost${guess}@example.test`, 'wrong-password-123', from)).status, 401);
  assert.equal((await signIn(base, 'owner@local.test', OWNER_PASSWORD, from)).status, 200);
  assert.equal((await signIn(base, 'ghost9@example.test', 'wrong-password-123', from)).status, 401, 'the fifth failure of the window');
  assert.equal((await signIn(base, 'ghost10@example.test', 'wrong-password-123', from)).status, 429, 'the success in between did not buy five more');
});

test('failed sign-ins write at most one audit entry a second, and the rest are written together even if the burst stops', async (t) => {
  const { app, base } = await start({ proxyToken: TOKEN });
  t.after(() => app.close());
  const headers = await login(base);
  const failures = async () => (await (await fetch(`${base}/api/audit`, { headers })).json()).events.filter((event) => event.action === 'auth.login_failed');
  for (let guess = 0; guess < 4; guess += 1) assert.equal((await signIn(base, `ghost${guess}@example.test`, 'wrong-password-123', stamped(`203.0.113.${guess + 1}`))).status, 401);
  assert.equal((await failures()).length, 1, 'four failures within a second are one entry at first');
  // Nobody fails again, yet the other three must not be lost: they are written when the second ends.
  let entries = await failures();
  for (let waited = 0; entries.length < 2 && waited < 30; waited += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    entries = await failures();
  }
  assert.equal(entries.length, 2);
  assert.ok(entries.some((entry) => /3 further failed sign-ins/.test(entry.detail)), 'the later entry says how many were not recorded one by one');
});

test('a password check queue that a flood has filled still has room for a visitor known to the account', async () => {
  const gate = createGate(1, 1, 1);
  const open = [];
  const slow = (trusted) => gate(() => new Promise((resolve) => open.push(resolve)), { trusted });
  // A caller that is not refused would wait for ever, so a refusal that does not come at once is a failure.
  const refusedAtOnce = (promise) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('not refused within 200 ms')), 200))]);
  const first = slow(false);
  const second = slow(false);
  await assert.rejects(refusedAtOnce(slow(false)), GateFullError, 'an ordinary caller is refused once the queue is full');
  const third = slow(true);
  await assert.rejects(refusedAtOnce(slow(true)), GateFullError, 'the reserve is small too');
  while (open.length) { open.shift()(); await new Promise((resolve) => setImmediate(resolve)); }
  await Promise.all([first, second, third]);
});

test('the sign-in handler reserves gate places for a known visitor and clears the audit timer on close', async () => {
  const { readFile } = await import('node:fs/promises');
  const server = await readFile(new URL('../src/server.mjs', import.meta.url), 'utf8');
  assert.match(server, /createGate\(PASSWORD_CHECKS_AT_ONCE, PASSWORD_CHECKS_WAITING, PASSWORD_CHECKS_RESERVED\)/);
  assert.match(server, /verifyPasswordAsync\(body\.password, owner \? owner\.password : ABSENT_ACCOUNT_PASSWORD\), \{ trusted: knownVisitor \}/);
  assert.match(server, /clearTimeout\(failedLoginAudit\.timer\);\s+failedLoginAudit\.timer = null;\s+server\.close/);
});

test('the application can be closed while a held back audit entry is pending, without writing to a closed store', async (t) => {
  const { app, base } = await start({ proxyToken: TOKEN });
  for (let guess = 0; guess < 3; guess += 1) assert.equal((await signIn(base, `ghost${guess}@example.test`, 'wrong-password-123', stamped(`203.0.113.${guess + 1}`))).status, 401);
  await app.close();
  await new Promise((resolve) => setTimeout(resolve, 1300));
  t.diagnostic('no unhandled rejection after close');
});

test('password checks run off the main thread and agree with the synchronous check', async () => {
  const stored = hashPassword('Correct-Horse-1!');
  assert.equal(await verifyPasswordAsync('Correct-Horse-1!', stored), true);
  assert.equal(await verifyPasswordAsync('wrong-password-123', stored), false);
  assert.equal(verifyPassword('Correct-Horse-1!', stored), true);
  for (const unusable of [null, {}, { algorithm: 'scrypt' }, { ...stored, hash: 5 }, { ...stored, params: { N: 3 } }]) assert.equal(await verifyPasswordAsync('x', unusable), false);
  assert.equal(await verifyPasswordAsync(5, stored), false);
  // While a check is pending, the event loop is free: a timer fires before the answer arrives.
  let ticks = 0;
  const timer = setInterval(() => { ticks += 1; }, 1);
  await Promise.all([verifyPasswordAsync('wrong-password-123', stored), verifyPasswordAsync('wrong-password-123', stored)]);
  clearInterval(timer);
  assert.ok(ticks > 0, 'timers ran while two scrypt checks were in flight');
});

test('the gate runs a few at a time, queues a few, refuses the rest, and always lets go', async () => {
  const gate = createGate(2, 2);
  let running = 0;
  let peak = 0;
  const task = (id) => gate(async () => {
    running += 1;
    peak = Math.max(peak, running);
    await new Promise((resolve) => setTimeout(resolve, 20));
    running -= 1;
    return id;
  });
  const results = await Promise.allSettled(Array.from({ length: 6 }, (_, id) => task(id)));
  assert.deepEqual(results.filter((result) => result.status === 'fulfilled').map((result) => result.value), [0, 1, 2, 3]);
  assert.ok(results.filter((result) => result.status === 'rejected').every((result) => result.reason instanceof GateFullError));
  assert.equal(peak, 2);
  await assert.rejects(gate(async () => { throw new Error('boom'); }), /boom/);
  assert.equal(await gate(async () => 'ok'), 'ok', 'a task that threw released its slot');
});
