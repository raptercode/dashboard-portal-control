import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { parseEnvironmentDocument, updateEnvironmentDocument } from '../public/ui/environment-editor.js';

const source = await readFile(new URL('../public/ui/app.js', import.meta.url), 'utf8');
const functions = ['collectDeployEnvironmentVariables', 'collectDeployEnvironmentContent', 'filterDeployEnvironment', 'closeDeployDialog', 'submitDeploy']
  .map(name => source.match(new RegExp(`(?:async )?function ${name}\\([^]*?^}`, 'm'))[0]).join('\n');

function fixture(overrides = {}) {
  const nodes = new Map();
  const node = key => {
    if (!nodes.has(key)) nodes.set(key, { value: '', open: true, classList: { remove() {} }, close() { this.open = false; } });
    return nodes.get(key);
  };
  const state = { activeProject: { slug: 'fixture', sync: { status: 'synced' } }, deployStep: 3, deployEnvironmentMode: 'file', deployEnvironmentSavedContent: 'KEY=old\n' };
  node('#deploy-env-editor').value = 'KEY=new\n';
  const ctx = vm.createContext({ state, $: node, $$: () => [], parseEnvironmentDocument, updateEnvironmentDocument, can: () => true, isWorkerProject: () => false, ...overrides });
  vm.runInContext(functions, ctx);
  return { ctx, state, node };
}

test('filtering a large ENV document does not drop variables hidden by the filter', () => {
  const rows = Array.from({ length: 100 }, (_, n) => ({ key: { value: `EXAMPLE_${n}` }, value: { value: `demo-${n}` } }));
  const { ctx, state, node } = fixture({
    $: (selector, row) => row ? row.key : node(selector),
    $$: (selector, row) => row ? [row.key, row.value] : rows
  });
  node('#deploy-env-filter').value = 'EXAMPLE_99';
  state.deployEnvironmentMode = 'rows';
  ctx.filterDeployEnvironment();
  assert.equal(rows.filter(row => !row.hidden).length, 1);
  assert.equal(parseEnvironmentDocument(ctx.collectDeployEnvironmentContent()).variables.length, 100);
});

test('closing invalid or unsaved ENV edits requires an explicit discard choice', async () => {
  let accept = false;
  const { ctx, node } = fixture({ confirmAction: async () => accept });
  node('#deploy-env-editor').value = 'invalid-document';
  await ctx.closeDeployDialog();
  assert.equal(node('#deploy-dialog').open, true);
  accept = true;
  await ctx.closeDeployDialog();
  assert.equal(node('#deploy-dialog').open, false);
});

test('final deployment saves the edited ENV before building and does not ask to discard saved edits', async () => {
  const calls = [];
  const { ctx, state, node } = fixture({
    api: async (path, options) => { calls.push({ path, body: options.body }); return { activation: 'queued' }; },
    confirmAction: () => assert.fail('saved ENV must not require discard'),
    toast() {}, refresh: async () => {}, showError: error => { throw error; }
  });
  await ctx.submitDeploy({ preventDefault() {} });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].path, '/api/projects/fixture/environment');
  assert.equal(calls[0].body.content, 'KEY=new\n');
  assert.equal(calls[1].path, '/api/projects/fixture/deploy');
  assert.equal(state.deployEnvironmentSavedContent, 'KEY=new\n');
  assert.equal(node('#deploy-dialog').open, false);
});
