import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { start, login, request } from './support/server.mjs';
import { resolvePublicDomainAddresses } from '../scripts/domain-dns.mjs';
import { domainDnsStatus, domainProxyStatus, domainReadiness, domainDnsRecords } from '../public/ui/project-domains.js';
import { preserveManagedTlsForChallenge } from '../scripts/nginx-edge.mjs';

const helper = await readFile(new URL('../scripts/hostmgr-deploy-helper.mjs', import.meta.url), 'utf8');
const extract = (source, name) => source.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n\\}`))[0];

test('replacing or shrinking domains renews the existing certificate with exactly the new names', async () => {
  const calls = [];
  const issue = runInNewContext(`(${extract(helper, 'issueCertificate')})`, {
    acmeEmail: async () => 'owner@example.test', ACME_ROOT: '/acme',
    certificateName: () => 'hostmgr-app', HelperError: Error,
    run: async (command, args) => { calls.push({ command, args }); return '192.0.2.1'; }
  });
  await issue({ slug: 'app', domains: { hosts: ['new.example.test'] } });
  const args = calls.find(call => call.command.endsWith('/certbot')).args;
  assert.ok(args.includes('--renew-with-new-domains'), 'noninteractive replacement must handle an existing certificate for the removed domain');
  assert.ok(args.includes('--keep-until-expiring'), 'unchanged domains should reuse a valid certificate');
  assert.deepEqual(Array.from(args.slice(args.indexOf('-d'))), ['-d', 'new.example.test']);
});

test('saved DNS success is not labelled as a ready website', () => {
  assert.equal(domainDnsStatus({ status: 'ok' }), 'DNS ถูกต้อง');
  assert.equal(domainReadiness({ status: 'ok' }, { passed: true }).label, 'Pending Verification');
  assert.equal(domainReadiness({ status: 'proxied' }, { passed: true, tls: { status: 'valid' } }).label, 'Valid Configuration');
  assert.equal(domainProxyStatus({ status: 'proxied' }), 'Proxy: เปิด (Cloudflare)');
  assert.equal(domainProxyStatus({ status: 'unresolved' }), 'Proxy: ยังตรวจไม่ได้');
  assert.deepEqual(domainDnsRecords('app.example.test', { expected: ['192.0.2.1', '2001:db8::1'] }), [
    { type: 'A', name: 'app.example.test', value: '192.0.2.1', optional: false },
    { type: 'AAAA', name: 'app.example.test', value: '2001:db8::1', optional: true }
  ]);
});

test('certificate issuance falls back to public DNS when getent retains a negative answer', async () => {
  let issued = false;
  const issue = runInNewContext(`(${extract(helper, 'issueCertificate')})`, {
    acmeEmail: async () => 'owner@example.test', ACME_ROOT: '/acme',
    certificateName: () => 'hostmgr-app', HelperError: Error,
    resolvePublicDomainAddresses: async hostname => {
      assert.equal(hostname, 'api.holaezgame.com');
      return ['187.52.115.194'];
    },
    run: async command => {
      if (command.endsWith('/getent')) throw { commandOutput: 'Command: getent\nExit code: 2' };
      issued = true;
    }
  });
  await issue({ slug: 'app', domains: { hosts: ['api.holaezgame.com'] } });
  assert.equal(issued, true, 'public DNS should let Certbot perform its authoritative HTTP-01 validation');
});

test('public DNS fallback tolerates one failed resolver and deduplicates validated addresses', async () => {
  class Resolver {
    setServers([server]) { this.server = server; }
    async resolve4() { if (this.server === '1.1.1.1') throw new Error('unavailable'); return ['187.52.115.194', 'invalid']; }
    async resolve6() { return ['2001:db8::1', '2001:db8::1']; }
    cancel() {}
  }
  assert.deepEqual(await resolvePublicDomainAddresses('api.example.test', { Resolver }), ['2001:db8::1', '187.52.115.194']);
});

test('public DNS fallback cancels both resolvers within its timeout budget', async () => {
  let cancelled = 0;
  class Resolver {
    setServers() {}
    resolve4() { return new Promise(() => {}); }
    resolve6() { return new Promise(() => {}); }
    cancel() { cancelled++; }
  }
  assert.deepEqual(await resolvePublicDomainAddresses('api.example.test', { Resolver, timeoutMs: 10 }), []);
  assert.equal(cancelled, 2);
});

test('add saves a domain before DNS is ready without calling Nginx or Certbot', async t => {
  const { app, base, headers } = await hostFixture(t, async () => assert.fail('adding must not activate'));
  const result = await request(base, '/api/projects/domain-app/domains', headers, 'POST', { domains: ['old.example.test', 'new.example.test'], sync: false });
  assert.equal(result.status, 200);
  assert.equal(result.body.domainSync.status, 'pending');
  assert.deepEqual(result.body.project.domains.activeHosts, ['old.example.test']);
  assert.deepEqual(app.store.snapshot().projects[0].domains.hosts, ['old.example.test', 'new.example.test']);
});

test('Verify accepts Cloudflare Proxy and activates only ready domains alongside existing domains', async t => {
  const calls = [];
  const { app, base, headers } = await hostFixture(t, async (_socket, message) => { calls.push(message); return { ok: true }; });
  await app.store.update(state => {
    state.projects[0].domains.hosts.push('new.example.test', 'pending.example.test');
    state.projects[0].domains.activeHosts = ['old.example.test'];
  });
  // The checker is injected; separate resolver tests exercise real DNS classification.
  const result = await request(base, '/api/projects/domain-app/domains/verify', headers, 'POST', { hostname: 'new.example.test' });
  assert.equal(result.status, 200);
  assert.equal(result.body.domainSync.status, 'synced');
  assert.equal(result.body.checks['new.example.test'].status, 'proxied');
  assert.deepEqual(calls[0].hosts, ['old.example.test', 'new.example.test']);
  assert.deepEqual(result.body.project.domains.activeHosts, ['old.example.test', 'new.example.test']);
});

test('Verify of an unresolved domain leaves the active route untouched', async t => {
  const { app, base, headers } = await hostFixture(t, async () => assert.fail('must not activate unresolved DNS'));
  await app.store.update(state => { state.projects[0].domains.hosts.push('pending.example.test'); });
  const result = await request(base, '/api/projects/domain-app/domains/verify', headers, 'POST', { hostname: 'pending.example.test' });
  assert.equal(result.status, 200);
  assert.equal(result.body.domainSync.status, 'pending');
  assert.equal(result.body.project.domains.syncedAt, '2026-10-19T00:00:00Z');
  assert.equal(result.body.checks['pending.example.test'].status, 'unresolved');
});

test('removing an active domain does not try to issue certificates for other pending domains', async t => {
  const calls = [];
  const { app, base, headers } = await hostFixture(t, async (_socket, message) => { calls.push(message); return { ok: true }; });
  await app.store.update(state => {
    state.projects[0].domains.activeHosts = ['old.example.test'];
    state.projects[0].domains.hosts.push('pending.example.test');
  });
  const result = await request(base, '/api/projects/domain-app/domains', headers, 'POST', { domains: ['pending.example.test'] });
  assert.equal(result.body.domainSync.status, 'synced');
  assert.deepEqual(result.body.project.domains.activeHosts, []);
  assert.equal(result.body.project.domains.syncedAt, null);
  assert.equal(calls[0].operation, 'remove-project-domains');
});

test('privileged domain sync cannot activate a hostname outside the saved project list', async () => {
  let activated;
  const sync = runInNewContext(`(${extract(helper, 'syncProjectDomains')})`, {
    loadProject: async () => ({ deployment: { activeReleaseId: 'release' }, domains: { hosts: ['saved.example.test', 'pending.example.test'] } }),
    HelperError: Error, validateDomain: value => value, applyDomains: async project => { activated = Array.from(project.domains.hosts); }
  });
  await assert.rejects(sync('app', ['unrelated.example.test']), /saved project domains/);
  await sync('app', ['saved.example.test']);
  assert.deepEqual(activated, ['saved.example.test']);
});

test('new-domain HTTP-01 preflight keeps existing HTTPS routes until issuance succeeds', async () => {
  const previous = 'server {\n    listen 80;\n}\n\nserver {\n    listen 443 ssl;\n    server_name old.example.test;\n    ssl_certificate /previous/fullchain.pem;\n}\n';
  const writes = [];
  let restored = false;
  const apply = runInNewContext(`(${extract(helper, 'applyDomains')})`, {
    join: (...parts) => parts.join('/'), NGINX_AVAILABLE: '/available', NGINX_ENABLED: '/enabled', ACME_ROOT: '/acme',
    ensureUnmatchedNginx: async () => {}, assertDomainsAreAvailable: async () => {}, snapshotNginx: async () => ({ site: previous }),
    mkdir: async () => {}, writeNginx: async (_site, _enabled, value) => writes.push(value),
    renderHttpSite: () => 'server {\n    listen 80;\n    server_name old.example.test new.example.test;\n}\n', preserveManagedTlsForChallenge,
    testAndReloadNginx: async () => {},
    issueCertificate: async () => { assert.match(writes[0], /listen 443 ssl;[\s\S]*old\.example\.test/); throw new Error('ACME fixture failure'); },
    restoreNginx: async () => { restored = true; }
  });
  await assert.rejects(apply({ slug: 'app', domains: { hosts: ['old.example.test', 'new.example.test'] } }), /ACME fixture failure/);
  assert.equal(restored, true);
  assert.match(writes[0], /server_name old\.example\.test new\.example\.test/);
  assert.match(writes[0], /ssl_certificate \/previous\/fullchain\.pem/);
});

test('Verify and edge inspection reject domains that are not assigned to the project', async t => {
  const { base, headers } = await hostFixture(t, async () => assert.fail('must not call helper'));
  for (const endpoint of ['domains/verify', 'edge/check']) {
    const result = await request(base, `/api/projects/domain-app/${endpoint}`, headers, 'POST', { hostname: 'unrelated.example.test' });
    assert.equal(result.status, 400);
  }
});

async function hostFixture(t, projectDomainHelper) {
  const previous = process.env.HOSTMGR_DEPLOY_HELPER_SOCKET;
  process.env.HOSTMGR_DEPLOY_HELPER_SOCKET = '/fixture-domain-helper.sock';
  t.after(() => {
    if (previous === undefined) delete process.env.HOSTMGR_DEPLOY_HELPER_SOCKET;
    else process.env.HOSTMGR_DEPLOY_HELPER_SOCKET = previous;
  });
  const result = await start({ mode: 'host', projectDomainHelper, projectRuntimeProbe: async () => ({ state: 'active' }), domainDnsCheck: async hostname => ({ hostname, status: hostname.startsWith('pending') ? 'unresolved' : 'proxied', resolved: ['104.21.51.31'], expected: ['192.0.2.1'], matched: false, proxy: { detected: true, provider: 'Cloudflare' } }) });
  t.after(() => result.app.close());
  await result.app.store.update(state => state.projects.push({
    name: 'Domain app', slug: 'domain-app', port: 3000,
    domains: { hosts: ['old.example.test'], syncedAt: '2026-10-19T00:00:00Z' },
    deployment: { state: 'active', activeReleaseId: 'active-release', releases: [] }
  }));
  return { ...result, headers: await login(result.base) };
}

test('delete old domain then add new: expose saved state on TLS failure and support retry', async t => {
  let fail = false;
  const calls = [];
  const { app, base, headers } = await hostFixture(t, async (_socket, message) => {
    calls.push(message.operation);
    return fail ? { ok: false, error: 'TLS certificate request failed.' } : { ok: true };
  });
  const save = domains => request(base, '/api/projects/domain-app/domains', headers, 'POST', { domains });
  const removed = await save([]);
  assert.equal(removed.status, 200);
  assert.equal(removed.body.domainSync.status, 'synced');
  fail = true;
  const added = await save(['new.example.test']);
  assert.equal(added.status, 200, 'saved desired state needs a structured sync failure');
  assert.deepEqual(added.body.project.domains.hosts, ['new.example.test']);
  assert.equal(added.body.domainSync.status, 'failed');
  assert.match(added.body.domainSync.detail, /TLS certificate request failed/);
  assert.equal(added.body.project.domains.syncedAt, null);
  assert.match(added.body.project.domains.syncError, /TLS/);
  fail = false;
  const retry = await save(['new.example.test']);
  assert.equal(retry.body.domainSync.status, 'synced');
  assert.ok(retry.body.project.domains.syncedAt);
  assert.equal(app.store.snapshot().projects[0].domains.syncError, null);
  assert.deepEqual(calls, ['remove-project-domains', 'sync-project-domains', 'sync-project-domains']);
});

test('helper rejection when removing the last domain must not be reported as synced', async t => {
  const { base, headers } = await hostFixture(t, async () => ({ ok: false, error: 'Nginx configuration test failed.' }));
  const result = await request(base, '/api/projects/domain-app/domains', headers, 'POST', { domains: [] });
  assert.equal(result.status, 200);
  assert.equal(result.body.domainSync.status, 'failed');
  assert.equal(result.body.project.domains.syncedAt, null);
});

test('transport failures retain saved state without exposing raw helper diagnostics', async t => {
  const { base, headers } = await hostFixture(t, async () => { throw new Error('credential=fixture-secret'); });
  const result = await request(base, '/api/projects/domain-app/domains', headers, 'POST', { domains: ['new.example.test'] });
  assert.equal(result.status, 200);
  assert.equal(result.body.domainSync.status, 'failed');
  assert.deepEqual(result.body.project.domains.hosts, ['new.example.test']);
  assert.ok(!JSON.stringify(result.body).includes('fixture-secret'));
});

test('a concurrent domain save cannot replace the state being read by the helper', async t => {
  let finish;
  let entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const { base, headers, app } = await hostFixture(t, async () => {
    entered();
    return new Promise(resolve => { finish = resolve; });
  });
  const first = request(base, '/api/projects/domain-app/domains', headers, 'POST', { domains: ['first.example.test'] });
  await ready;
  const second = await request(base, '/api/projects/domain-app/domains', headers, 'POST', { domains: ['second.example.test'] });
  assert.equal(second.status, 400);
  assert.deepEqual(app.store.snapshot().projects[0].domains.hosts, ['first.example.test']);
  finish({ ok: true });
  assert.equal((await first).body.domainSync.status, 'synced');
});

test('domain edits wait for a queued deployment without changing saved domains', async t => {
  const { base, headers, app } = await hostFixture(t, async () => assert.fail('must not call helper'));
  await app.store.update(state => state.jobs.push({ id: 'fixture-job', projectSlug: 'domain-app', kind: 'deploy', status: 'queued', createdAt: new Date().toISOString() }));
  const result = await request(base, '/api/projects/domain-app/domains', headers, 'POST', { domains: ['new.example.test'] });
  assert.equal(result.status, 400);
  assert.deepEqual(app.store.snapshot().projects[0].domains.hosts, ['old.example.test']);
});

test('domains saved before the first deployment explicitly report pending activation', async t => {
  const { base, headers, app } = await hostFixture(t, async () => assert.fail('must not call helper'));
  await app.store.update(state => { state.projects[0].deployment.activeReleaseId = null; });
  const result = await request(base, '/api/projects/domain-app/domains', headers, 'POST', { domains: ['new.example.test'] });
  assert.equal(result.status, 200);
  assert.equal(result.body.domainSync.status, 'pending');
  assert.equal(result.body.project.domains.syncedAt, null);
});

test('installer copies the DNS fallback dependency into the root-owned helper directory', async () => {
  const installer = await readFile(new URL('../dashboard-portal.sh', import.meta.url), 'utf8');
  assert.match(installer, /install -m 0644 -o root -g root "\$APP_ROOT\/scripts\/domain-dns\.mjs" "\$HELPER_ROOT\/domain-dns\.mjs"/);
});
