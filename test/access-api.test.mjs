import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { hashPassword } from '../src/auth.mjs';
import { PERMISSION_PRESETS } from '../src/access.mjs';
import { start, login, request } from './support/server.mjs';

const PASSWORD = 'Testing-Password-739!';
const passwordHash = hashPassword(PASSWORD);

async function fixture(t, permissions = [], extra = []) {
  const { app, base, dataPath } = await start();
  let stopped = false;
  const stop = async () => { if (!stopped) { stopped = true; await app.close(); } };
  t.after(stop);
  const userId = randomUUID();
  const orgA = randomUUID();
  const orgB = randomUUID();
  await app.store.update((state) => {
    state.organizations.push({ id: orgA, name: 'Alpha' }, { id: orgB, name: 'Bravo' });
    state.users.push({ id: userId, email: 'member@example.test', password: passwordHash, role: 'user', status: 'active', authVersion: 1 });
    if (permissions.length) state.memberships.push({ userId, organizationId: orgA, permissions: [...permissions] });
    if (extra.length) state.memberships.push({ userId, organizationId: orgB, permissions: [...extra] });
    for (const [slug, organizationId] of [['alpha', orgA], ['bravo', orgB]]) state.projects.push({ name: slug, slug, organizationId, organization: slug, repository: 'https://example.test/app.git', branch: 'main', directory: '/', port: slug === 'alpha' ? 3001 : 3002, environment: { keys: [] }, deployment: { state: 'idle', releases: [] } });
  });
  const master = await login(base);
  const member = await login(base, 'member@example.test', PASSWORD);
  return { app, base, dataPath, stop, master, member, userId, orgA, orgB };
}

test('anonymous requests cannot inspect access, members, organizations or projects', async (t) => {
  const { base } = await fixture(t);
  for (const path of ['/api/access', '/api/members', '/api/projects', '/api/audit', '/api/credentials', '/api/monitor-tokens']) {
    assert.equal((await request(base, path)).status, 401, path);
  }
});

test('Master receives both organizations and member metadata without password hashes', async (t) => {
  const { base, master, orgA, orgB } = await fixture(t);
  const access = await request(base, '/api/access', master);
  assert.equal(access.status, 200);
  assert.equal(access.body.user.role, 'master');
  assert.ok(access.body.organizations.some((org) => org.id === orgA));
  assert.ok(access.body.organizations.some((org) => org.id === orgB));
  const members = await request(base, '/api/members', master);
  assert.equal(members.status, 200);
  assert.equal(JSON.stringify(members.body).includes(passwordHash.hash), false);
  assert.equal((await request(base, '/api/projects', master)).body.projects.length, 2);
});

test('User without organizations sees an empty project list and cannot create organizations', async (t) => {
  const { base, member } = await fixture(t);
  assert.deepEqual((await request(base, '/api/projects', member)).body.projects, []);
  assert.deepEqual((await request(base, '/api/access', member)).body.organizations, []);
  assert.equal((await request(base, '/api/organizations', member, 'POST', { name: 'Escalation' })).status, 403);
});

for (const preset of ['viewer', 'operator', 'maintainer']) {
  test(`User with ${preset} template sees only granted organization and cannot manage the host or members`, async (t) => {
    const { base, member, userId } = await fixture(t, PERMISSION_PRESETS[preset]);
    const access = await request(base, '/api/access', member);
    assert.equal(access.body.user.role, 'user');
    assert.deepEqual((await request(base, '/api/projects', member)).body.projects.map((p) => p.slug), ['alpha']);
    for (const path of ['/api/members', '/api/doctor', '/api/metrics', '/api/git-config', '/api/mail', '/api/databases', '/api/software-update']) {
      assert.equal((await request(base, path, member)).status, 403, path);
    }
    assert.deepEqual((await request(base, '/api/credentials', member)).body.credentials, []);
    assert.equal((await request(base, `/api/members/${userId}`, member, 'PATCH', { role: 'master' })).status, 403);
    assert.equal((await request(base, '/api/projects/alpha', member, 'DELETE', {})).status, 403);
    assert.equal((await request(base, '/api/projects/bravo/logs', member)).status, 404);
    assert.equal((await request(base, '/api/projects/bravo/deploy', member, 'POST', {})).status, 404);
  });
}

test('Viewer cannot invoke deployment, source sync, configuration, environment or webhook mutations', async (t) => {
  const { base, member, orgA } = await fixture(t, PERMISSION_PRESETS.viewer);
  for (const suffix of ['deploy', 'rollback', 'auto-sync', 'deploy-configuration', 'environment', 'domains', 'github-webhook', 'actions-hook']) {
    assert.equal((await request(base, `/api/projects/alpha/${suffix}`, member, 'POST', {})).status, 403, suffix);
  }
  assert.equal((await request(base, '/api/projects/sync', member, 'POST', { slug: 'alpha', organizationId: orgA })).status, 403);
  assert.equal((await request(base, '/api/projects/alpha/environment', member)).status, 403);
});

