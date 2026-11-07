import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderRealIpConf } from '../scripts/nginx-realip.mjs';
import { CLOUDFLARE_RANGES, isCloudflareAddress } from '../scripts/domain-dns.mjs';

test('the visitor address is taken from Cloudflare only on connections from Cloudflare', () => {
  const conf = renderRealIpConf();
  const trusted = [...conf.matchAll(/^set_real_ip_from (\S+);$/gm)].map((match) => match[1]);
  assert.deepEqual(trusted, [...CLOUDFLARE_RANGES]);
  assert.ok(trusted.some((range) => range.includes(':')) && trusted.some((range) => !range.includes(':')), 'IPv4 and IPv6 ranges');
  assert.match(conf, /^real_ip_header CF-Connecting-IP;$/m);
  assert.match(conf, /^real_ip_recursive off;$/m);
  // Trusting loopback or "anyone" would let a visitor choose the address that is logged and forwarded.
  for (const range of trusted) assert.doesNotMatch(range, /^(127\.|::1|0\.0\.0\.0|::\/0)/);
  assert.equal(conf.endsWith('\n'), true);
});

test('the trusted ranges are the same list DNS verification uses to recognise Cloudflare', () => {
  assert.equal(isCloudflareAddress('104.16.0.1'), true);
  assert.equal(isCloudflareAddress('2606:4700::1'), true);
  assert.equal(isCloudflareAddress('203.0.113.7'), false);
  assert.equal(Object.isFrozen(CLOUDFLARE_RANGES), true);
});

test('a malformed range is refused rather than written into the Nginx configuration', () => {
  for (const bad of ['', 'all', '10.0.0.0', '10.0.0.0/33', '::/129', '10.0.0.0/8; deny all', '10.0.0.0/8/9', '10.0.0/8']) {
    assert.throws(() => renderRealIpConf([bad]), /Not a CIDR range/, bad);
  }
  assert.equal(renderRealIpConf(['10.0.0.0/8']).includes('set_real_ip_from 10.0.0.0/8;'), true);
});

test('the installer renders the real-IP file before Nginx is tested, keeps a rollback copy and ships the script', async () => {
  const script = await readFile(new URL('../strckro.sh', import.meta.url), 'utf8');
  assert.match(script, /NGINX_REALIP_CONF='\/etc\/nginx\/conf\.d\/strckro-realip\.conf'/);
  assert.match(script, /backup_item nginx-realip "\$NGINX_REALIP_CONF"/);
  assert.match(script, /restore_item nginx-realip "\$NGINX_REALIP_CONF"/);
  assert.match(script, /-f scripts\/nginx-realip\.mjs/);
  assert.match(script, /install -m 0644 -o root -g root "\$APP_ROOT\/scripts\/nginx-realip\.mjs" "\$HELPER_ROOT\/nginx-realip\.mjs"/);
  const render = script.indexOf('"$PORTAL_NODE" "$HELPER_ROOT/nginx-realip.mjs" > "$TMP_DIR/realip.conf"');
  const place = script.indexOf('install -m 0644 -o root -g root "$TMP_DIR/realip.conf" "$NGINX_REALIP_CONF"');
  const nginxTest = script.indexOf('\nnginx_test\n');
  assert.ok(render > 0 && place > render && nginxTest > place, 'render, then place, then nginx -t');
});
