import test from 'node:test';
import assert from 'node:assert/strict';
import { deploymentFeed } from '../src/deployments.mjs';
import { start, login, request } from './support/server.mjs';

function seed(state) {
  state.users.push({ id: 'viewer', role: 'user', status: 'active', authVersion: 1 });
  state.organizations.push({ id: 'team-a', name: 'A' }, { id: 'team-b', name: 'B' });
  state.memberships.push({ userId: 'viewer', organizationId: 'team-a', permissions: ['project.view'] });
  state.projects.push(
    { slug: 'visible', name: 'Visible app', organizationId: 'team-a', branch: 'main', runtime: 'node', environment: { content: 'never-disclose-env' }, deployment: { activeReleaseId: 'release-a', releases: [{ id: 'release-a', revision: 'abc123', status: 'active', createdAt: '2026-11-06T10:00:00Z', activatedAt: '2026-11-06T10:01:00Z', failureLog: 'never-disclose-build-output' }] } },
    { slug: 'hidden', name: 'Hidden app', organizationId: 'team-b', deployment: { releases: [{ id: 'hidden-release', status: 'active', createdAt: '2026-11-06T12:00:00Z' }] } }
  );
  state.jobs.push(
    { id: 'job-a', projectSlug: 'visible', releaseId: 'release-a', kind: 'deploy', status: 'succeeded', createdAt: '2026-11-06T10:00:00Z', finishedAt: '2026-11-06T10:01:00Z', failureLog: 'never-disclose-job-output', events: [{ phase: 'activate', message: 'never-disclose-job-message' }] },
    { id: 'job-b', projectSlug: 'hidden', kind: 'deploy', status: 'failed', createdAt: '2026-11-06T11:00:00Z' }
  );
}
test('deployment feed isolates organizations, deduplicates releases and contains metadata only', () => {
  const state = { users: [], organizations: [], memberships: [], projects: [], jobs: [] }; seed(state);
  const result = deploymentFeed(state, state.users[0]);
  assert.deepEqual(result.summary, { total: 1, active: 0, succeeded: 1, failed: 0 });
  assert.deepEqual(result.projects, [{ slug: 'visible', name: 'Visible app' }]);
  assert.equal(result.deployments[0].current, true);
  const serialized = JSON.stringify(result);
  for (const secret of ['hidden', 'never-disclose', 'failureLog', 'events', 'environment']) assert.equal(serialized.includes(secret), false);
  assert.throws(() => deploymentFeed(state, state.users[0], { projectSlug: 'hidden' }), error => error.status === 404);
  state.users[0].status = 'disabled';
  assert.throws(() => deploymentFeed(state, state.users[0]), error => error.status === 403);
});
test('deployment feed HTTP and CLI project binding enforce the current scope', async t => {
  const { app, base } = await start(); t.after(() => app.close());
  await app.store.update(seed);
  assert.equal((await request(base, '/api/deployments')).status, 401);
  const owner = await login(base);
  const issued = await request(base, '/api/cli/tokens', owner, 'POST', { name: 'Visible app', projectSlug: 'visible', scopes: ['project.view'] });
  assert.equal(issued.status, 201);
  const headers = { authorization: `Bearer ${issued.body.token}` };
  const feed = await request(base, '/api/deployments', headers);
  assert.equal(feed.status, 200);
  assert.deepEqual(feed.body.deployments.map(row => row.projectSlug), ['visible']);
  assert.equal((await request(base, '/api/deployments?project=hidden', headers)).status, 404);
  const writeOnly = await request(base, '/api/cli/tokens', owner, 'POST', { name: 'ENV only', scopes: ['env.write'] });
  assert.equal((await request(base, '/api/deployments', { authorization: `Bearer ${writeOnly.body.token}` })).status, 403);
  const page = await fetch(base + '/deployments');
  assert.equal(page.status, 200); assert.match(await page.text(), /data-page="deployments"/);
});