test('Mixed organization grants cannot borrow deploy permission from another organization', async (t) => {
  const { base, member } = await fixture(t, PERMISSION_PRESETS.operator, PERMISSION_PRESETS.viewer);
  assert.equal((await request(base, '/api/projects', member)).body.projects.length, 2);
  assert.equal((await request(base, '/api/projects/bravo/deploy', member, 'POST', { organizationId: 'alpha', slug: 'alpha' })).status, 403);
  assert.equal((await request(base, '/api/projects/bravo/environment', member)).status, 403);
});

test('Permission removal applies to an already logged in user', async (t) => {
  const { base, member, master, userId } = await fixture(t, PERMISSION_PRESETS.operator);
  const changed = await request(base, `/api/members/${userId}`, master, 'PATCH', { memberships: [] });
  assert.equal(changed.status, 200);
  const projects = await request(base, '/api/projects', member);
  assert.ok(projects.status === 401 || (projects.status === 200 && projects.body.projects.length === 0));
  assert.ok([401, 403].includes((await request(base, '/api/projects/alpha/deploy', member, 'POST', {})).status));
});

test('Disabling a user invalidates existing session and prevents a new login', async (t) => {
  const { base, member, master, userId } = await fixture(t, PERMISSION_PRESETS.maintainer);
  assert.equal((await request(base, `/api/members/${userId}`, master, 'PATCH', { status: 'disabled' })).status, 200);
  assert.equal((await request(base, '/api/projects', member)).status, 401);
  assert.equal((await request(base, '/api/login', {}, 'POST', { email: 'member@example.test', password: PASSWORD })).status, 401);
});

test('The final active Master cannot be disabled or demoted', async (t) => {
  const { base, master } = await fixture(t);
  const { user } = (await request(base, '/api/access', master)).body;
  for (const patch of [{ status: 'disabled' }, { role: 'user' }]) {
    const result = await request(base, `/api/members/${user.id}`, master, 'PATCH', patch);
    assert.ok([400, 409].includes(result.status), JSON.stringify(result));
  }
});

test('Environment read and write permissions remain independent and plaintext never appears in project listing', async (t) => {
  const { base, member, master, userId, orgA } = await fixture(t, ['project.view', 'env.write']);
  const secret = 'test-secret-not-visible-in-project-list';
  assert.equal((await request(base, '/api/projects/alpha/environment', member, 'POST', { content: `API_KEY=${secret}\n` })).status, 200);
  assert.equal((await request(base, '/api/projects/alpha/environment', member)).status, 403);
  assert.equal(JSON.stringify((await request(base, '/api/projects', member)).body).includes(secret), false);
  assert.equal(JSON.stringify((await request(base, '/api/projects/alpha/environment', master)).body).includes(secret), true);
  assert.equal((await request(base, `/api/members/${userId}`, master, 'PATCH', { memberships: [{ organizationId: orgA, permissions: ['project.view', 'env.read'] }] })).status, 200);
  const reader = await login(base, 'member@example.test', PASSWORD);
  assert.equal(JSON.stringify((await request(base, '/api/projects/alpha/environment', reader)).body).includes(secret), true);
  assert.equal((await request(base, '/api/projects/alpha/environment', reader, 'POST', { content: 'REPLACED=yes\n' })).status, 403);
});

test('Maintainer cannot create a project in another organization or move an existing one', async (t) => {
  const { base, member, orgB } = await fixture(t, PERMISSION_PRESETS.maintainer);
  const result = await request(base, '/api/projects/sync', member, 'POST', { slug: 'alpha', name: 'Alpha', organizationId: orgB, repository: 'https://example.test/app.git', branch: 'main', port: 3001 });
  assert.equal(result.status, 403);
});

