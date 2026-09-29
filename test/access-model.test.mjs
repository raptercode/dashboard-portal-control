import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from '../scripts/sqlite.mjs';
import { StateStore, appendAudit } from '../src/core.mjs';
import { requestContext } from '../src/request-context.mjs';
import { resetDemoOwnerPassword } from '../scripts/reset-demo-password.mjs';
import { invalidateStoredSessions } from '../scripts/password-config.mjs';
import { hashPassword, verifyPassword } from '../src/auth.mjs';
import { PERMISSIONS, PERMISSION_PRESETS, migrateAccessState, publicUser, permissionsFor, canAccess, visibleOrganizations, resolveProjectOrganization } from '../src/access.mjs';

test('legacy access migration preserves identity and never restores edited or deleted owner', () => {
  const state = { owner: { email: 'owner@example.test', password: { hash: 'secret' } }, sessions: [{ idHash: 'legacy' }], projects: [{ slug: 'a', organization: 'Acme' }, { slug: 'b', organization: 'Acme' }] };
  migrateAccessState(state);
  const ownerId = state.users[0].id;
  assert.equal(state.users[0].role, 'master');
  assert.equal(state.sessions[0].userId, ownerId);
  assert.equal(state.sessions[0].authVersion, 1);
  assert.equal(state.projects[0].organizationId, state.projects[1].organizationId);
  state.users[0].status = 'disabled';
  state.users[0].role = 'user';
  state.users[0].password = 'changed';
  state.users[0].authVersion = 2;
  const before = structuredClone(state);
  migrateAccessState(state);
  assert.deepEqual(state, before);
  state.users = [];
  migrateAccessState(state);
  assert.deepEqual(state.users, []);
});

test('permissions isolate organizations and consult current account status and role', () => {
  const user = { id: 'u', role: 'user', status: 'active' };
  const state = { users: [user], organizations: [{ id: 'a', name: 'A', secret: 'hidden' }, { id: 'b', name: 'B' }], memberships: [{ userId: 'u', organizationId: 'a', permissions: ['project.view', 'logs.read', 'invented'] }] };
  assert.deepEqual(permissionsFor(state, user, 'a'), ['project.view', 'logs.read']);
  assert.equal(canAccess(state, user, 'b', 'project.view'), false);
  assert.equal(canAccess(state, { ...user, role: 'master' }, 'b', 'project.view'), false);
  assert.equal(canAccess(state, user, 'a', 'deploy.start'), false);
  assert.equal(visibleOrganizations(state, user)[0].secret, undefined);
  state.memberships[0].permissions = ['deploy.start'];
  assert.equal(canAccess(state, user, 'a', 'project.view'), false);
  state.users[0].status = 'disabled';
  assert.deepEqual(permissionsFor(state, { ...user, status: 'active' }, 'a'), []);
  assert.deepEqual(visibleOrganizations(state, user), []);
  assert.equal(canAccess(state, { id: 'missing', role: 'master', status: 'active' }, 'a', 'project.view'), false);
});

test('master grants only known permissions in existing organizations; presets and public records are safe', () => {
  const user = { id: 'm', role: 'master', status: 'active', password: 'secret', token: 'secret', authVersion: 9 };
  const state = { users: [user], organizations: [{ id: 'a', name: 'A' }] };
  assert.deepEqual(permissionsFor(state, user, 'a'), PERMISSIONS.map(({ id }) => id));
  assert.equal(canAccess(state, user, 'a', 'project.delete'), false);
  assert.equal(canAccess(state, user, 'missing', 'project.view'), false);
  assert.equal(publicUser(user).password, undefined);
  assert.equal(publicUser(user).token, undefined);
  assert.equal(publicUser(user).authVersion, undefined);
  assert.deepEqual(PERMISSION_PRESETS.maintainer, PERMISSIONS.map(({ id }) => id));
  assert.equal(PERMISSION_PRESETS.viewer.includes('env.read'), false);
  assert.equal(PERMISSION_PRESETS.operator.includes('deploy.start'), true);
  assert.equal(resolveProjectOrganization(state, { organization: 'A' }).id, 'a');
  assert.equal(resolveProjectOrganization(state, { organizationId: 'missing', organization: 'A' }), null);
});

test('SQLite load persists legacy migration once, with stable IDs and revoked access on restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'portal-access-'));
  const path = join(directory, 'state.sqlite');
  const initial = new StateStore(path);
  await initial.load();
  await initial.update((state) => {
    state.owner = { email: 'owner@example.test', password: 'secret' };
    state.projects.push({ slug: 'app', organization: 'Acme' });
    state.sessions.push({ idHash: 'legacy' });
  });
  const migrated = await new StateStore(path).load();
  const database = new DatabaseSync(path);
  assert.deepEqual(JSON.parse(database.prepare('SELECT value FROM portal_meta WHERE key = ?').get('users').value), migrated.users);
  database.close();
  const reopened = new StateStore(path);
  assert.deepEqual(await reopened.load(), migrated);
  await reopened.update((state) => { state.users[0].status = 'disabled'; state.users[0].authVersion += 1; state.memberships.push({ userId: state.users[0].id, organizationId: state.organizations[0].id, permissions: ['project.view'] }); state.invitations.push({ id: 'invite', tokenHash: 'hash' }); });
  assert.deepEqual(await new StateStore(path).load(), reopened.snapshot());
  const committed = reopened.snapshot();
  await assert.rejects(reopened.update((state) => { state.users[0].status = 'active'; state.jobs.push({ id: 'invalid' }); }));
  assert.deepEqual(reopened.snapshot(), committed);
  assert.deepEqual(await new StateStore(path).load(), committed);
});

test('audit uses request actor and explicit organization, leaving background actor intact', () => {
  const state = { projects: [{ slug: 'app', organizationId: 'org-a' }], audit: [] };
  requestContext.run({ user: { id: 'user-a' }, organizationId: 'org-b' }, () => {
    appendAudit(state, { actor: 'owner', action: 'deploy', target: 'app', organizationId: 'org-c' });
  });
  assert.equal(state.audit[0].actor, 'user-a');
  assert.equal(state.audit[0].actorUserId, 'user-a');
  assert.equal(state.audit[0].organizationId, 'org-c');
  assert.equal(state.audit[0].projectSlug, 'app');
  appendAudit(state, { actor: 'system', action: 'poll', target: 'app' });
  assert.equal(state.audit[0].actor, 'system');
  assert.equal(state.audit[0].organizationId, 'org-a');
});

test('local password resets update migrated credentials without restoring role or disabled status', async () => {
  for (const reset of [async (path) => resetDemoOwnerPassword({ databasePath: path, password: 'AfterReset2!' }), async (path) => invalidateStoredSessions(path, 'AfterReset2!')]) {
    const directory = await mkdtemp(join(tmpdir(), 'portal-access-reset-'));
    const path = join(directory, 'state.sqlite');
    const store = new StateStore(path);
    await store.load();
    await store.update((state) => {
      state.owner = { email: 'owner@example.test', password: hashPassword('BeforeReset1!') };
      migrateAccessState(state);
      state.users[0].status = 'disabled';
      state.users[0].role = 'user';
      state.sessions.push({ idHash: 'legacy', userId: state.users[0].id, authVersion: 1 });
    });
    await reset(path);
    const state = await new StateStore(path).load();
    assert.equal(verifyPassword('AfterReset2!', state.users[0].password), true);
    assert.equal(state.users[0].authVersion, 2);
    assert.equal(state.users[0].status, 'disabled');
    assert.equal(state.users[0].role, 'user');
    assert.deepEqual(state.sessions, []);
  }
});
