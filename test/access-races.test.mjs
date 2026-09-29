import test from 'node:test';
import assert from 'node:assert/strict';
import { handleAccessApi } from '../src/access-api.mjs';
import { request as httpRequest } from 'node:http';
import { randomUUID } from 'node:crypto';
import { hashPassword } from '../src/auth.mjs';
import { start, login } from './support/server.mjs';

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

for (const revocation of ['demotion', 'disabled', 'authVersion']) {
  for (const [path, method, body] of [
    ['/api/members/requester', 'PATCH', { role: 'master', status: 'active' }],
    ['/api/organizations', 'POST', { name: 'Escalated' }],
    ['/api/organizations/org', 'PATCH', { name: 'Escalated' }],
    ['/api/invitations', 'POST', { email: 'escalated@example.test', role: 'master', memberships: [] }]
  ]) {
    test(`delayed request body cannot commit ${method} ${path} after ${revocation}`, async () => {
      const user = { id: 'requester', role: 'master', status: 'active', authVersion: 1 };
      let state = { users: [structuredClone(user), { id: 'other', role: 'master', status: 'active', authVersion: 1 }], organizations: [{ id: 'org', name: 'Original' }], projects: [], memberships: [], invitations: [], sessions: [], audit: [] };
      const reading = deferred();
      const bodyReady = deferred();
      const store = {
        snapshot: () => structuredClone(state),
        update: async (mutate) => { const next = structuredClone(state); await mutate(next); state = next; }
      };
      const pending = handleAccessApi({ request: { method }, response: {}, path, store, user, readJson: async () => { reading.resolve(); return bodyReady.promise; }, sendJson: () => { throw new Error('Revoked mutation must not succeed'); } });
      await reading.promise;
      if (revocation === 'demotion') state.users[0].role = 'user';
      else if (revocation === 'disabled') state.users[0].status = 'disabled';
      else state.users[0].authVersion += 1;
      const revoked = structuredClone(state);
      bodyReady.resolve(body);
      await assert.rejects(pending, (error) => error.status === 403);
      assert.deepEqual(state, revoked);
    });
  }
}

test('invitation revocation rechecks Master inside the serialized mutation', async () => {
  const user = { id: 'requester', role: 'master', status: 'active', authVersion: 1 };
  const state = { users: [structuredClone(user)], invitations: [{ id: 'invite', revokedAt: null }], audit: [] };
  const queued = deferred();
  const resume = deferred();
  const store = { update: async (mutate) => { queued.resolve(); await resume.promise; mutate(state); } };
  const pending = handleAccessApi({ request: { method: 'DELETE' }, response: {}, path: '/api/invitations/invite', store, user, readJson: async () => ({}), sendJson: () => {} });
  await queued.promise;
  state.users[0].role = 'user';
  resume.resolve();
  await assert.rejects(pending, (error) => error.status === 403);
  assert.equal(state.invitations[0].revokedAt, null);
});

for (const [suffix, payload, permissions] of [
  ['environment', { mode: 'replace', content: 'SECRET=changed\n' }, ['project.view', 'env.write']],
  ['domains', { domains: ['changed.example.test'] }, ['project.view', 'domains.manage']],
  ['auto-sync', { enabled: true }, ['project.view', 'webhooks.manage', 'deploy.start']]
]) {
  test(`HTTP ${suffix} mutation rejects permission removal while awaiting its body`, { timeout: 10000 }, async (t) => {
    const { app, base } = await start();
    t.after(() => app.close());
    const userId = randomUUID();
    const organizationId = randomUUID();
    const password = 'Member-Password-973!';
    await app.store.update((state) => {
      state.users.push({ id: userId, email: 'race@example.test', password: hashPassword(password), role: 'user', status: 'active', authVersion: 1 });
      state.organizations.push({ id: organizationId, name: 'Race' });
      state.memberships.push({ userId, organizationId, permissions });
      state.projects.push({ slug: 'race-app', name: 'Race', organizationId, organization: 'Race', repository: 'https://example.test/app.git', runtime: 'node', directory: '/', port: 3001, deployment: { state: 'idle', releases: [] } });
    });
    const headers = await login(base, 'race@example.test', password);
    const path = `/api/projects/race-app/${suffix}`;
    const reading = deferred();
    // Signal the precise read-body boundary; no timing sleeps or assumptions.
    app.server.prependListener('request', (incoming) => {
      if (incoming.url !== path) return;
      const iterator = incoming[Symbol.asyncIterator];
      incoming[Symbol.asyncIterator] = function () { reading.resolve(); return iterator.call(this); };
    });
    const json = JSON.stringify(payload);
    let outgoing;
    const response = new Promise((resolve, reject) => {
      outgoing = httpRequest(base + path, { method: 'POST', headers: { ...headers, 'content-length': Buffer.byteLength(json) } }, (incoming) => {
        incoming.resume();
        incoming.on('end', () => resolve(incoming.statusCode));
      });
      outgoing.on('error', reject);
      outgoing.flushHeaders();
    });
    t.after(() => outgoing.destroy());
    await reading.promise;
    await app.store.update((state) => { state.memberships = state.memberships.filter((item) => item.userId !== userId); });
    const before = app.store.snapshot().projects.find((item) => item.slug === 'race-app');
    outgoing.end(json);
    assert.ok([401, 403, 404].includes(await response));
    assert.deepEqual(app.store.snapshot().projects.find((item) => item.slug === 'race-app'), before);
  });
}
