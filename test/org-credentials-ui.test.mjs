import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../public/ui/app.js', import.meta.url), 'utf8');
const definitions = source.slice(source.indexOf('function isMaster()'), source.indexOf('\nfunction icon('));
const functions = ['defaultCredentialForRepository', 'repositoryInspectKey'].map((name) => source.match(new RegExp(`function ${name}\\([^]*?\\n\\}`))[0]).join('\n');
const extract = (name) => source.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n\\}`))[0];

function browserPolicy({ role = 'user', permissions = ['credentials.use'], organizationId = 'a', project = {}, mode = 'create' } = {}) {
  const state = {
    owner: { role }, organizations: [{ id: 'a', name: 'A', permissions }, { id: 'b', name: 'B', permissions: ['credentials.use'] }],
    credentials: [
      { id: 'ca', organizationId: 'a', host: 'github.com', isDefault: true },
      { id: 'cb', organizationId: 'b', host: 'github.com', isDefault: true },
      { id: 'cg', organizationId: null, host: 'github.com', isDefault: true }
    ], defaultCredentialId: 'cg', projects: [{ slug: 'app', organizationId: 'a', ...project }]
  };
  const draft = { organizationId };
  const context = vm.createContext({
    state, flowMode: mode, editSlug: 'app', readDraft: () => draft,
    credentialMatchesRepository: (credential) => credential?.host === 'github.com',
    repositoryProtocol: () => 'https',
    $: (selector) => ({ value: selector === '#credential-id' ? 'ca' : 'https://github.com/example/private.git' })
  });
  vm.runInContext(`${definitions}\n${functions}`, context);
  return { context, state, draft };
}

test('member credential picker and default stay within the selected organization', () => {
  const { context, draft } = browserPolicy();
  assert.equal(context.flowCredentials().map((item) => item.id).join(','), 'ca');
  assert.equal(context.defaultCredentialForRepository().id, 'ca');
  draft.organizationId = 'b';
  assert.equal(context.flowCredentials().map((item) => item.id).join(','), 'cb');
  assert.equal(context.defaultCredentialForRepository().id, 'cb');
});

test('credential management permission alone does not permit source binding', () => {
  const { context } = browserPolicy({ permissions: ['credentials.update'] });
  assert.equal(context.flowCredentials().length, 0);
  assert.equal(context.defaultCredentialForRepository(), null);
});

test('master can use legacy global credentials but org default takes priority', () => {
  const { context, state } = browserPolicy({ role: 'master' });
  assert.equal(context.flowCredentials().map((item) => item.id).join(','), 'ca,cg');
  assert.equal(context.defaultCredentialForRepository().id, 'ca');
  state.credentials[0].isDefault = false;
  assert.equal(context.defaultCredentialForRepository().id, 'cg');
});

test('member can edit own org credential binding only with use permission; legacy and SSH stay locked', () => {
  assert.equal(browserPolicy({ mode: 'edit', project: { credentialId: 'ca' } }).context.boundSourceLocked(), false);
  assert.equal(browserPolicy({ mode: 'edit', permissions: [], project: { credentialId: 'ca' } }).context.boundSourceLocked(), true);
  assert.equal(browserPolicy({ mode: 'edit', project: { credentialId: 'cg' } }).context.boundSourceLocked(), true);
  assert.equal(browserPolicy({ mode: 'edit', project: { sshKeyId: 'ssh' } }).context.boundSourceLocked(), true);
});

test('repository detection cache key changes when organization changes', () => {
  const { context, draft } = browserPolicy();
  const previous = context.repositoryInspectKey();
  draft.organizationId = 'b';
  assert.notEqual(context.repositoryInspectKey(), previous);
});

test('credentials screen exposes org selection and rotation without a master-only navigation gate', async () => {
  const [page, sidebar] = await Promise.all([
    readFile(new URL('../views/pages/credentials.html', import.meta.url), 'utf8'),
    readFile(new URL('../views/partials/sidebar.html', import.meta.url), 'utf8')
  ]);
  assert.match(page, /id="credential-organization"/);
  assert.match(page, /id="credential-edit-cancel"/);
  assert.doesNotMatch(sidebar.match(/<a[^>]+data-nav="credentials"[^>]*>/)[0], /master-only/);
});

test('a completed credential save preserves a newer editor after input, org switch, or edit selection', async () => {
  for (const changed of [false, true]) {
    let complete;
    let resets = 0;
    let refreshed = 0;
    const state = { credentialEditorGeneration: 3, editingCredentialId: 'ca', credentialOrganizationId: 'a' };
    const context = vm.createContext({
      state, FormData: class { constructor() { return [['name', 'token-a'], ['host', 'github.com'], ['token', '']]; } },
      api: async (path, options) => {
        assert.equal(path, '/api/credentials/ca');
        assert.equal(options.method, 'PATCH');
        assert.equal(Object.hasOwn(options.body, 'token'), false);
        await new Promise((resolve) => { complete = resolve; });
      },
      resetCredentialEditor: () => { resets += 1; }, toast: () => {}, refresh: async () => { refreshed += 1; }
    });
    vm.runInContext(extract('saveCredentialForm'), context);
    const saving = context.saveCredentialForm({});
    if (changed) state.credentialEditorGeneration += 1;
    complete();
    await saving;
    assert.equal(resets, changed ? 0 : 1);
    assert.equal(refreshed, 1);
  }
});

test('runtime detection ignores stale branch/directory successes and errors', async () => {
  for (const field of ['#branch', '#project-directory']) {
    for (const fails of [false, true]) {
      const { context, state } = browserPolicy();
      let complete;
      let fail;
      let applied = 0;
      const nodes = {
        '#repository': { value: 'https://github.com/example/private.git', reportValidity: () => true },
        '#credential-id': { value: 'ca' }, '#branch': { value: 'main' }, '#project-directory': { value: '/' },
        '#detect-project-runtime': { textContent: 'Detect', disabled: false }, '#runtime-detection-note': { textContent: '' }
      };
      Object.assign(context, {
        $: (selector) => nodes[selector],
        api: () => new Promise((resolve, reject) => { complete = resolve; fail = reject; }),
        setProjectRuntime: () => { applied += 1; }
      });
      vm.runInContext(`${extract('runtimeInspectKey')}\n${extract('detectProjectRuntimeFromRepository')}`, context);
      const detecting = context.detectProjectRuntimeFromRepository({ quiet: true });
      nodes[field].value = field === '#branch' ? 'other' : '/other';
      nodes['#runtime-detection-note'].textContent = 'Current request';
      if (fails) fail(new Error('Old request failed'));
      else complete({ detection: { recommendedRuntime: 'node' } });
      assert.equal(await detecting, false);
      assert.equal(applied, 0);
      assert.equal(state.runtimeDetection, undefined);
      assert.equal(nodes['#runtime-detection-note'].textContent, 'Current request');
    }
  }
});