test('Invitations are Master-only, single-use and do not honor acceptance privilege fields', async (t) => {
  const { base, master, member, orgA } = await fixture(t);
  const invitation = { email: 'invited@example.test', role: 'user', memberships: [{ organizationId: orgA, permissions: ['project.view'] }] };
  assert.equal((await request(base, '/api/invitations', member, 'POST', invitation)).status, 403);
  const created = await request(base, '/api/invitations', master, 'POST', invitation);
  assert.equal(created.status, 201);
  assert.ok(created.body.token);
  assert.equal(JSON.stringify(created.body.invitation).includes(created.body.token), false);
  const body = { token: created.body.token, password: PASSWORD, passwordConfirmation: PASSWORD, role: 'master', memberships: [{ organizationId: orgA, permissions: [...PERMISSION_PRESETS.maintainer] }] };
  assert.equal((await request(base, '/api/invitations/accept', {}, 'POST', body)).status, 200);
  const invited = await login(base, invitation.email, PASSWORD);
  const access = (await request(base, '/api/access', invited)).body;
  assert.equal(access.user.role, 'user');
  assert.equal((await request(base, '/api/projects/alpha/environment', invited)).status, 403);
  assert.ok([400, 409, 410].includes((await request(base, '/api/invitations/accept', {}, 'POST', body)).status));
});

test('Revoked and expired invitations cannot create a user', async (t) => {
  const { app, base, master } = await fixture(t);
  for (const mode of ['revoked', 'expired']) {
    const created = await request(base, '/api/invitations', master, 'POST', { email: `${mode}@example.test`, role: 'user', memberships: [] });
    assert.equal(created.status, 201);
    if (mode === 'revoked') assert.equal((await request(base, `/api/invitations/${created.body.invitation.id}`, master, 'DELETE', {})).status, 200);
    else await app.store.update((state) => { state.invitations.find((item) => item.id === created.body.invitation.id).expiresAt = new Date(0).toISOString(); });
    assert.ok([400, 403, 409, 410].includes((await request(base, '/api/invitations/accept', {}, 'POST', { token: created.body.token, password: PASSWORD, passwordConfirmation: PASSWORD })).status));
    assert.equal(app.store.snapshot().users.some((user) => user.email === `${mode}@example.test`), false);
  }
});

test('Jobs and audit records are scoped to the granted organization', async (t) => {
  const { app, base, member, master, orgA, orgB } = await fixture(t, PERMISSION_PRESETS.viewer);
  const alphaJob = randomUUID();
  const bravoJob = randomUUID();
  await app.store.update((state) => {
    state.jobs.push({ id: alphaJob, projectSlug: 'alpha', status: 'succeeded', createdAt: new Date().toISOString(), events: [] }, { id: bravoJob, projectSlug: 'bravo', status: 'succeeded', createdAt: new Date().toISOString(), events: [] });
    state.audit.push({ id: randomUUID(), at: new Date().toISOString(), action: 'test.alpha', organizationId: orgA, projectSlug: 'alpha' }, { id: randomUUID(), at: new Date().toISOString(), action: 'test.bravo', organizationId: orgB, projectSlug: 'bravo' }, { id: randomUUID(), at: new Date().toISOString(), action: 'test.host' });
  });
  assert.equal((await request(base, `/api/jobs/${alphaJob}`, member)).status, 200);
  assert.equal((await request(base, `/api/jobs/${bravoJob}`, member)).status, 404);
  assert.equal((await request(base, `/api/jobs/${bravoJob}`, master)).status, 200);
  const events = (await request(base, '/api/audit', member)).body.events;
  assert.ok(events.some((event) => event.action === 'test.alpha'));
  assert.equal(events.some((event) => ['test.bravo', 'test.host'].includes(event.action)), false);
});

test('Hook and token lists exclude ungranted projects and global hooks', async (t) => {
  const { app, base, member } = await fixture(t, PERMISSION_PRESETS.maintainer);
  await app.store.update((state) => {
    for (const projectSlug of ['alpha', 'bravo']) {
      state.monitorTokens.push({ id: randomUUID(), name: `${projectSlug}-monitor`, projectSlug, tokenHash: 'private-hash' });
      state.notificationHooks.push({ id: randomUUID(), name: `${projectSlug}-hook`, projectSlug, events: ['deploy.succeeded'] });
    }
    state.notificationHooks.push({ id: randomUUID(), name: 'global-hook', projectSlug: null, events: ['deploy.succeeded'] });
  });
  const tokens = await request(base, '/api/monitor-tokens', member);
  const hooks = await request(base, '/api/notification-hooks', member);
  assert.equal(tokens.status, 200);
  assert.equal(hooks.status, 200);
  assert.deepEqual(tokens.body.tokens.map((token) => token.projectSlug), ['alpha']);
  assert.deepEqual(hooks.body.hooks.map((hook) => hook.projectSlug), ['alpha']);
  assert.equal(JSON.stringify(tokens.body).includes('private-hash'), false);
});

test('Master mutations require CSRF and reject unknown permission grants', async (t) => {
  const { base, master, userId, orgA } = await fixture(t);
  assert.equal((await request(base, '/api/organizations', { cookie: master.cookie }, 'POST', { name: 'No CSRF' })).status, 403);
  assert.equal((await request(base, `/api/members/${userId}`, master, 'PATCH', { memberships: [{ organizationId: orgA, permissions: ['host.admin'] }] })).status, 400);
  assert.equal((await request(base, `/api/members/${userId}`, master, 'PATCH', { role: 'maintainer' })).status, 400);
});

