import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

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
