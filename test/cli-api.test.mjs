import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { start, login, request } from './support/server.mjs';
import { hashPassword } from '../src/auth.mjs';
import { CLI_SCOPES } from '../src/cli-auth.mjs';
import { request as httpRequest } from 'node:http';

async function fixture(t, options = {}) {
  const ctx = await start(options);
  t.after(() => ctx.app.server.listening ? ctx.app.close() : undefined);
  await ctx.app.store.update(state => {
    state.projects.push(...['first', 'second'].map(slug => ({ slug, name: slug, organizationId: state.organizations[0].id, organization: state.organizations[0].name, repository: `https://example.test/${slug}.git`, branch: 'main', runtime: 'node', startScript: 'start', port: slug === 'first' ? 3001 : 3002, sync: { status: 'synced', revision: 'abc' } })));
  });
  ctx.session = await login(ctx.base);
  ctx.issue = async (spec = {}) => {
    const response = await request(ctx.base, '/api/cli/tokens', ctx.session, 'POST', { name: 'Test CLI', ...spec });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    return { ...response.body, headers: { authorization: `Bearer ${response.body.token}`, 'content-type': 'application/json' } };
  };
  return ctx;
}

test('browser issues hashed, scoped CLI tokens; bearer cannot administer the host or mint tokens', async t => {
  const { app, base, issue, session } = await fixture(t);
  const { token, headers } = await issue({ projectSlug: 'first', scopes: ['project.view', 'env.write'] });
  assert.equal((await request(base, '/api/access', headers)).status, 200);
  assert.equal((await request(base, '/api/session', headers)).status, 403);
  const projects = await request(base, '/api/projects', headers);
  assert.deepEqual(projects.body.projects.map(item => item.slug), ['first']);
  for (const [path, method, body] of [['/api/doctor', 'GET'], ['/api/cli/tokens', 'GET'], ['/api/cli/tokens', 'POST', { name: 'escalated' }], ['/api/projects/first/deploy', 'POST', {}], ['/api/settings/password', 'POST', {}]]) {
    assert.equal((await request(base, path, headers, method, body)).status, 403, path);
  }
  assert.equal((await request(base, '/api/projects/second/environment/metadata', headers)).status, 404);
  assert.equal((await request(base, '/api/projects/first/environment', headers)).status, 403);
  assert.equal((await request(base, '/api/projects', { ...session, authorization: 'Bearer invalid' })).status, 401);
  assert.equal(JSON.stringify(app.store.snapshot()).includes(token), false);
  const list = await request(base, '/api/cli/tokens', session);
  assert.equal(JSON.stringify(list.body).includes('tokenHash'), false);
  assert.equal(JSON.stringify(list.body).includes(token), false);
});