test('Master creates and renames organizations and can grant memberships', async (t) => {
  const { base, master, userId } = await fixture(t);
  const created = await request(base, '/api/organizations', master, 'POST', { name: 'New organization' });
  assert.equal(created.status, 201);
  const organizationId = created.body.organization.id;
  assert.equal((await request(base, `/api/organizations/${organizationId}`, master, 'PATCH', { name: 'Renamed organization' })).status, 200);
  assert.equal((await request(base, `/api/members/${userId}`, master, 'PATCH', { memberships: [{ organizationId, permissions: ['project.view'] }] })).status, 200);
  const fresh = await login(base, 'member@example.test', PASSWORD);
  assert.equal((await request(base, '/api/access', fresh)).body.organizations[0].name, 'Renamed organization');
});

test('Viewer can read logs of a granted project', async (t) => {
  const { base, member } = await fixture(t, PERMISSION_PRESETS.viewer);
  assert.equal((await request(base, '/api/projects/alpha/logs', member)).status, 200);
});

test('Maintainer can configure domains and read/write environment inside the granted organization', async (t) => {
  const { base, member } = await fixture(t, PERMISSION_PRESETS.maintainer);
  assert.equal((await request(base, '/api/projects/alpha/domains', member, 'POST', { domains: ['alpha.example.test'] })).status, 200);
  assert.equal((await request(base, '/api/projects/alpha/environment', member, 'POST', { content: 'EXAMPLE=value\n' })).status, 200);
  assert.match((await request(base, '/api/projects/alpha/environment', member)).body.environment.content, /EXAMPLE=value/);
});

test('Operator can sync and deploy an existing project without configuration or environment grants', async (t) => {
  const { app, base, master, member, orgA } = await fixture(t, PERMISSION_PRESETS.operator);
  assert.equal((await request(base, '/api/tools/git/install', master, 'POST', { confirm: true })).status, 200);
  assert.equal((await request(base, '/api/git-config', master, 'POST', { name: 'Test Master', email: 'owner@example.test' })).status, 200);
  const configuration = { name: 'alpha', slug: 'alpha', organizationId: orgA, organization: 'Alpha', repository: 'https://example.test/app.git', branch: 'main', directory: '/', port: 3001, protocol: 'https' };
  assert.equal((await request(base, '/api/projects/sync', master, 'POST', configuration)).status, 200);
  assert.equal((await request(base, '/api/projects/alpha/environment', master, 'POST', { content: '' })).status, 200);
  const sync = await request(base, '/api/projects/sync', member, 'POST', configuration);
  assert.equal(sync.status, 200, JSON.stringify(sync));
  for (const changed of [{ port: 4999 }, { branch: 'other-branch' }, { repository: 'https://example.test/other.git' }, { credentialId: randomUUID() }]) {
    assert.equal((await request(base, '/api/projects/sync', member, 'POST', { ...configuration, ...changed })).status, 403);
  }
  assert.equal(app.store.snapshot().projects.find((project) => project.slug === 'alpha').port, 3001);
  const deploy = await request(base, '/api/projects/alpha/deploy', member, 'POST', {});
  assert.equal(deploy.status, 200, JSON.stringify(deploy));
  assert.equal(deploy.body.project.deployment.state, 'active');
  assert.equal((await request(base, '/api/projects/alpha/environment', member)).status, 403);
  const events = app.store.snapshot().audit.filter((event) => event.actorUserId === (app.store.snapshot().users.find((user) => user.email === 'member@example.test').id));
  assert.ok(events.some((event) => event.organizationId === orgA && event.projectSlug === 'alpha'));
});

test('Master and User persisted sessions retain their own identities after an application restart', async (t) => {
  const { dataPath, stop, master, member, userId } = await fixture(t, PERMISSION_PRESETS.viewer);
  await stop();
  const restarted = await start({ dataPath });
  t.after(() => restarted.app.close());
  const masterAccess = await request(restarted.base, '/api/access', master);
  const memberAccess = await request(restarted.base, '/api/access', member);
  assert.equal(masterAccess.status, 200);
  assert.equal(memberAccess.status, 200);
  assert.equal(masterAccess.body.user.role, 'master');
  assert.equal(memberAccess.body.user.id, userId);
  assert.equal(memberAccess.body.user.role, 'user');
  assert.deepEqual((await request(restarted.base, '/api/projects', member)).body.projects.map((project) => project.slug), ['alpha']);
});
