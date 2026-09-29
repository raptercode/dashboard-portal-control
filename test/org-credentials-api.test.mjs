import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { hashPassword } from '../src/auth.mjs';
import { SecretVault } from '../src/core.mjs';
import { start, login, request } from './support/server.mjs';

const PASSWORD = 'Org-Credentials-Testing-739!';
const password = hashPassword(PASSWORD);
const vault = new SecretVault(Buffer.alloc(32, 7).toString('base64'));
const ALL = ['credentials.use', 'credentials.create', 'credentials.update', 'credentials.delete'];
const PROJECT = ['project.view', 'project.create', 'project.configure', 'source.sync'];
const TOKENS = ['alpha-private-token-739', 'bravo-private-token-739', 'legacy-private-token-739'];

async function fixture(t, permissions = ALL, secondPermissions = [], options = {}) {
  const calls = [];
  const { app, base, dataPath } = await start({
    autoSyncPollingEnabled: false,
    branchFetcher: async ({ credential, vault: secrets }) => {
      calls.push({ operation: 'branches', credentialId: credential?.id, token: credential && secrets.decrypt(credential.encryptedToken) });
      return ['main', 'release'];
    },
    projectRuntimeDetector: async ({ credential, vault: secrets }) => {
      calls.push({ operation: 'detect', credentialId: credential?.id, token: credential && secrets.decrypt(credential.encryptedToken) });
      return { available: true, recommendedRuntime: 'node', confidence: 'high', evidence: [] };
    },
    projectSyncer: async (project, credential, secrets) => {
      calls.push({ operation: 'sync', credentialId: credential?.id, token: credential && secrets.decrypt(credential.encryptedToken) });
      return { status: 'synced', at: new Date().toISOString(), revision: `revision-${calls.length}`, detail: 'Fixture sync completed.' };
    },
    ...options
  });
  t.after(() => app.close());
  const userId = randomUUID();
  const orgA = randomUUID();
  const orgB = randomUUID();
  const credentials = TOKENS.map((token, index) => ({ id: randomUUID(), name: ['alpha-key', 'bravo-key', 'legacy-key'][index], type: 'https_token', host: 'github.com', ...(index < 2 ? { organizationId: [orgA, orgB][index] } : {}), encryptedToken: vault.encrypt(token), createdAt: new Date().toISOString() }));
  await app.store.update((state) => {
    state.organizations.push({ id: orgA, name: 'Alpha' }, { id: orgB, name: 'Bravo' });
    state.users.push({ id: userId, email: 'credential-member@example.test', password, role: 'user', status: 'active', authVersion: 1 });
    if (permissions.length) state.memberships.push({ userId, organizationId: orgA, permissions: [...permissions] });
    if (secondPermissions.length) state.memberships.push({ userId, organizationId: orgB, permissions: [...secondPermissions] });
    state.credentials.push(...credentials);
    state.tools.git.status = 'Installed';
    state.git.identity = { name: 'Fixture', email: 'fixture@example.test' };
  });
  return { app, base, dataPath, calls, userId, orgA, orgB, alpha: credentials[0], bravo: credentials[1], legacy: credentials[2], master: await login(base), member: await login(base, 'credential-member@example.test', PASSWORD) };
}

function noSecrets(value, extra = []) {
  const serialized = JSON.stringify(value);
  for (const secret of [...TOKENS, ...extra]) assert.equal(serialized.includes(secret), false, 'Plaintext secret must not appear in public output or audit');
  assert.equal(serialized.includes('encryptedToken'), false, 'Ciphertext must not be returned to clients');
}

function projectInput(organizationId, credentialId, extra = {}) {
  return { name: 'Private application', slug: 'private-app', organizationId, repository: 'https://github.com/example/private-app.git', branch: 'main', directory: '/', port: 3210, protocol: 'https', credentialId, ...extra };
}

