import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { clientAddress, clientBucket, validProxyToken } from '../src/client-address.mjs';
import { start, OWNER_PASSWORD } from './support/server.mjs';

const TOKEN = 'f3a9'.repeat(16);
const req = (peer, headers = {}) => ({ socket: peer === undefined ? undefined : { remoteAddress: peer }, headers });
const stamped = (ip, token = TOKEN) => ({ 'x-real-ip': ip, 'x-strckro-proxy-token': token });

test('a request Nginx stamped with the secret carries the visitor address', () => {
  assert.equal(clientAddress(req('127.0.0.1', stamped('203.0.113.7')), TOKEN), '203.0.113.7');
  assert.equal(clientAddress(req('::1', stamped('2001:db8::7')), TOKEN), '2001:db8::7');
  assert.equal(clientAddress(req('::ffff:127.0.0.1', stamped('203.0.113.7')), TOKEN), '203.0.113.7');
  assert.equal(clientAddress(req('127.0.0.1', stamped('::FFFF:203.0.113.7')), TOKEN), '203.0.113.7');
});

test('a process on the host cannot choose its address by sending X-Real-IP', () => {
  // Loopback is not proof of Nginx: a deployed project can open 127.0.0.1 itself.
  assert.equal(clientAddress(req('127.0.0.1', { 'x-real-ip': '203.0.113.7' }), TOKEN), '127.0.0.1');
  assert.equal(clientAddress(req('127.0.0.1', stamped('203.0.113.7', 'e1e2'.repeat(16))), TOKEN), '127.0.0.1');
  for (const wrong of ['', 'short', TOKEN.slice(1), `${TOKEN}0`, TOKEN.toUpperCase()]) {
    assert.equal(clientAddress(req('127.0.0.1', stamped('203.0.113.7', wrong)), TOKEN), '127.0.0.1', JSON.stringify(wrong));
  }
});

test('every loopback source is one visitor, so binding another 127.x.y.z buys no new budget', () => {
  for (const peer of ['127.0.0.1', '127.0.0.2', '127.200.13.7', '127.255.255.254', '::1', '::ffff:127.9.9.9']) {
    assert.equal(clientAddress(req(peer, { 'x-real-ip': '203.0.113.7' }), TOKEN), '127.0.0.1', `${peer} unstamped`);
    assert.equal(clientAddress(req(peer, stamped('203.0.113.7', 'e1e2'.repeat(16))), TOKEN), '127.0.0.1', `${peer} wrong secret`);
    assert.equal(clientAddress(req(peer, stamped('203.0.113.7')), undefined), '127.0.0.1', `${peer} no secret configured`);
    assert.equal(clientBucket(req(peer), TOKEN), '127.0.0.1', `${peer} bucket`);
    assert.equal(clientAddress(req(peer, stamped('203.0.113.7')), TOKEN), '203.0.113.7', `${peer} stamped by Nginx`);
  }
  for (const peer of ['128.0.0.1', '126.255.255.255', '12.7.0.1', '1127.0.0.1']) assert.equal(clientAddress(req(peer), TOKEN), peer, `${peer} is not loopback`);
});

test('without a usable secret configured, no forwarded address is ever believed', () => {
  for (const configured of [undefined, null, '', 'short', 'x'.repeat(31), `${'a'.repeat(31)}!`, 'a'.repeat(129)]) {
    assert.equal(validProxyToken(configured), false, String(configured));
    assert.equal(clientAddress(req('127.0.0.1', stamped('203.0.113.7', configured ?? TOKEN)), configured), '127.0.0.1', String(configured));
  }
  assert.equal(validProxyToken(TOKEN), true);
});

test('a connection that is not loopback is never trusted, whatever it sends', () => {
  assert.equal(clientAddress(req('198.51.100.9', stamped('203.0.113.7')), TOKEN), '198.51.100.9');
  assert.equal(clientAddress(req('::ffff:198.51.100.9', stamped('203.0.113.7')), TOKEN), '198.51.100.9');
});

