import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const app = await readFile(new URL('../public/ui/app.js', import.meta.url), 'utf8');
const functions = ['closeDialog', 'openDeploymentLog', 'showDeploymentProgress'].map((name) => app.match(new RegExp(`function ${name}\\([^]*?^}`, 'm'))[0]).join('\n');

test('a closed deployment poll cannot overwrite a subsequently opened release log', async () => {
  const nodes = new Map();
  const node = (id) => {
    if (!nodes.has(id)) nodes.set(id, { id: id.slice(1), textContent: '', open: false, close() { this.open = false; } });
    return nodes.get(id);
  };
  let resolveJob;
  const renders = [];
  const timers = [];
  const context = vm.createContext({
    $: node, clearTimeout: () => {}, setTimeout: (...args) => { timers.push(args); },
    api: () => new Promise((resolve) => { resolveJob = resolve; }),
    renderDeploymentLog: (...args) => renders.push(args),
    showDialog: (dialog) => { dialog.open = true; },
    refresh: async () => {}, toast: () => {}, closeDeployDialog: () => {}
  });
  vm.runInContext(`let deploymentProgressTimer = null; let deploymentProgressGeneration = 0;\n${functions}`, context);
  const project = { name: 'Example', slug: 'example' };
  context.showDeploymentProgress(project, { id: 'old-job', status: 'running', events: ['running'] });
  await context.closeDialog(node('#deployment-log-dialog'));
  context.openDeploymentLog(project, { id: 'saved-release', status: 'failed', events: ['saved'], failureLog: 'saved error' });
  resolveJob({ job: { id: 'old-job', status: 'running', events: ['stale response'] } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(renders.at(-1), [['saved'], 'saved error', undefined]);
  assert.equal(timers.length, 0);
  assert.match(node('#deployment-log-title').textContent, /saved-release/);
});
