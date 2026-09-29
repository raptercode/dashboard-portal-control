import test from 'node:test';
import assert from 'node:assert/strict';
import { SecretVault } from '../src/core.mjs';

import { start } from './support/server.mjs';

test('environment editor reveals all values to the owner and preserves legacy patch requests', async (t) => {
  const { app, base } = await start();
  t.after(() => app.close());
  await app.store.update((state) => {
    state.projects.push({ name: 'Environment app', slug: 'environment-app', environment: { keys: [] } });
  });
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'owner@local.test', password: 'correct-horse-battery-staple' }) });
  const session = await login.json();
  const headers = { cookie: login.headers.get('set-cookie').split(';')[0], 'content-type': 'application/json', 'x-csrf-token': session.csrfToken };
  const saved = await fetch(`${base}/api/projects/environment-app/environment`, {
    method: 'POST', headers,
    body: JSON.stringify({ variables: [
      { key: 'NODE_ENV', value: 'production', sensitive: false },
      { key: 'API_KEY', value: 'never-return-this', sensitive: true }
    ] })
  });
  assert.equal(saved.status, 200);
  const firstRead = await fetch(`${base}/api/projects/environment-app/environment`, { headers: { cookie: headers.cookie } });
  assert.equal(firstRead.status, 200);
  const firstPayload = await firstRead.json();
  assert.deepEqual(firstPayload.environment.variables, [
    { key: 'API_KEY', value: 'never-return-this' },
    { key: 'NODE_ENV', value: 'production' }
  ]);
  assert.match(firstPayload.environment.content, /API_KEY=never-return-this/);
  assert.equal(firstRead.headers.get('cache-control'), 'no-store');
  assert.equal(JSON.stringify(await saved.json()).includes('never-return-this'), false);
  assert.equal(JSON.stringify(app.store.snapshot()).includes('never-return-this'), false);
  const retained = await fetch(`${base}/api/projects/environment-app/environment`, {
    method: 'POST', headers,
    body: JSON.stringify({ variables: [
      { key: 'API_KEY', value: '', sensitive: true },
      { key: 'NODE_ENV', value: '', sensitive: false }
    ] })
  });
  assert.equal(retained.status, 200);
  const secondPayload = await (await fetch(`${base}/api/projects/environment-app/environment`, { headers: { cookie: headers.cookie } })).json();
  assert.deepEqual(secondPayload.environment.variables, firstPayload.environment.variables);
});

test('full environment editing reads old masked values, replaces atomically and never exposes plaintext outside the owner editor', async (t) => {
  const { app, base } = await start();
  t.after(() => app.close());
  const vault = new SecretVault(Buffer.alloc(32, 7).toString('base64'));
  const original = '# original\nAPI_KEY=old-private-value\nREMOVE=yes\n';
  await app.store.update((state) => state.projects.push({ name: 'ENV test', slug: 'env-test', environment: {
    keys: ['API_KEY', 'REMOVE'], sensitiveKeys: ['API_KEY'], encryptedContent: vault.encrypt(original)
  } }));
  const url = `${base}/api/projects/env-test/environment`;
  assert.equal((await fetch(url)).status, 401);
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'owner@local.test', password: 'correct-horse-battery-staple' }) });
  const session = await login.json();
  const headers = { cookie: login.headers.get('set-cookie').split(';')[0], 'content-type': 'application/json', 'x-csrf-token': session.csrfToken };
  const read = async () => (await (await fetch(url, { headers })).json()).environment;
  assert.equal((await read()).content, original);
  const content = '# edited\nAPI_KEY=\nNEW_KEY=new-private-value\n';
  assert.equal((await fetch(url, { method: 'POST', headers: { cookie: headers.cookie, 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'replace', content }) })).status, 403);
  const saved = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ mode: 'replace', content }) });
  assert.equal(saved.status, 200);
  assert.equal(JSON.stringify(await saved.json()).includes('new-private-value'), false);
  assert.equal((await read()).content, content);
  assert.deepEqual((await read()).variables, [{ key: 'API_KEY', value: '' }, { key: 'NEW_KEY', value: 'new-private-value' }]);
  const stored = app.store.snapshot();
  assert.equal(JSON.stringify(stored).includes('new-private-value'), false);
  assert.equal(vault.decrypt(stored.projects.find((item) => item.slug === 'env-test').environment.encryptedContent), content);
  assert.equal((await (await fetch(`${base}/api/projects`, { headers })).text()).includes('new-private-value'), false);
  for (const body of [{ mode: 'replace', content: 'NEW_KEY=one\nNEW_KEY=two' }, { mode: 'replace' }, { mode: 'replace', content: 'private-invalid-line' }]) {
    const invalid = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.text()).includes('private-invalid-line'), false);
    assert.equal((await read()).content, content);
  }
  // More than the former 64 KB JSON limit, with multibyte text and escaped quotes.
  const largeContent = 'VALUE=' + 'ก"'.repeat(24000) + '\n';
  assert.equal((await fetch(url, { method: 'POST', headers, body: JSON.stringify({ mode: 'replace', content: largeContent }) })).status, 200);
  assert.equal((await read()).content, largeContent);
  assert.equal((await fetch(url, { method: 'POST', headers, body: JSON.stringify({ mode: 'replace', content: '' }) })).status, 200);
  assert.deepEqual((await read()).variables, []);
});
