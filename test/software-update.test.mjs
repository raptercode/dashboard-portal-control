import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalJson, compareVersions, parseSignedManifest, softwareUpdateStatus, updateConfiguration } from '../scripts/software-update.mjs';
import { createApplication } from '../src/server.mjs';

function signedManifest(privateKey, version = '0.2.1') {
  const payload = {
    channel: 'stable',
    version,
    publishedAt: '2026-08-08T00:00:00.000Z',
    archiveUrl: 'https://releases.example.test/dashboard-portal.tar.gz',
    archiveSha256: 'a'.repeat(64),
    notes: 'Security fixes'
  };
  return { payload, signature: sign(null, Buffer.from(canonicalJson(payload)), privateKey).toString('base64') };
}

test('signed update manifests verify and compare semantic versions', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const manifest = signedManifest(privateKey);
  const parsed = parseSignedManifest(manifest, publicKey.export({ type: 'spki', format: 'pem' }));
  assert.equal(parsed.version, '0.2.1');
  assert.equal(compareVersions('0.2.1', '0.2.0'), 1);
  assert.equal(compareVersions('0.2.0', '0.2.0'), 0);
  manifest.payload.version = '0.2.2';
  assert.throws(() => parseSignedManifest(manifest, publicKey.export({ type: 'spki', format: 'pem' })), /signature/);
});

test('software update status fails closed when the manifest cannot be verified', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const directory = await mkdtemp(join(tmpdir(), 'hostmgr-update-'));
  const keyPath = join(directory, 'update-public.pem');
  await writeFile(keyPath, publicKey.export({ type: 'spki', format: 'pem' }));
  const config = updateConfiguration({ manifestUrl: 'https://updates.example.test/stable.json', publicKeyPath: keyPath, channel: 'stable' });
  const available = await softwareUpdateStatus({ config, currentVersion: '0.2.0', fetcher: async () => new Response(JSON.stringify(signedManifest(privateKey)), { status: 200, headers: { 'content-type': 'application/json' } }) });
  assert.equal(available.status, 'available');
  const unavailable = await softwareUpdateStatus({ config, currentVersion: '0.2.0', fetcher: async () => new Response('{}', { status: 200 }) });
  assert.deepEqual(unavailable, { configured: true, status: 'unavailable', channel: 'stable', currentVersion: '0.2.0', checkedAt: unavailable.checkedAt, issue: 'Update manifest could not be verified.' });
});

test('software update API needs an owner session and never exposes signing material', async (t) => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const directory = await mkdtemp(join(tmpdir(), 'hostmgr-update-api-'));
  const keyPath = join(directory, 'update-public.pem');
  await writeFile(keyPath, publicKey.export({ type: 'spki', format: 'pem' }));
  const app = await createApplication({
    dataPath: join(directory, 'state.json'),
    password: 'correct-horse-battery-staple',
    secretKey: Buffer.alloc(32, 8).toString('base64'),
    mode: 'demo',
    sandboxClone: false,
    softwareVersion: '0.2.0',
    updateConfig: { manifestUrl: 'https://updates.example.test/stable.json', publicKeyPath: keyPath, channel: 'stable' },
    updateFetcher: async () => new Response(JSON.stringify(signedManifest(privateKey)), { status: 200, headers: { 'content-type': 'application/json' } })
  });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  assert.equal((await fetch(`${base}/api/software-update`)).status, 401);
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'owner@local.test', password: 'correct-horse-battery-staple' }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const response = await fetch(`${base}/api/software-update`, { headers: { cookie } });
  const body = await response.json();
  assert.equal(body.status, 'available');
  assert.equal(JSON.stringify(body).includes('BEGIN PUBLIC KEY'), false);
  assert.equal(JSON.stringify(body).includes('signature'), false);
});