for (const permission of ALL) {
  test(`User with only ${permission} can list org credential metadata without another org or legacy credential`, async (t) => {
    const { base, member, orgA, orgB, alpha } = await fixture(t, [permission]);
    for (const path of ['/api/credentials', `/api/credentials?organizationId=${orgA}`]) {
      const result = await request(base, path, member);
      assert.equal(result.status, 200);
      assert.deepEqual(result.body.credentials.map((item) => item.id), [alpha.id]);
      assert.equal(result.body.credentials[0].organizationId, orgA);
      noSecrets(result.body);
    }
    assert.equal((await request(base, `/api/credentials?organizationId=${orgB}`, member)).status, 404);
  });
}

test('Anonymous, unassigned and project-only members cannot inspect credential metadata', async (t) => {
  const { app, base, member, userId, orgA } = await fixture(t, []);
  assert.equal((await request(base, '/api/credentials')).status, 401);
  assert.deepEqual((await request(base, '/api/credentials', member)).body.credentials, []);
  assert.equal((await request(base, `/api/credentials?organizationId=${orgA}`, member)).status, 404);
  await app.store.update((state) => { state.memberships.push({ userId, organizationId: orgA, permissions: ['project.view'] }); });
  assert.equal((await request(base, `/api/credentials?organizationId=${orgA}`, member)).status, 403);
  assert.deepEqual((await request(base, '/api/credentials', member)).body.credentials, []);
});

test('Master can inspect legacy credentials while multi-org members see only permitted org metadata', async (t) => {
  const { base, master, member, alpha, bravo, legacy } = await fixture(t, ['credentials.use'], ['credentials.update']);
  assert.deepEqual(new Set((await request(base, '/api/credentials', member)).body.credentials.map((item) => item.id)), new Set([alpha.id, bravo.id]));
  const result = await request(base, '/api/credentials', master);
  assert.equal(result.status, 200);
  assert.ok(result.body.credentials.some((item) => item.id === legacy.id));
  noSecrets(result.body);
});

test('Credential create/update/delete grants are independent and do not borrow grants from another org', async (t) => {
  const { app, base, member, orgA, orgB, alpha, bravo } = await fixture(t, ['credentials.create'], ['credentials.update', 'credentials.delete']);
  const create = { organizationId: orgA, name: 'member-key', host: 'github.com', token: 'created-by-member-secret' };
  const created = await request(base, '/api/credentials', member, 'POST', create);
  assert.equal(created.status, 201, JSON.stringify(created));
  assert.equal(created.body.credential.organizationId, orgA);
  noSecrets(created.body, [create.token]);
  assert.equal((await request(base, '/api/credentials', member, 'POST', { ...create, organizationId: orgB })).status, 403);
  assert.equal((await request(base, `/api/credentials/${alpha.id}`, member, 'PATCH', { name: 'forbidden-rename' })).status, 403);
  assert.equal((await request(base, `/api/credentials/${alpha.id}`, member, 'DELETE', {})).status, 403);
  assert.equal((await request(base, `/api/credentials/${bravo.id}`, member, 'PATCH', { name: 'allowed-rename' })).status, 200);
  assert.equal((await request(base, `/api/credentials/${bravo.id}`, member, 'DELETE', {})).status, 200);
  assert.equal((await request(base, '/api/credentials', member, 'POST', { ...create, name: 'default-escalation', defaultCredential: true })).status, 403);
  assert.equal(app.store.snapshot().credentials.some((item) => item.name === 'default-escalation'), false);
  assert.equal((await request(base, '/api/credentials/default', member, 'POST', { organizationId: orgA, credentialId: alpha.id })).status, 403);
});

test('Creation requires org scope and rejects duplicate names only within the same organization', async (t) => {
  const { base, member, orgA, orgB } = await fixture(t, ALL, ALL);
  const body = { name: 'shared-label', token: 'same-label-private-token' };
  assert.ok([400, 403].includes((await request(base, '/api/credentials', member, 'POST', body)).status));
  assert.equal((await request(base, '/api/credentials', member, 'POST', { ...body, organizationId: orgA })).status, 201);
  assert.equal((await request(base, '/api/credentials', member, 'POST', { ...body, organizationId: orgB })).status, 201);
  assert.equal((await request(base, '/api/credentials', member, 'POST', { ...body, organizationId: orgA })).status, 400);
});

