// Synthetic fixture only. This predictable key must never protect real data.
import assert from 'node:assert/strict';
import { stat, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { StateStore, SecretVault } from '../../src/core.mjs';
import { canAccess } from '../../src/access.mjs';
import { DatabaseSync } from '../../scripts/sqlite.mjs';
import { hashPassword } from '../../src/auth.mjs';
import { createApplication } from '../../src/server.mjs';

const key = Buffer.alloc(32, 0x46).toString('base64');
const credential = 'fixture-only-repository-token';
const environment = 'FIXTURE_ONLY_ENV=synthetic-value\n';
const at = '2026-10-01T00:00:00.000Z';
const password = 'Fixture-Only-Password-739!';
const passwordHash = hashPassword(password, Buffer.alloc(16, 0x46));
const user = { id: 'fixture-user', email: 'fixture@example.test', password: passwordHash, role: 'user', status: 'active', authVersion: 1, createdAt: at };
const master = { ...user, id: 'fixture-master', email: 'master@example.test', role: 'master' };
const owner = { email: master.email, password: passwordHash, createdAt: at };
const organization = { id: 'fixture-org', name: 'Fixture organization', createdAt: at };
const membership = { id: 'fixture-membership', userId: user.id, organizationId: organization.id, permissions: ['project.view', 'env.read', 'deploy.start'], createdAt: at };
const sessionToken = Buffer.alloc(32, 0x53).toString('base64url');
const session = { idHash: createHash('sha256').update(sessionToken).digest('base64url'), userId: user.id, authVersion: 1, csrf: Buffer.alloc(32, 0x43).toString('base64url'), expiresAt: 4102444800000 };

async function verifyHttp(path) {
  const app = await createApplication({ dataPath: path, secretKey: key, mode: 'demo', sandboxClone: false, metricsEnabled: false });
  await new Promise(resolveListen => app.server.listen(0, '127.0.0.1', resolveListen));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  try {
    const headers = { cookie: `hostmgr_session=${sessionToken}`, 'content-type': 'application/json', 'x-csrf-token': session.csrf };
    const restored = await (await fetch(`${base}/api/session`, { headers })).json();
    assert.equal(restored.authenticated, true);
    assert.equal(restored.bootstrapRequired, false);
    assert.equal(restored.user.id, user.id);
    const read = await fetch(`${base}/api/projects/fixture-app/environment`, { headers });
    assert.equal(read.status, 200);
    assert.equal((await read.json()).environment.content, environment);
    const denied = await fetch(`${base}/api/projects/fixture-app/environment`, { method: 'POST', headers, body: JSON.stringify({ content: 'REPLACED=no\n' }) });
    assert.equal(denied.status, 403);
    await denied.arrayBuffer();
    for (const identity of [user, master]) {
      const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: identity.email, password }) });
      assert.equal(login.status, 200);
      const body = await login.json();
      assert.equal(body.user.id, identity.id);
      assert.equal(body.user.role, identity.role);
      const loginHeaders = { cookie: login.headers.get('set-cookie').split(';')[0], 'x-csrf-token': body.csrfToken };
      assert.equal((await (await fetch(`${base}/api/session`, { headers: loginHeaders })).json()).authenticated, true);
      const logout = await fetch(`${base}/api/logout`, { method: 'POST', headers: loginHeaders });
      assert.equal(logout.status, 200);
      await logout.arrayBuffer();
    }
    assert.deepEqual(app.store.snapshot().sessions, [session]);
  } finally { await app.close(); }
}

