import test from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareGitCredentials, assertSafeGitRepositoryConfig } from '../src/git-credentials.mjs';

const execute = promisify(execFile);
const token = 'synthetic-local-git-token';
const vault = { decrypt: () => token };
const credential = { host: 'localhost', encryptedToken: 'fixture' };
const revision = 'a'.repeat(40);

async function workspace(t) {
  const root = await mkdtemp(join(tmpdir(), 'portal-git-credentials-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function tlsFixture(t, root) {
  // Generate a disposable loopback certificate. No private keys are committed.
  let openssl;
  const candidates = ['openssl', ...(process.platform === 'win32' ? [join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'usr', 'bin', 'openssl.exe')] : [])];
  for (const candidate of candidates) { try { await execute(candidate, ['version']); openssl = candidate; break; } catch {} }
  if (!openssl) { t.skip('OpenSSL is needed for the real Git HTTPS transport regression'); return null; }
  const certificate = join(root, 'loopback.crt');
  const key = join(root, 'loopback.key');
  await execute(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', certificate, '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1']);
  return { certificate, key: await readFile(key), cert: await readFile(certificate) };
}

async function endpoint(t, tls, handler) {
  const server = https.createServer(tls, handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `https://localhost:${server.address().port}`;
}

function authenticatedRepository(request, response) {
  if (request.headers.authorization !== `Basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`) {
    response.writeHead(401, { 'WWW-Authenticate': 'Basic realm="local-fixture"' });
    return response.end();
  }
  response.setHeader('Content-Type', 'text/plain');
  response.end(request.url.startsWith('/repo.git/info/refs') ? `${revision}\trefs/heads/main\n` : 'ref: refs/heads/main\n');
}

async function lsRemote(authentication, repository, certificate, extraArgs = []) {
  return execute('git', [...authentication.args, '-c', `http.sslCAInfo=${certificate}`, ...extraArgs, 'ls-remote', '--heads', repository], { env: authentication.env, cwd: authentication.cwd, timeout: 15_000 });
}

test('Authenticated Git succeeds on the approved HTTPS authority and ignores ambient configuration', async (t) => {
  const root = await workspace(t);
  const tls = await tlsFixture(t, root); if (!tls) return;
  let authorized = 0;
  const origin = await endpoint(t, tls, (request, response) => { if (request.headers.authorization) authorized++; authenticatedRepository(request, response); });
  let foreignRequests = 0;
  const foreign = await endpoint(t, tls, (request, response) => { foreignRequests++; response.writeHead(403); response.end(); });
  const globalConfig = join(root, 'ambient-config');
  await writeFile(globalConfig, `[url "${foreign}/"]\n\tinsteadOf = ${origin}/\n[credential]\n\thelper = store\n`);
  const authentication = await prepareGitCredentials({ repository: `${origin}/repo.git`, credential, vault, scratchRoot: root, environment: { ...process.env, GIT_CONFIG_GLOBAL: globalConfig, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: `url.${foreign}/.insteadOf`, GIT_CONFIG_VALUE_0: `${origin}/`, GIT_TRACE_CURL: '1', GIT_SSL_NO_VERIFY: '1', HOSTMGR_GIT_TOKEN_FILE: 'ambient-secret' } });
  t.after(authentication.cleanup);
  const result = await lsRemote(authentication, `${origin}/repo.git`, tls.certificate);
  assert.match(result.stdout, new RegExp(`${revision}\\s+refs/heads/main`));
  assert.ok(authorized > 0);
  assert.equal(foreignRequests, 0);
  assert.equal(authentication.env.GIT_CONFIG_COUNT, undefined);
  assert.equal(authentication.env.GIT_TRACE_CURL, undefined);
  assert.equal(authentication.env.GIT_SSL_NO_VERIFY, undefined);
  assert.equal(JSON.stringify(authentication.args).includes(token), false);
  await authentication.cleanup();
  assert.equal((await readdir(root)).some((name) => name.startsWith('.git-auth-')), false);
});

test('Authenticated Git blocks redirects and askpass refuses a redirected authority even if redirects are enabled', async (t) => {
  const root = await workspace(t);
  const tls = await tlsFixture(t, root); if (!tls) return;
  let foreignRequests = 0;
  let foreignAuthorization = false;
  const foreign = await endpoint(t, tls, (request, response) => { foreignRequests++; foreignAuthorization ||= Boolean(request.headers.authorization); authenticatedRepository(request, response); });
  const origin = await endpoint(t, tls, (request, response) => { response.writeHead(302, { Location: `${foreign.replace('localhost', '127.0.0.1')}${request.url}` }); response.end(); });
  const repository = `${origin}/repo.git`;
  const authentication = await prepareGitCredentials({ repository, credential, vault, scratchRoot: root });
  t.after(authentication.cleanup);
  await assert.rejects(lsRemote(authentication, repository, tls.certificate));
  assert.equal(foreignRequests, 0);
  await assert.rejects(lsRemote(authentication, repository, tls.certificate, ['-c', 'http.followRedirects=true']));
  assert.ok(foreignRequests > 0);
  assert.equal(foreignAuthorization, false);
});

test('Existing repository transport overrides are refused before authenticated fetch', async (t) => {
  const root = await workspace(t);
  const repository = join(root, 'checkout');
  await execute('git', ['init', repository]);
  const authentication = await prepareGitCredentials({ repository: 'https://localhost/repo.git', credential, vault, scratchRoot: root });
  t.after(authentication.cleanup);
  await assertSafeGitRepositoryConfig(repository, authentication);
  for (const key of ['url.https://other.example/.insteadOf', 'http.https://localhost/.followRedirects', 'credential.helper']) {
    await execute('git', ['-C', repository, 'config', '--local', key, 'unsafe-fixture']);
    await assert.rejects(assertSafeGitRepositoryConfig(repository, authentication), /local Git transport overrides/);
    await execute('git', ['-C', repository, 'config', '--local', '--unset', key]);
  }
});

test('Authentication preparation cleans up on decryption failure and rejects host/userinfo mismatches', async (t) => {
  const root = await workspace(t);
  await assert.rejects(prepareGitCredentials({ repository: 'https://localhost/repo.git', credential, vault: { decrypt: () => { throw new Error('Fixture decryption failed'); } }, scratchRoot: root }), /Fixture decryption failed/);
  assert.deepEqual(await readdir(root), []);
  for (const repository of ['https://elsewhere.example/repo.git', 'https://username@localhost/repo.git', 'http://localhost/repo.git']) await assert.rejects(prepareGitCredentials({ repository, credential, vault, scratchRoot: root }), /plain HTTPS/);
  assert.deepEqual(await readdir(root), []);
});

test('Authenticated URLs normalize the default HTTPS port and pin English prompts', async (t) => {
  const root = await workspace(t);
  const authentication = await prepareGitCredentials({ repository: 'https://localhost:443/repo.git', credential, vault, scratchRoot: root, environment: { ...process.env, LC_ALL: 'th_TH.UTF-8', LANG: 'th_TH.UTF-8' } });
  t.after(authentication.cleanup);
  assert.equal(authentication.repository, 'https://localhost/repo.git');
  assert.equal(authentication.env.HOSTMGR_GIT_AUTHORITY, 'localhost');
  assert.equal(authentication.env.LC_ALL, 'C');
});