test('Credential mutation cannot transfer ownership or reach hidden and legacy credentials', async (t) => {
  const { app, base, member, orgA, orgB, alpha, bravo, legacy } = await fixture(t);
  for (const credential of [bravo, legacy]) {
    assert.equal((await request(base, `/api/credentials/${credential.id}`, member, 'PATCH', { organizationId: orgA, name: 'stolen' })).status, 404);
    assert.equal((await request(base, `/api/credentials/${credential.id}`, member, 'DELETE', { organizationId: orgA })).status, 404);
  }
  assert.ok([400, 403].includes((await request(base, `/api/credentials/${alpha.id}`, member, 'PATCH', { organizationId: orgB })).status));
  assert.equal(app.store.snapshot().credentials.find((item) => item.id === alpha.id).organizationId, orgA);
});

test('Every credential mutation requires CSRF, including rotation and clearing a default', async (t) => {
  const { app, base, member, orgA, alpha } = await fixture(t);
  const headers = { cookie: member.cookie, 'content-type': 'application/json' };
  const before = app.store.snapshot().credentials;
  for (const [path, method, body] of [
    ['/api/credentials', 'POST', { organizationId: orgA, name: 'csrf-key', token: 'csrf-token-value' }],
    [`/api/credentials/${alpha.id}`, 'PATCH', { token: 'csrf-rotation-value' }],
    [`/api/credentials/${alpha.id}`, 'DELETE', {}],
    ['/api/credentials/default', 'POST', { organizationId: orgA, credentialId: null }]
  ]) assert.equal((await request(base, path, headers, method, body)).status, 403, path);
  assert.deepEqual(app.store.snapshot().credentials, before);
});

test('Org defaults are isolated, cannot select foreign credentials and clear when the credential is deleted', async (t) => {
  const { base, member, orgA, orgB, alpha, bravo, legacy } = await fixture(t, ALL, ALL);
  for (const [organizationId, credentialId] of [[orgA, alpha.id], [orgB, bravo.id]]) {
    const result = await request(base, '/api/credentials/default', member, 'POST', { organizationId, credentialId });
    assert.equal(result.status, 200, JSON.stringify(result));
    assert.equal(result.body.defaultCredentialId, credentialId);
    assert.ok(result.body.credentials.every((item) => item.organizationId === organizationId));
    noSecrets(result.body);
  }
  for (const credentialId of [bravo.id, legacy.id]) assert.ok([400, 403, 404].includes((await request(base, '/api/credentials/default', member, 'POST', { organizationId: orgA, credentialId })).status));
  assert.equal((await request(base, `/api/credentials?organizationId=${orgA}`, member)).body.defaultCredentialId, alpha.id);
  assert.equal((await request(base, '/api/credentials/default', member, 'POST', { organizationId: orgA, credentialId: null })).status, 200);
  assert.equal((await request(base, `/api/credentials?organizationId=${orgA}`, member)).body.defaultCredentialId, null);
  assert.equal((await request(base, `/api/credentials?organizationId=${orgB}`, member)).body.defaultCredentialId, bravo.id);
  assert.equal((await request(base, `/api/credentials/${bravo.id}`, member, 'DELETE', {})).status, 200);
  assert.equal((await request(base, `/api/credentials?organizationId=${orgB}`, member)).body.defaultCredentialId, null);
});

test('Member can inspect branches, detect runtime and create a private project with an authorized org token', async (t) => {
  const { base, member, orgA, alpha, calls } = await fixture(t, [...PROJECT, 'credentials.use']);
  const body = projectInput(orgA, alpha.id);
  for (const path of ['/api/git/branches', '/api/projects/runtime-detect', '/api/projects/sync']) {
    const result = await request(base, path, member, 'POST', body);
    assert.equal(result.status, 200, `${path}: ${JSON.stringify(result)}`);
    noSecrets(result.body);
  }
  assert.deepEqual(calls.map((call) => call.operation), ['branches', 'detect', 'sync']);
  assert.ok(calls.every((call) => call.credentialId === alpha.id && call.token === TOKENS[0]));
});