test('a malformed forwarded address or a missing peer falls back safely', () => {
  for (const forwarded of ['', 'not-an-ip', '203.0.113.7, 198.51.100.1', '203.0.113.7:443', ' ']) assert.equal(clientAddress(req('127.0.0.1', stamped(forwarded)), TOKEN), '127.0.0.1', JSON.stringify(forwarded));
  assert.equal(clientAddress(req('127.0.0.1', { 'x-strckro-proxy-token': TOKEN }), TOKEN), '127.0.0.1');
  assert.equal(clientAddress(req(undefined), TOKEN), 'unknown');
  assert.equal(clientAddress({ headers: {} }, TOKEN), 'unknown');
});

test('limiters count an IPv6 visitor per /64 and an IPv4 visitor per address', () => {
  const bucket = (address) => clientBucket(req('127.0.0.1', stamped(address)), TOKEN);
  assert.equal(bucket('203.0.113.7'), '203.0.113.7');
  assert.equal(bucket('2001:db8:1:2:aaaa:bbbb:cccc:dddd'), '2001:db8:1:2::/64');
  assert.equal(bucket('2001:db8:1:2::1'), '2001:db8:1:2::/64');
  assert.equal(bucket('2001:DB8:1:2:0:0:0:ffff'), '2001:db8:1:2::/64', 'case and spelling do not matter');
  assert.equal(bucket('2001:db8::1:2:3:4'), '2001:db8:0:0::/64', 'compressed zero groups are still part of the /64');
  assert.notEqual(bucket('2001:db8:1:2::1'), bucket('2001:db8:1:3::1'), 'a different /64 is a different visitor');
  assert.equal(clientBucket(req('2001:db8:9:9:1:2:3:4'), TOKEN), '2001:db8:9:9::/64', 'the peer address is bucketed the same way');
  assert.equal(clientBucket(req('::ffff:198.51.100.9'), TOKEN), '198.51.100.9');
  assert.equal(clientBucket(req(undefined), TOKEN), 'unknown');
  assert.equal(clientBucket(req('127.0.0.1', { 'x-real-ip': '2001:db8:1:2::1' }), TOKEN), '127.0.0.1', 'an unstamped request is still the loopback peer');
});

const attempt = (base, headers, password = 'wrong-password-123') => fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ email: 'owner@local.test', password }) });

test('through Nginx, failed logins are counted per visitor and one visitor cannot lock out another', async (t) => {
  const { app, base } = await start({ proxyToken: TOKEN });
  t.after(() => app.close());
  for (let count = 0; count < 5; count += 1) assert.equal((await attempt(base, stamped('203.0.113.7'))).status, 401);
  assert.equal((await attempt(base, stamped('203.0.113.7'))).status, 429, 'the sixth failure from one visitor is refused');
  assert.equal((await attempt(base, stamped('203.0.113.7'), OWNER_PASSWORD)).status, 429, 'even with the right password while locked out');
  assert.equal((await attempt(base, stamped('198.51.100.9'))).status, 401);
  assert.equal((await attempt(base, stamped('198.51.100.9'), OWNER_PASSWORD)).status, 200);
});

test('a local process that spoofs X-Real-IP gains no extra guesses and cannot lock out real visitors', async (t) => {
  const { app, base } = await start({ proxyToken: TOKEN });
  t.after(() => app.close());
  // Every guess claims a different visitor, but none carries the secret, so all share the loopback bucket.
  for (let count = 0; count < 5; count += 1) assert.equal((await attempt(base, { 'x-real-ip': `203.0.113.${count + 1}` })).status, 401);
  assert.equal((await attempt(base, { 'x-real-ip': '203.0.113.200' })).status, 429, 'spoofed addresses do not reset the limit');
  assert.equal((await attempt(base, { 'x-real-ip': '203.0.113.201', 'x-strckro-proxy-token': 'e1e2'.repeat(16) })).status, 429, 'a wrong secret is no better');
  // Visitors Nginx forwarded are unaffected by the local flood.
  assert.equal((await attempt(base, stamped('198.51.100.9'), OWNER_PASSWORD)).status, 200);
});

test('without a configured secret the portal ignores forwarded addresses entirely', async (t) => {
  const { app, base } = await start({ proxyToken: '' });
  t.after(() => app.close());
  for (let count = 0; count < 5; count += 1) assert.equal((await attempt(base, stamped(`203.0.113.${count + 1}`))).status, 401);
  assert.equal((await attempt(base, stamped('198.51.100.9'), OWNER_PASSWORD)).status, 429);
});

