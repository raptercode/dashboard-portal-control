import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEdgeEvaluation, classifyHttpBody, publicEdgeResult, summarizeManagedNginx } from '../scripts/nginx-edge.mjs';

const hosts = ['helpdesk-api.vitemail.site'];
const sitePath = '/etc/nginx/sites-available/hostmgr-helpdesk.conf';
const enabledPath = '/etc/nginx/sites-enabled/hostmgr-helpdesk.conf';

const dump = `# configuration file /etc/nginx/nginx.conf:
http {
# configuration file /etc/nginx/sites-enabled/default:
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;
    root /var/www/html;
}
# configuration file /etc/nginx/sites-enabled/hostmgr-helpdesk.conf:
server {
    listen 80;
    server_name helpdesk-api.vitemail.site;
    location / { return 308 https://$host$request_uri; }
}
server {
    listen 443 ssl;
    server_name helpdesk-api.vitemail.site;
    location / { proxy_pass http://127.0.0.1:3002; }
}
`;

test('classifyHttpBody detects the Ubuntu welcome page', () => {
  assert.equal(classifyHttpBody('<html><title>Welcome to nginx!</title></html>'), 'nginx-default');
  assert.equal(classifyHttpBody('{"ok":true}'), 'app');
  assert.equal(classifyHttpBody(''), 'empty');
});

test('summarizeManagedNginx sees the loaded TLS proxy and Ubuntu default_server', () => {
  const summary = summarizeManagedNginx(dump, { sitePath, enabledPath, hosts, port: 3002 });
  assert.equal(summary.loaded, true);
  assert.equal(summary.hasTlsProxy, true);
  assert.equal(summary.defaultServerPresent, true);
  assert.equal(summary.claimedByOther, false);
});

test('edge evaluation flags the default site when Host still hits Welcome to nginx', () => {
  const result = buildEdgeEvaluation({
    siteExists: true,
    enabled: true,
    nginx: dump,
    hosts,
    port: 3002,
    sitePath,
    enabledPath,
    httpProbe: { status: 200, location: null, kind: 'nginx-default' },
    upstreamProbe: { status: 200, location: null, kind: 'app' }
  });
  assert.equal(result.status, 'default-site');
  assert.equal(result.passed, false);
  assert.equal(result.checks.find((item) => item.id === 'http').ok, false);
  assert.equal(result.checks.find((item) => item.id === 'upstream').ok, true);
});

test('edge evaluation passes when HTTP redirects to HTTPS and the app is up', () => {
  const result = buildEdgeEvaluation({
    siteExists: true,
    enabled: true,
    nginx: dump,
    hosts,
    port: 3002,
    sitePath,
    enabledPath,
    httpProbe: { status: 308, location: 'https://helpdesk-api.vitemail.site/', kind: 'empty' },
    upstreamProbe: { status: 200, location: null, kind: 'app' }
  });
  assert.equal(result.status, 'ok');
  assert.equal(result.passed, true);
});

test('publicEdgeResult keeps helper ok from colliding with the evaluation', () => {
  const published = publicEdgeResult({ ok: true, passed: false, status: 'default-site', hostname: hosts[0], checks: [{ id: 'http', ok: false, detail: 'Port 80 still returns the default Nginx page for this Host header' }] });
  assert.equal(published.passed, false);
  assert.equal(published.status, 'default-site');
  assert.equal(published.checks[0].id, 'http');
});