test('Use requires both project permission and same-org credential; rejected requests never contact Git', async (t) => {
  const { app, base, member, userId, orgA, alpha, bravo, legacy, calls } = await fixture(t, PROJECT);
  const paths = ['/api/git/branches', '/api/projects/runtime-detect', '/api/projects/sync'];
  for (const path of paths) assert.equal((await request(base, path, member, 'POST', projectInput(orgA, alpha.id))).status, 403);
  await app.store.update((state) => { state.memberships.find((item) => item.userId === userId).permissions = [...PROJECT, 'credentials.use']; });
  for (const path of paths) for (const credential of [bravo, legacy]) {
    assert.ok([403, 404].includes((await request(base, path, member, 'POST', projectInput(orgA, credential.id))).status), path);
  }
  await app.store.update((state) => { state.memberships.find((item) => item.userId === userId).permissions = ['credentials.use']; });
  for (const path of paths) assert.equal((await request(base, path, member, 'POST', projectInput(orgA, alpha.id))).status, 403);
  assert.equal(calls.length, 0);
});

test('Rotation changes the token used by bound sync, blank token preserves it, and secrets stay encrypted at rest', async (t) => {
  const { app, base, dataPath, member, orgA, alpha, calls } = await fixture(t, [...ALL, ...PROJECT]);
  const body = projectInput(orgA, alpha.id);
  assert.equal((await request(base, '/api/projects/sync', member, 'POST', body)).status, 200);
  const rotated = 'rotated-org-secret-739';
  const changed = await request(base, `/api/credentials/${alpha.id}`, member, 'PATCH', { name: 'rotated-label', token: rotated });
  assert.equal(changed.status, 200, JSON.stringify(changed));
  noSecrets(changed.body, [rotated]);
  const stored = app.store.snapshot().credentials.find((item) => item.id === alpha.id);
  assert.equal(vault.decrypt(stored.encryptedToken), rotated);
  assert.equal((await request(base, `/api/credentials/${alpha.id}`, member, 'PATCH', { name: 'renamed-again', token: '' })).status, 200);
  assert.deepEqual(app.store.snapshot().credentials.find((item) => item.id === alpha.id).encryptedToken, stored.encryptedToken);
  assert.equal((await request(base, '/api/projects/sync', member, 'POST', body)).status, 200);
  assert.deepEqual(calls.filter((call) => call.operation === 'sync').map((call) => call.token), [TOKENS[0], rotated]);
  noSecrets(app.store.snapshot().audit, [rotated]);
  for (const path of ['/api/credentials', '/api/projects']) noSecrets((await request(base, path, member)).body, [rotated]);
  // SQLite writes recent transactions to WAL before checkpointing the main file.
  const persisted = Buffer.concat(await Promise.all([dataPath, `${dataPath}-wal`].map((path) => readFile(path).catch((error) => {
    if (error.code === 'ENOENT' && path.endsWith('-wal')) return Buffer.alloc(0);
    throw error;
  }))));
  for (const token of [...TOKENS, rotated]) assert.equal(persisted.includes(Buffer.from(token)), false);
});

test('Used credentials cannot be deleted or retargeted to a host that breaks a bound project', async (t) => {
  const { app, base, member, orgA, alpha } = await fixture(t, [...ALL, ...PROJECT]);
  assert.equal((await request(base, '/api/projects/sync', member, 'POST', projectInput(orgA, alpha.id))).status, 200);
  assert.ok([400, 409].includes((await request(base, `/api/credentials/${alpha.id}`, member, 'DELETE', {})).status));
  assert.ok([400, 409].includes((await request(base, `/api/credentials/${alpha.id}`, member, 'PATCH', { host: 'gitlab.example.test' })).status));
  assert.equal(app.store.snapshot().credentials.find((item) => item.id === alpha.id).host, 'github.com');
});

