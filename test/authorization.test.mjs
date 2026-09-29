import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizeRequest } from '../src/authorization.mjs';
import { PERMISSIONS } from '../src/access.mjs';

function fixture(permissions = PERMISSIONS.map((item) => item.id)) {
  const user = { id: 'u', role: 'user', status: 'active' };
  const project = { name: 'App', slug: 'app', organizationId: 'a', organization: 'A', repository: 'https://github.com/example/app.git', branch: 'main', port: 3000, directory: '/', runtime: 'node' };
  const state = { users: [user], organizations: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], projects: [project, { ...project, slug: 'other', organization: 'B', organizationId: 'b' }], memberships: [{ userId: 'u', organizationId: 'a', permissions }], jobs: [{ id: 'job', projectSlug: 'app' }, { id: 'other-job', projectSlug: 'other' }], monitorTokens: [{ id: 'token', projectSlug: 'app' }], notificationHooks: [{ id: 'global', projectSlug: null }] };
  return { state, user, project, call: (path, method = 'GET', body = {}) => authorizeRequest({ state, user, path, method, body }) };
}
const status = (code) => (error) => error.status === code;

test('user routes deny host access and hidden projects, jobs and unsupported actions', () => {
  const { call, user } = fixture();
  for (const path of ['/api/doctor', '/api/metrics', '/api/mail', '/api/members', '/api/organizations', '/api/databases', '/api/software-update']) assert.throws(() => call(path), status(403));
  assert.deepEqual(call('/api/credentials'), { organizationId: undefined });
  assert.throws(() => call('/api/projects/other/logs'), status(404));
  assert.throws(() => call('/api/jobs/other-job'), status(404));
  assert.throws(() => call('/api/projects/app', 'DELETE'), status(403));
  assert.throws(() => call('/api/projects/app/deploy', 'GET'), status(403));
  assert.equal(call('/api/jobs/job').organizationId, 'a');
  user.status = 'disabled';
  assert.throws(() => call('/api/access'), status(403));
});

test('project permission checks include view gate and automation requires deploy permission', () => {
  const { call, state } = fixture(['project.view', 'webhooks.manage']);
  assert.throws(() => call('/api/projects/app/deploy', 'POST'), status(403));
  assert.throws(() => call('/api/projects/app/auto-sync', 'POST'), status(403));
  assert.throws(() => call('/api/projects/app/environment'), status(403));
  assert.equal(call('/api/projects/app/deploy-configuration').project.slug, 'app');
  assert.throws(() => call('/api/monitor-tokens', 'POST', { projectSlug: 'app' }), status(403));
  state.memberships[0].permissions.push('logs.read');
  assert.equal(call('/api/monitor-tokens', 'POST', { projectSlug: 'app' }).organizationId, 'a');
  assert.equal(call('/api/monitor-tokens/token', 'DELETE').project.slug, 'app');
  assert.throws(() => call('/api/notification-hooks/global', 'DELETE'), status(403));
  state.memberships[0].permissions = ['logs.read'];
  assert.throws(() => call('/api/projects/app/logs'), status(404));
});

test('source-only sync cannot reset defaults or change config, scope, credentials or domains', () => {
  const { call, project, state } = fixture(['project.view', 'source.sync']);
  assert.equal(call('/api/projects/sync', 'POST', { ...project }).organizationId, 'a');
  for (const change of [{ name: 'Changed' }, { branch: 'dev' }, { organizationId: 'b' }, { credentialId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }, { domains: ['app.example.com'] }]) {
    assert.throws(() => call('/api/projects/sync', 'POST', { ...project, ...change }), status(403));
  }
  project.branch = 'dev';
  const omitted = { ...project }; delete omitted.branch;
  assert.throws(() => call('/api/projects/sync', 'POST', omitted), status(403));
  state.memberships[0].permissions.push('project.configure');
  assert.throws(() => call('/api/projects/sync', 'POST', { ...project, sshKeyId: 'host-key', repository: 'git@example.com:app.git' }), status(403));
  project.credentialId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  assert.throws(() => call('/api/projects/sync', 'POST', { ...project, repository: 'https://attacker.example/app.git' }), status(403));
});

test('creation and repository detection require explicit permitted org and no host credential', () => {
  const { call, project } = fixture(['project.create']);
  const body = { ...project, slug: 'new' };
  assert.equal(call('/api/projects/sync', 'POST', body).organizationId, 'a');
  assert.throws(() => call('/api/projects/sync', 'POST', { ...body, organizationId: undefined }), status(403));
  assert.throws(() => call('/api/projects/sync', 'POST', { ...body, credentialId: 'secret' }), status(403));
  assert.equal(call('/api/git/branches', 'POST', { organizationId: 'a' }).organizationId, 'a');
  assert.throws(() => call('/api/projects/runtime-detect', 'POST', { organizationId: 'b' }), status(403));
  assert.throws(() => call('/api/git/branches', 'POST', { organizationId: 'a', credentialId: 'secret' }), status(403));
});

test('master sync resolves stable organizations and returns unmatched name for atomic creation', () => {
  const { call, user } = fixture();
  user.role = 'master';
  assert.deepEqual(call('/api/doctor'), {});
  assert.equal(call('/api/projects/sync', 'POST', { slug: 'app' }).organizationId, 'a');
  assert.equal(call('/api/projects/sync', 'POST', { slug: 'new', organization: 'New Org' }).organizationName, 'New Org');
  assert.equal(call('/api/projects/sync', 'POST', { slug: 'new', organization: 'New Org' }).organization, null);
  assert.throws(() => call('/api/projects/sync', 'POST', { organizationId: 'missing' }), status(404));
});
