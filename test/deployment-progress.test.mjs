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

const cardFunctions = ['projectDeploymentLabel', 'renderLiveProjects', 'scheduleProjectProgress', 'pollProjectProgress'].map((name) => app.match(new RegExp(`(?:async )?function ${name}\\([^]*?^}`, 'm'))[0]).join('\n');

test('cards poll all projects, show new build phases and terminal failure without a reload', async () => {
  let snapshot = [
    { slug: 'one', deploymentProgress: { status: 'running', phase: 'build', phaseStatus: 'started' } },
    { slug: 'two', deploymentProgress: { status: 'queued' } }
  ];
  const timers = [];
  const renders = [];
  const context = vm.createContext({
    state: { projects: [] }, document: { hidden: false }, view: 'projects', $$: () => [],
    clearTimeout() {}, setTimeout: (_callback, delay) => { timers.push(delay); },
    api: async (url) => { assert.equal(url, '/api/projects'); return { projects: snapshot }; },
    renderProjects: () => renders.push(structuredClone(context.state.projects))
  });
  vm.runInContext(`let projectProgressTimer; let projectProgressPolling = false;\n${cardFunctions}`, context);
  await context.pollProjectProgress();
  assert.equal(renders[0].length, 2);
  assert.equal(context.projectDeploymentLabel(snapshot[0].deploymentProgress), 'กำลัง build');
  assert.equal(timers.at(-1), 1500);
  snapshot = [
    { slug: 'one', deploymentProgress: { status: 'succeeded' } },
    { slug: 'two', deploymentProgress: { status: 'failed' } }
  ];
  await context.pollProjectProgress();
  assert.equal(renders.length, 2);
  assert.equal(context.projectDeploymentLabel(snapshot[1].deploymentProgress), 'Deploy ล้มเหลว');
  assert.equal(timers.at(-1), 5000);
  await context.pollProjectProgress();
  assert.equal(renders.length, 2, 'unchanged snapshots preserve card DOM');
});

test('card polling retries transient errors and pauses network traffic while hidden', async () => {
  let calls = 0;
  const timers = [];
  const context = vm.createContext({
    state: { projects: [{ deploymentProgress: { status: 'running' } }] }, document: { hidden: false }, view: 'projects', $$: () => [],
    clearTimeout() {}, setTimeout: (_callback, delay) => { timers.push(delay); },
    api: async () => { calls++; throw new Error('offline'); }, renderProjects() { assert.fail('failed fetch must not replace cards'); }
  });
  vm.runInContext(`let projectProgressTimer; let projectProgressPolling = false;\n${cardFunctions}`, context);
  await context.pollProjectProgress();
  assert.equal(timers.at(-1), 1500);
  context.document.hidden = true;
  await context.pollProjectProgress();
  assert.equal(calls, 1);
  context.document.hidden = false;
  await context.pollProjectProgress();
  assert.equal(calls, 2);
});

test('sync, deploy, rollback and deployment wizard never automatically open progress logs', () => {
  for (const name of ['syncExistingProject', 'rollbackProject', 'deployExistingProject', 'submitDeploy']) {
    const handler = app.match(new RegExp(`async function ${name}\\([^]*?^}`, 'm'))[0];
    assert.doesNotMatch(handler, /showDeploymentProgress/);
    assert.match(handler, /trackProjectDeployment/);
  }
});

test('project progress summaries never expose messages, logs or failure details', async () => {
  const server = await readFile(new URL('../src/server.mjs', import.meta.url), 'utf8');
  const summary = server.match(/function projectDeploymentProgress\([^]*?^}/m)[0];
  const context = vm.createContext({});
  vm.runInContext(summary, context);
  const jobs = [
    { id: 'old', projectSlug: 'one', status: 'failed' },
    { id: 'other', projectSlug: 'two', status: 'running' },
    { id: 'new', projectSlug: 'one', status: 'running', failureLog: 'private', events: [{ phase: 'build', status: 'started', at: 'now', message: 'secret' }] }
  ];
  const progress = context.projectDeploymentProgress(jobs, 'one');
  assert.equal(progress.id, 'new');
  assert.equal(progress.phase, 'build');
  assert.deepEqual(Object.keys(progress).sort(), ['id', 'phase', 'phaseStatus', 'status', 'updatedAt']);
  assert.equal(context.projectDeploymentProgress(jobs, 'missing'), null);
});

test('live updates preserve open card menus and keyboard focus', () => {
  const beforeCard = { dataset: { projectSlug: 'one' } };
  const oldMenu = { className: 'project-actions-menu', closest: () => beforeCard };
  const oldButton = { tagName: 'BUTTON', className: 'btn', textContent: 'Sync latest', closest: () => beforeCard };
  const afterCard = { dataset: { projectSlug: 'one' } };
  const newMenu = { className: 'project-actions-menu', open: false };
  let focused = false;
  const newButton = { tagName: 'BUTTON', className: 'btn', textContent: 'Sync latest', focus: () => { focused = true; } };
  let rendered = false;
  const context = vm.createContext({
    document: { activeElement: oldButton },
    renderProjects: () => { rendered = true; },
    $$: (selector, card) => {
      if (selector === '.project-card details[open]') return [oldMenu];
      if (selector === '.project-card') { assert.equal(rendered, true); return [afterCard]; }
      assert.equal(card, afterCard);
      return selector === 'details' ? [newMenu] : [newButton];
    }
  });
  vm.runInContext(app.match(/function renderLiveProjects\([^]*?^}/m)[0], context);
  context.renderLiveProjects();
  assert.equal(newMenu.open, true);
  assert.equal(focused, true);
});