test('Removing credential grants takes effect in the existing session while bound source sync remains permitted', async (t) => {
  const { app, base, member, userId, orgA, alpha, calls } = await fixture(t, [...ALL, ...PROJECT]);
  const body = projectInput(orgA, alpha.id);
  assert.equal((await request(base, '/api/projects/sync', member, 'POST', body)).status, 200);
  await app.store.update((state) => { state.memberships.find((item) => item.userId === userId).permissions = [...PROJECT]; });
  assert.equal((await request(base, `/api/credentials?organizationId=${orgA}`, member)).status, 403);
  assert.equal((await request(base, `/api/credentials/${alpha.id}`, member, 'PATCH', { token: 'revoked-change' })).status, 403);
  assert.equal((await request(base, `/api/credentials/${alpha.id}`, member, 'DELETE', {})).status, 403);
  assert.equal((await request(base, '/api/projects/sync', member, 'POST', body)).status, 200);
  const before = calls.length;
  assert.equal((await request(base, '/api/projects/sync', member, 'POST', { ...body, repository: 'https://github.com/attacker/other.git' })).status, 403);
  assert.equal((await request(base, '/api/projects/sync', member, 'POST', { ...body, credentialId: null })).status, 403);
  assert.equal(calls.length, before);
});

test('Bound legacy credentials remain syncable but cannot be rebound or sent to a replacement repository by a member', async (t) => {
  const { base, master, member, orgA, alpha, legacy, calls } = await fixture(t, [...ALL, ...PROJECT]);
  const body = projectInput(orgA, legacy.id);
  assert.equal((await request(base, '/api/projects/sync', master, 'POST', body)).status, 200);
  assert.equal((await request(base, '/api/projects/sync', member, 'POST', body)).status, 200);
  const before = calls.length;
  for (const changes of [{ credentialId: alpha.id }, { repository: 'https://github.com/example/other.git' }]) {
    assert.equal((await request(base, '/api/projects/sync', member, 'POST', { ...body, ...changes })).status, 403);
  }
  assert.equal(calls.length, before);
});

test('Changing an unused credential host requires a replacement token', async (t) => {
  const { app, base, member, alpha } = await fixture(t, ['credentials.update']);
  assert.equal((await request(base, `/api/credentials/${alpha.id}`, member, 'PATCH', { host: 'gitlab.example.test' })).status, 400);
  const replacement = 'replacement-host-specific-secret';
  const result = await request(base, `/api/credentials/${alpha.id}`, member, 'PATCH', { host: 'gitlab.example.test', token: replacement });
  assert.equal(result.status, 200);
  noSecrets(result.body, [replacement]);
  const stored = app.store.snapshot().credentials.find((item) => item.id === alpha.id);
  assert.equal(stored.host, 'gitlab.example.test');
  assert.equal(vault.decrypt(stored.encryptedToken), replacement);
});

test('Rebinding a project to another same-org credential requires both use and configuration permission', async (t) => {
  const { app, base, master, member, userId, orgA, alpha, calls } = await fixture(t, [...PROJECT, 'credentials.use']);
  const body = projectInput(orgA, alpha.id);
  assert.equal((await request(base, '/api/projects/sync', member, 'POST', body)).status, 200);
  const created = await request(base, '/api/credentials', master, 'POST', { organizationId: orgA, name: 'replacement-key', token: 'same-org-rebind-secret' });
  assert.equal(created.status, 201);
  const replacement = { ...body, credentialId: created.body.credential.id, repository: 'https://github.com/example/another-private.git' };
  assert.equal((await request(base, '/api/projects/sync', member, 'POST', replacement)).status, 200);
  assert.equal(calls.at(-1).token, 'same-org-rebind-secret');
  await app.store.update((state) => { state.memberships.find((item) => item.userId === userId).permissions = ['project.view', 'source.sync', 'credentials.use']; });
  const before = calls.length;
  assert.equal((await request(base, '/api/projects/sync', member, 'POST', body)).status, 403);
  assert.equal(calls.length, before);
});

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