test('anonymous CLI login requests are limited per visitor', async (t) => {
  const { app, base } = await start({ proxyToken: TOKEN });
  t.after(() => app.close());
  const startLogin = (headers) => fetch(`${base}/api/cli/device/start`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: '{}' });
  for (let count = 0; count < 20; count += 1) assert.equal((await startLogin(stamped('203.0.113.7'))).status, 200);
  assert.equal((await startLogin(stamped('203.0.113.7'))).status, 429);
  assert.equal((await startLogin(stamped('198.51.100.9'))).status, 200);
  assert.equal((await startLogin({ 'x-real-ip': '198.51.100.10' })).status, 200, 'a spoofer is counted as the loopback peer, which is a bucket of its own');
});

test('the installer keeps the secret out of the world-readable site file and in a root-only snippet', async () => {
  const script = (await readFile(new URL('../strckro.sh', import.meta.url), 'utf8')).replaceAll('\r\n', '\n');
  assert.match(script, /NGINX_PROXY_SNIPPET='\/etc\/nginx\/snippets\/strckro-proxy\.conf'/);
  assert.match(script, /HOSTMGR_PROXY_TOKEN=\[A-Za-z0-9_-\]\{32,128\}\$' "\$CONFIG_ROOT\/dashboard-portal\.env"/);
  assert.match(script, /set_config_value HOSTMGR_PROXY_TOKEN "\$\(\/usr\/local\/bin\/node -e "console\.log\(require\('crypto'\)\.randomBytes\(32\)\.toString\('hex'\)\)"\)"/);
  assert.match(script, /printf 'proxy_set_header X-Strckro-Proxy-Token "%s";\\n' "\$PROXY_TOKEN" > "\$NGINX_PROXY_SNIPPET"\nchown root:root "\$NGINX_PROXY_SNIPPET"\nchmod 0600 "\$NGINX_PROXY_SNIPPET"/);
  const site = script.match(/cat > "\$NGINX_SITE" <<EOF\n([\s\S]*?)\nEOF/)[1];
  assert.match(site, /location \/ \{[\s\S]*include \$\{NGINX_PROXY_SNIPPET\};[\s\S]*\}/);
  assert.doesNotMatch(site, /PROXY_TOKEN|Strckro-Proxy/, 'the site file is mode 0644 and must not carry the secret');
  assert.match(script, /backup_item nginx-proxy-snippet "\$NGINX_PROXY_SNIPPET"/);
  assert.match(script, /restore_item nginx-proxy-snippet "\$NGINX_PROXY_SNIPPET"/);
  // The snippet exists before Nginx is tested, and the configuration is written before the service starts.
  assert.ok(script.indexOf('chmod 0600 "$NGINX_PROXY_SNIPPET"') < script.indexOf('\nnginx_test\n'));
  // (The rollback function near the top also restarts the service; the install step is the last one.)
  assert.ok(script.indexOf('set_config_value HOSTMGR_PROXY_TOKEN') < script.lastIndexOf('systemctl restart dashboard-portal.service'));
});

test('the server reads the secret from its configuration and hands it to every limiter', async () => {
  const server = await readFile(new URL('../src/server.mjs', import.meta.url), 'utf8');
  assert.match(server, /options\.proxyToken \?\? process\.env\.HOSTMGR_PROXY_TOKEN/);
  // Invitation accept, login and first-run bootstrap each count failures per visitor bucket.
  assert.equal(server.match(/clientBucket\(request, proxyToken\)/g)?.length, 3);
  assert.doesNotMatch(server, /clientAddress\(/, 'limiters count per bucket, never per full address');
  assert.match(server, /createCliAuth\(\{ store, readJson, sendJson, proxyToken \}\)/);
  assert.doesNotMatch(server, /request\.socket\.remoteAddress/);
  const cli = await readFile(new URL('../src/cli-auth.mjs', import.meta.url), 'utf8');
  assert.match(cli, /clientBucket\(request, proxyToken\)/);
  assert.doesNotMatch(cli, /clientAddress\(/);
  assert.doesNotMatch(cli, /request\.socket\.remoteAddress/);
});