export async function runFixture(mode, databasePath, snapshotPath) {
  assert.ok(['seed', 'verify'].includes(mode), 'Use seed or verify');
  assert.ok(databasePath, 'Pass an explicit disposable database path');
  const path = resolve(databasePath);
  const existing = await stat(path).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  assert.ok(mode === 'seed' ? !existing : existing?.isFile(), mode === 'seed' ? 'Seed refuses an existing database' : 'Verify requires an existing database');
  const store = new StateStore(path);
  await store.load();
  const vault = new SecretVault(key);
  if (mode === 'seed') {
    await store.update(state => {
      state.users = [master, user];
      state.owner = owner;
      state.legacyOwnerId = master.id;
      state.organizations = [organization];
      state.memberships = [membership];
      state.sessions = [session];
      state.credentials = [{ id: 'fixture-credential', name: 'Fixture token', type: 'https_token', host: 'github.com', encryptedSecret: vault.encrypt(credential) }];
      state.projects = [{ slug: 'fixture-app', name: 'Fixture application', repository: 'https://github.com/example/fixture.git', organizationId: organization.id, organization: organization.name, directory: '/', runtime: 'node', nodeMajor: 20, credentialId: 'fixture-credential', environment: { encryptedContent: vault.encrypt(environment) }, deployment: { state: 'idle', activeReleaseId: null, previousReleaseId: null, releases: [], updatedAt: at }, fixtureVisits: 0 }];
    });
  }
  const state = store.snapshot();
  assert.equal(state.schemaVersion, 4);
  assert.deepEqual(state.users, [master, user]);
  assert.deepEqual(state.owner, owner);
  assert.equal(state.legacyOwnerId, master.id);
  assert.deepEqual(state.organizations, [organization]);
  assert.deepEqual(state.memberships, [membership]);
  assert.deepEqual(state.sessions, [session]);
  assert.equal(state.projects[0].nodeMajor, 20, 'Persist selected project major across drivers');
  assert.equal(state.projects[0].credentialId, 'fixture-credential');
  assert.equal(vault.decrypt(state.credentials[0].encryptedSecret), credential);
  assert.equal(vault.decrypt(state.projects[0].environment.encryptedContent), environment);
  assert.equal(canAccess(state, user, organization.id, 'env.read'), true);
  assert.equal(canAccess(state, user, organization.id, 'env.write'), false);
  const wrongVault = new SecretVault(Buffer.alloc(32, 0x57).toString('base64'));
  assert.throws(() => wrongVault.decrypt(state.credentials[0].encryptedSecret));
  assert.throws(() => wrongVault.decrypt(state.projects[0].environment.encryptedContent));
  if (mode === 'verify') {
    await store.update(next => { next.projects[0].fixtureVisits += 1; });
    await verifyHttp(path);
  }
  const database = new DatabaseSync(path);
  let snapshotBytes = null;
  try {
    assert.equal(database.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    if (snapshotPath) {
      // VACUUM INTO creates a consistent SQLite snapshot; no live DB/WAL copying.
      const destination = resolve(snapshotPath);
      assert.notEqual(destination, path);
      database.prepare('VACUUM INTO ?').run(destination);
      const snapshot = new DatabaseSync(destination, { readOnly: true });
      try { assert.equal(snapshot.prepare('PRAGMA integrity_check').get().integrity_check, 'ok'); }
      finally { snapshot.close(); }
      const bytes = await readFile(destination);
      assert.equal(bytes.includes(Buffer.from(credential)), false);
      assert.equal(bytes.includes(Buffer.from(environment)), false);
      snapshotBytes = bytes.length;
    }
    database.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } finally { database.close(); }
  return { mode, node: process.version, driver: Number(process.versions.node.split('.')[0]) === 20 ? 'better-sqlite3' : 'node:sqlite', schemaVersion: state.schemaVersion, databaseBytes: (await stat(path)).size, snapshotBytes, fixtureVisits: store.snapshot().projects[0].fixtureVisits, counts: { users: 2, organizations: 1, memberships: 1, projects: 1, credentials: 1, preservedSessions: 1 }, checks: ['organizations', 'memberships', 'sessions', 'credential-decryption', 'environment-decryption', 'grant-preservation', 'selected-project-node-major', 'wrong-key-rejection', 'integrity-check', ...(mode === 'verify' ? ['restored-session-http', 'member-login-http', 'master-login-http', 'authorized-environment-read-http', 'denied-environment-write-http'] : []), ...(snapshotPath ? ['consistent-snapshot', 'plaintext-absent'] : [])] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(JSON.stringify(await runFixture(...process.argv.slice(2))));
}