for (const operation of ['create', 'rotate', 'delete', 'default']) {
  test(`Queued credential ${operation} rechecks revoked grants before committing`, { timeout: 10000 }, async (t) => {
    const { app, base, member, userId, orgA, alpha } = await fixture(t);
    const entered = deferred();
    const release = deferred();
    const queued = deferred();
    t.after(() => release.resolve());
    const blocker = app.store.update(async (state) => {
      entered.resolve();
      await release.promise;
      state.memberships.find((item) => item.userId === userId).permissions = ['project.view'];
    });
    await entered.promise;
    const originalUpdate = app.store.update.bind(app.store);
    app.store.update = (mutate) => { queued.resolve(); return originalUpdate(mutate); };
    const [path, method, body] = {
      create: ['/api/credentials', 'POST', { organizationId: orgA, name: 'queued-key', token: 'queued-secret' }],
      rotate: [`/api/credentials/${alpha.id}`, 'PATCH', { token: 'queued-rotation' }],
      delete: [`/api/credentials/${alpha.id}`, 'DELETE', {}],
      default: ['/api/credentials/default', 'POST', { organizationId: orgA, credentialId: alpha.id }]
    }[operation];
    const before = app.store.snapshot().credentials;
    const pending = request(base, path, member, method, body);
    await queued.promise;
    release.resolve();
    await blocker;
    assert.equal((await pending).status, 403);
    assert.deepEqual(app.store.snapshot().credentials, before);
    assert.equal(app.store.snapshot().organizations.find((org) => org.id === orgA).defaultCredentialId ?? null, null);
  });
}

for (const concurrentChange of ['host rotation', 'deletion']) {
  test(`First project sync cannot commit a stale credential after concurrent ${concurrentChange}`, { timeout: 10000 }, async (t) => {
    const entered = deferred();
    const resume = deferred();
    t.after(() => resume.resolve());
    const { app, base, master, member, orgA, alpha } = await fixture(t, [...ALL, ...PROJECT], [], {
      projectSyncer: async (_project, credential, secrets) => {
        assert.equal(secrets.decrypt(credential.encryptedToken), TOKENS[0]);
        entered.resolve();
        await resume.promise;
        return { status: 'synced', at: new Date().toISOString(), revision: 'stale-credential-revision', detail: 'Paused first sync completed.' };
      }
    });
    const pending = request(base, '/api/projects/sync', member, 'POST', projectInput(orgA, alpha.id));
    await entered.promise;
    assert.equal(app.store.snapshot().projects.some((project) => project.slug === 'private-app'), false);
    const changed = concurrentChange === 'host rotation'
      ? await request(base, `/api/credentials/${alpha.id}`, master, 'PATCH', { host: 'gitlab.example.test', token: 'different-host-rotated-token' })
      : await request(base, `/api/credentials/${alpha.id}`, master, 'DELETE', {});
    assert.equal(changed.status, 200, JSON.stringify(changed));
    resume.resolve();
    const result = await pending;
    assert.equal(result.status, concurrentChange === 'host rotation' ? 400 : 403, JSON.stringify(result));
    noSecrets(result.body, ['different-host-rotated-token']);
    assert.equal(app.store.snapshot().projects.some((project) => project.slug === 'private-app'), false);
    assert.equal(app.store.snapshot().audit.some((event) => event.action === 'project.sync_configure' && event.target === 'private-app'), false);
  });
}

test('Background source polling reloads a rotated org credential without an application restart', { timeout: 10000 }, async (t) => {
  const observed = deferred();
  const rotated = 'background-poll-rotated-token';
  const { base, member, orgA, alpha } = await fixture(t, [...ALL, ...PROJECT], [], {
    autoSyncPollingEnabled: true,
    autoSyncIntervalMs: 15,
    projectSyncer: async (_project, credential, secrets) => {
      const token = secrets.decrypt(credential.encryptedToken);
      if (token === rotated) observed.resolve({ credentialId: credential.id, token });
      return { status: 'synced', at: new Date().toISOString(), revision: 'poll-stable-revision', detail: 'Background polling fixture.' };
    }
  });
  assert.equal((await request(base, '/api/projects/sync', member, 'POST', projectInput(orgA, alpha.id))).status, 200);
  assert.equal((await request(base, `/api/credentials/${alpha.id}`, member, 'PATCH', { token: rotated })).status, 200);
  // No second HTTP sync: only the application's background poll can observe this token.
  assert.deepEqual(await observed.promise, { credentialId: alpha.id, token: rotated });
});