test('CLI environment patch supports empty/unset, preserves comments, and rejects concurrent stale writes without exposing values', async t => {
  const { app, base, issue, session } = await fixture(t);
  await request(base, '/api/projects/first/environment', session, 'POST', { mode: 'replace', content: '# keep\nEXISTING=secret-original\nREMOVE=yes\n' });
  const { headers } = await issue({ projectSlug: 'first', scopes: ['project.view', 'env.write'] });
  const path = '/api/projects/first/environment';
  const metadata = await request(base, path + '/metadata', headers);
  assert.equal(JSON.stringify(metadata.body).includes('secret-original'), false);
  const revision = metadata.body.environment.revision;
  const outcomes = await Promise.all(['secret-a', 'secret-b'].map(value => request(base, path, headers, 'PATCH', { revision, set: { NEW: value, EMPTY: '' }, unset: ['REMOVE'] })));
  assert.deepEqual(outcomes.map(item => item.status).sort(), [200, 412]);
  const saved = await request(base, path, session);
  assert.match(saved.body.environment.content, /^# keep\nEXISTING=secret-original\n/);
  assert.equal(saved.body.environment.variables.find(item => item.key === 'EMPTY').value, '');
  assert.equal(saved.body.environment.variables.some(item => item.key === 'REMOVE'), false);
  for (const value of ['secret-a', 'secret-b']) {
    assert.equal(JSON.stringify(app.store.snapshot()).includes(value), false);
    assert.equal(JSON.stringify(outcomes).includes(value), false);
  }
  assert.equal((await request(base, path, headers, 'PATCH', { set: { X: 'a' } })).status, 428);
  const latest = (await request(base, path + '/metadata', headers)).body.environment.revision;
  for (const body of [{ set: { BAD: 'multiline\nsecret' } }, { set: { DUP: 'a' }, unset: ['DUP'] }, { set: { lower: 'a' } }]) assert.equal((await request(base, path, headers, 'PATCH', { revision: latest, ...body })).status, 400);
});

test('revocation, expiry, disabled users, and password version invalidate CLI bearer tokens', async t => {
  const { app, base, issue, session } = await fixture(t);
  for (const reason of ['revoke', 'expired', 'disabled', 'version']) {
    const { headers, credential } = await issue({ scopes: ['project.view'] });
    const owner = app.store.snapshot().users.find(item => item.id === credential.userId);
    if (reason === 'revoke') assert.equal((await request(base, `/api/cli/tokens/${credential.id}`, session, 'DELETE')).status, 200);
    else await app.store.update(state => {
      if (reason === 'expired') state.cliTokens.find(item => item.id === credential.id).expiresAt = new Date(0).toISOString();
      if (reason === 'disabled') state.users.find(item => item.id === owner.id).status = 'disabled';
      if (reason === 'version') state.users.find(item => item.id === owner.id).authVersion++;
    });
    assert.equal((await request(base, '/api/projects', headers)).status, 401, reason);
    await app.store.update(state => { const user = state.users.find(item => item.id === owner.id); user.status = 'active'; user.authVersion = owner.authVersion; });
  }
});

test('device login requires CSRF protected explicit approval, issues once, and persists only hashes', async t => {
  const { app, base, session } = await fixture(t);
  const started = await request(base, '/api/cli/device/start', { 'content-type': 'application/json' }, 'POST', { name: 'Laptop', projectSlug: 'first', scopes: ['project.view', 'env.write'] });
  assert.equal(started.status, 200);
  const { deviceCode, userCode, verificationPath } = started.body;
  assert.equal(verificationPath, `/settings/account?cli_code=${userCode}`);
  const poll = () => request(base, '/api/cli/device/poll', { 'content-type': 'application/json' }, 'POST', { deviceCode });
  assert.equal((await poll()).body.status, 'pending');
  assert.equal((await poll()).status, 429);
  assert.equal((await request(base, `/api/cli/devices/${userCode}`, session)).body.name, 'Laptop');
  assert.equal((await request(base, `/api/cli/devices/${userCode}`, { cookie: session.cookie, 'content-type': 'application/json' }, 'POST', { approve: true })).status, 403);
  assert.equal((await request(base, `/api/cli/devices/${userCode}`, session, 'POST', { approve: true })).status, 200);
  await app.store.update(state => { state.cliDevices[0].nextPollAt = 0; });
  const completed = await poll();
  assert.equal(completed.body.status, 'complete');
  assert.equal((await request(base, '/api/projects', { authorization: `Bearer ${completed.body.token}` })).status, 200);
  assert.equal((await poll()).status, 410);
  assert.equal(JSON.stringify(app.store.snapshot()).includes(deviceCode), false);
  assert.equal(JSON.stringify(app.store.snapshot()).includes(completed.body.token), false);
});

test('device denial, expiration and issuer permission changes fail closed', async t => {
  const { app, base, session } = await fixture(t);
  for (const reason of ['denied', 'expired', 'version']) {
    const { body: device } = await request(base, '/api/cli/device/start', {}, 'POST', { name: 'Device', scopes: ['project.view'] });
    if (reason === 'denied') await request(base, `/api/cli/devices/${device.userCode}`, session, 'POST', { approve: false });
    else if (reason === 'expired') await app.store.update(state => { state.cliDevices.find(item => item.userCode === device.userCode).expiresAt = 0; });
    else {
      await request(base, `/api/cli/devices/${device.userCode}`, session, 'POST', { approve: true });
      await app.store.update(state => { state.cliDevices.find(item => item.userCode === device.userCode).authVersion = -1; });
    }
    const polled = await request(base, '/api/cli/device/poll', {}, 'POST', { deviceCode: device.deviceCode });
    assert.equal(polled.status, { denied: 403, expired: 410, version: 401 }[reason]);
  }
});

test('member token cannot exceed grants and loses access immediately when grants are removed', async t => {
  const { app, base } = await fixture(t);
  const id = randomUUID();
  await app.store.update(state => {
    state.users.push({ id, email: 'cli@example.test', password: hashPassword('Member-Password-973!'), role: 'user', status: 'active', authVersion: 1 });
    state.memberships.push({ userId: id, organizationId: state.organizations[0].id, permissions: ['project.view', 'env.write'] });
  });
  const member = await login(base, 'cli@example.test', 'Member-Password-973!');
  assert.equal((await request(base, '/api/cli/tokens', member, 'POST', { name: 'Too broad', scopes: CLI_SCOPES })).status, 403);
  const created = await request(base, '/api/cli/tokens', member, 'POST', { name: 'ENV only', projectSlug: 'first', scopes: ['project.view', 'env.write'] });
  assert.equal(created.status, 201);
  const headers = { authorization: `Bearer ${created.body.token}` };
  assert.equal((await request(base, '/api/projects/first/environment/metadata', headers)).status, 200);
  assert.equal((await request(base, '/api/projects/first/environment', headers)).status, 403);
  await app.store.update(state => { state.memberships.find(item => item.userId === id).permissions = ['project.view']; });
  assert.equal((await request(base, '/api/projects/first/environment/metadata', headers)).status, 403);
});

test('CLI tokens survive application restart', async t => {
  const { app, base, issue, dataPath } = await fixture(t);
  const created = await issue({ scopes: ['project.view'] });
  await app.close();
  const restarted = await start({ dataPath });
  t.after(() => restarted.app.close());
  assert.equal((await request(restarted.base, '/api/projects', created.headers)).status, 200);
  assert.equal((await readFile(dataPath)).includes(Buffer.from(created.token)), false);
});

test('revoking a token while a mutation waits for its body prevents the commit', { timeout: 10000 }, async t => {
  const { app, base, issue, session } = await fixture(t);
  const { headers, credential } = await issue({ scopes: ['project.view', 'env.write'] });
  const path = '/api/projects/first/environment';
  const revision = (await request(base, path + '/metadata', headers)).body.environment.revision;
  let reading;
  const waiting = new Promise(resolve => { reading = resolve; });
  app.server.prependListener('request', incoming => {
    if (incoming.url !== path || incoming.method !== 'PATCH') return;
    const iterator = incoming[Symbol.asyncIterator];
    incoming[Symbol.asyncIterator] = function () { reading(); return iterator.call(this); };
  });
  const body = JSON.stringify({ revision, set: { SECRET: 'must-never-commit' } });
  let outgoing;
  const completed = new Promise((resolve, reject) => {
    outgoing = httpRequest(base + path, { method: 'PATCH', headers: { ...headers, 'content-length': Buffer.byteLength(body) } }, response => { response.resume(); response.on('end', () => resolve(response.statusCode)); });
    outgoing.on('error', reject); outgoing.flushHeaders();
  });
  t.after(() => outgoing.destroy());
  await waiting;
  assert.equal((await request(base, `/api/cli/tokens/${credential.id}`, session, 'DELETE')).status, 200);
  outgoing.end(body);
  assert.equal(await completed, 401);
  assert.equal(app.store.snapshot().projects.find(item => item.slug === 'first').environment, undefined);
});

test('a project-view token cannot receive logs embedded in project responses', async t => {
  const { app, base, issue } = await fixture(t);
  await app.store.update(state => { state.projects[0].deployment = { releases: [{ id: 'r1', failureLog: 'hidden-build-log', events: ['hidden-event'], failure: 'hidden-failure' }] }; });
  const { headers } = await issue({ scopes: ['project.view'] });
  const response = await request(base, '/api/projects', headers);
  assert.equal(response.status, 200);
  for (const hidden of ['hidden-build-log', 'hidden-event', 'hidden-failure']) assert.equal(JSON.stringify(response.body).includes(hidden), false);
});

test('source.sync scope can reuse configuration but cannot change it or trigger auto-deploy without deploy.start', async t => {
  const { app, base, issue, session } = await fixture(t);
  await app.store.update(state => {
    state.tools.git.status = 'Installed';
    state.git.identity = { name: 'CLI test', email: 'cli@example.test' };
    state.projects[0].autoSync = { enabled: true, mode: 'poll' };
  });
  await request(base, '/api/projects/first/environment', session, 'POST', { mode: 'replace', content: 'NODE_ENV=production\n' });
  const { headers } = await issue({ projectSlug: 'first', scopes: ['project.view', 'source.sync'] });
  const original = app.store.snapshot().projects.find(item => item.slug === 'first');
  const body = { ...original, domains: original.domains?.hosts };
  const synced = await request(base, '/api/projects/sync', headers, 'POST', body);
  assert.equal(synced.status, 200, JSON.stringify(synced.body));
  assert.equal(synced.body.job, undefined);
  assert.equal(app.store.snapshot().projects.find(item => item.slug === 'first').deployment?.activeReleaseId ?? null, null);
  for (const changes of [{ branch: 'different' }, { port: 4444 }, { domains: ['changed.example.test'] }]) assert.equal((await request(base, '/api/projects/sync', headers, 'POST', { ...body, ...changes })).status, 403);
});
