import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from '../src/server.mjs';
import { SecretVault } from '../src/core.mjs';

test('Python API preserves entry settings and queues host venv preparation without claiming a completed health check', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'hostmgr-python-api-'));
  const projectRoot = join(root, 'projects');
  const source = join(projectRoot, 'python-web', 'repository');
  await mkdir(source, { recursive: true });
  await writeFile(join(source, 'pyproject.toml'), '[project]\nname="python-web"\nversion="1.0"\n');
  const key = Buffer.alloc(32, 7).toString('base64');
  const previousSocket = process.env.HOSTMGR_DEPLOY_HELPER_SOCKET;
  delete process.env.HOSTMGR_DEPLOY_HELPER_SOCKET;
  const app = await createApplication({
    dataPath: join(root, 'state.sqlite'), projectRoot, password: 'correct-horse-battery-staple', secretKey: key,
    mode: 'host', metricsEnabled: false, portAvailability: async () => true,
    toolProbe: async (tools) => tools.map((tool) => ({ ...tool, status: 'Installed' })),
    projectSyncer: async () => ({ status: 'synced', at: new Date().toISOString(), revision: 'a'.repeat(40) })
  });
  await app.store.update((state) => { state.tools.git.status = 'Installed'; state.git.identity = { name: 'Owner', email: 'owner@example.com' }; });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await app.close();
    if (previousSocket === undefined) delete process.env.HOSTMGR_DEPLOY_HELPER_SOCKET;
    else process.env.HOSTMGR_DEPLOY_HELPER_SOCKET = previousSocket;
  });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'owner@local.test', password: 'correct-horse-battery-staple' }) });
  const { csrfToken } = await login.json();
  const headers = { cookie: login.headers.get('set-cookie').split(';')[0], 'content-type': 'application/json', 'x-csrf-token': csrfToken };
  const project = { name: 'Python Web', slug: 'python-web', repository: 'https://github.com/example/python.git', branch: 'main', port: 3801, runtime: 'python', pythonMode: 'asgi', pythonEntry: 'app:app', pythonInstall: 'project' };
  for (const pythonMode of ['asgi', 'wsgi']) {
    const response = await fetch(`${base}/api/projects/sync`, { method: 'POST', headers, body: JSON.stringify({ ...project, pythonMode }) });
    assert.equal(response.status, 200);
    const { project: synced } = await response.json();
    assert.equal(synced.pythonMode, pythonMode);
    assert.equal(synced.pythonEntry, 'app:app');
    assert.equal(synced.pythonInstall, 'project');
    const configuration = await (await fetch(`${base}/api/projects/python-web/deploy-configuration`, { headers })).json();
    assert.equal(configuration.configuration.runtime, 'Python / venv');
    assert.match(configuration.configuration.startScript, pythonMode === 'asgi' ? /-m uvicorn/ : /-m gunicorn/);
    assert.match(configuration.configuration.packageManager, /\.venv\/bin\/python -m pip install \./);
  }
  const vault = new SecretVault(key);
  await app.store.update((state) => {
    const saved = state.projects.find((item) => item.slug === project.slug);
    saved.environment = { keys: ['APP_MODE'], encryptedContent: vault.encrypt('APP_MODE=test\n') };
    saved.domains = { hosts: ['python.example.com'] };
  });
  const deployment = await fetch(`${base}/api/projects/python-web/deploy`, { method: 'POST', headers, body: '{}' });
  assert.equal(deployment.status, 202);
  const { job } = await deployment.json();
  let finished;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    finished = app.store.snapshot().jobs.find((item) => item.id === job.id);
    if (['succeeded', 'failed'].includes(finished.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(finished.status, 'succeeded', finished.failure);
  const saved = app.store.snapshot().projects.find((item) => item.slug === project.slug);
  assert.equal(saved.deployment.state, 'awaiting_activation');
  assert.equal(saved.deployment.releases[0].health.status, 'pending');
  assert.equal(saved.deployment.releases[0].health.checkedAt, null);
  assert.equal(saved.deployment.releases[0].pythonMode, 'wsgi');
  assert.ok(finished.events.some((event) => /host venv installation/.test(event.message)));
  await assert.rejects(stat(join(projectRoot, project.slug, 'releases', job.releaseId, '.venv')), { code: 'ENOENT' });
  const invalid = await fetch(`${base}/api/projects/sync`, { method: 'POST', headers, body: JSON.stringify({ ...project, pythonEntry: 'app:app;id' }) });
  assert.equal(invalid.status, 400);
  assert.equal((await fetch(`${base}/ui/runtime-logos/python.svg`, { headers })).status, 200);
});
