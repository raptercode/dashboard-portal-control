import test from 'node:test';
import assert from 'node:assert/strict';
import { InputError } from '../src/core.mjs';
import { checkDrift, managedFilename, renderNginxSite, validateNginxSite } from '../src/nginx.mjs';

test('Nginx renderer creates a host-owned reverse-proxy file', () => {
  const config = renderNginxSite({ hostname: 'demo.test', projectSlug: 'demo-app', upstreamPort: 3000 });
  assert.equal(managedFilename('demo.test'), 'demo.test.conf');
  assert.match(config, /server_name demo\.test;/);
  assert.match(config, /proxy_pass http:\/\/127\.0\.0\.1:3000;/);
  assert.match(config, /Manual edits are detected as drift/);
});

test('Nginx renderer rejects config-injection inputs', () => {
  assert.throws(() => validateNginxSite({ hostname: 'demo.test; include /etc/passwd;', projectSlug: 'demo', upstreamPort: 3000 }), InputError);
  assert.throws(() => validateNginxSite({ hostname: 'demo.test', projectSlug: '../root', upstreamPort: 3000 }), InputError);
  assert.throws(() => validateNginxSite({ hostname: 'demo.test', projectSlug: 'demo', upstreamPort: '80; break' }), InputError);
});

test('drift detection compares hashes rather than trusting timestamps', () => {
  const expected = renderNginxSite({ hostname: 'demo.test', projectSlug: 'demo', upstreamPort: 3000 });
  assert.equal(checkDrift(expected, expected).drifted, false);
  assert.equal(checkDrift(expected, `${expected}# edited\n`).drifted, true);
  assert.equal(checkDrift(expected, null).drifted, true);
});
