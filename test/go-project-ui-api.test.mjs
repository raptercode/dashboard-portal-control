import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from '../src/server.mjs';

test('runtime picker requires a Go package and restores Node/Bun script fields on switching', async () => {
  const source = await readFile(new URL('../public/ui/app.js', import.meta.url), 'utf8');
  const functions = source.slice(source.indexOf('function runtimeValue()'), source.indexOf('function toggleProjectPort()'));
  const nodes = new Map();
  const $ = (id) => {
    if (!nodes.has(id)) nodes.set(id, { value: '', checked: false, hidden: false, disabled: false, required: false, replaceChildren() {}, removeAttribute() {} });
    return nodes.get(id);
  };
  const context = vm.createContext({
    $,
    $$: () => [],
    runtimeLogo: (name) => name,
    projectRuntimes: {
      node: { label: 'Node.js', detail: '', icon: 'node' },
      bun: { label: 'Bun', detail: '', icon: 'bun' },
      go: { label: 'Go', detail: '', icon: 'go' },
      python: { label: 'Python', detail: '', icon: 'python' },
      php: { label: 'PHP', detail: '', icon: 'php' },
      'docker-compose': { label: 'Docker Compose', detail: '', icon: 'docker' }
    },
    projectFrameworks: {
      laravel: { runtime: 'php', label: 'Laravel' },
      django: { runtime: 'python', label: 'Django' }
    }
  });
  vm.runInContext(functions, context);
  context.setProjectRuntime('go');
  assert.equal($('#project-runtime').value, 'go');
  assert.equal($('#runtime-selection-label').textContent, 'Go');
  assert.equal($('#go-fields').hidden, false);
  assert.equal($('#go-package').required, true);
  assert.equal($('#go-package').disabled, false);
  assert.equal($('#start-script').required, false);
  assert.equal($('#start-script').disabled, true);
  assert.equal($('#build-script').disabled, true);
  assert.equal($('#skip-build').disabled, true);
  context.setProjectRuntime('bun');
  assert.equal($('#go-fields').hidden, true);
  assert.equal($('#go-package').disabled, true);
  assert.equal($('#start-script').required, true);
  assert.equal($('#build-script').disabled, false);
  $('#skip-build').checked = true;
  context.toggleBuildFields();
  assert.equal($('#build-script').disabled, true);
  context.setProjectRuntime('docker-compose');
  assert.equal($('#docker-compose-fields').hidden, false);
  assert.equal($('#go-fields').hidden, true);
  assert.equal($('#compose-service').required, true);
  $('#python-mode').value = 'script';
  $('#python-install').value = 'requirements';
  context.setProjectRuntime('python');
  assert.equal($('#python-fields').hidden, false);
  assert.equal($('#python-entry').required, true);
  assert.equal($('#python-requirements').disabled, false);
  assert.equal($('#start-script').disabled, true);
  assert.equal($('#build-script').disabled, true);
  assert.equal($('#go-package').disabled, true);
  $('#python-install').value = 'project';
  $('#python-mode').value = 'asgi';
  context.togglePythonFields();
  assert.equal($('#python-requirements').disabled, true);
  assert.equal($('#python-entry').placeholder, 'app.main:app');
  context.setProjectRuntime('php');
  assert.equal($('#php-fields').hidden, false);
  assert.equal($('#start-script').disabled, true);
  context.setDetectedFramework('laravel');
  assert.equal($('#php-mode').value, 'artisan');
  assert.equal($('#project-framework').value, 'laravel');
  assert.equal($('#detected-framework').hidden, false);
  context.setProjectRuntime('node');
  assert.equal($('#python-entry').disabled, true);
  assert.equal($('#python-fields').hidden, true);
  assert.equal($('#php-fields').hidden, true);
});

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
  assert.match(await page.text(), /data-runtime-option="go"/);
  assert.equal((await fetch(`${base}/ui/runtime-logos/go.svg`, { headers })).status, 200);
});
