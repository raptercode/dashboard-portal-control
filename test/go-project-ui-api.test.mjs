import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from '../src/server.mjs';

test('Go API saves and edits package configuration and displays binary deployment commands', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'hostmgr-go-api-'));
  const app = await createApplication({ dataPath: join(root, 'state.sqlite'), password: 'correct-horse-battery-staple', secretKey: Buffer.alloc(32, 7).toString('base64'), mode: 'demo', sandboxClone: false, metricsEnabled: false, portAvailability: async () => true });
  await app.store.update((state) => {
    state.tools.git.status = 'Installed';
    state.git.identity = { name: 'Test owner', email: 'owner@example.com' };
  });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  // StateStore owns a process-lifetime SQLite handle, as in the other API tests.
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'owner@local.test', password: 'correct-horse-battery-staple' }) });
  const { csrfToken } = await login.json();
  const headers = { cookie: login.headers.get('set-cookie').split(';')[0], 'content-type': 'application/json', 'x-csrf-token': csrfToken };
  const project = { name: 'Go service', slug: 'go-service', repository: 'https://github.com/example/service.git', branch: 'main', port: 3800, runtime: 'go', goPackage: './cmd/api' };
  for (const goPackage of ['./cmd/api', '.']) {
    const sync = await fetch(`${base}/api/projects/sync`, { method: 'POST', headers, body: JSON.stringify({ ...project, goPackage }) });
    assert.equal(sync.status, 200);
    const payload = await sync.json();
    assert.equal(payload.project.runtime, 'go');
    assert.equal(payload.project.goPackage, goPackage);
    const response = await fetch(`${base}/api/projects/go-service/deploy-configuration`, { headers });
    assert.equal(response.status, 200);
    const { configuration } = await response.json();
    assert.equal(configuration.runtime, 'Go');
    assert.equal(configuration.skipBuild, false);
    assert.equal(configuration.startScript, './hostmgr-app');
    assert.ok(configuration.buildScript.endsWith(` ${goPackage}`));
  }
  const invalid = await fetch(`${base}/api/projects/sync`, { method: 'POST', headers, body: JSON.stringify({ ...project, goPackage: '../outside' }) });
  assert.equal(invalid.status, 400);
  assert.equal(app.store.snapshot().projects.find((item) => item.slug === project.slug).goPackage, '.');
  const page = await fetch(`${base}/projects/new/repository`, { headers });
  assert.match(await page.text(), /data-view="projects-new-repository"/);
  assert.equal((await fetch(`${base}/ui/runtime-logos/go.svg`, { headers })).status, 200);
});
