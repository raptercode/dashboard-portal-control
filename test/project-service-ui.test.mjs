import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { isWorkerProject, serviceFields, serviceRuntimeError } from '../public/ui/project-service-type.js';

test('worker draft clears stale HTTP settings and rejects unsupported runtime choices explicitly', () => {
  assert.deepEqual(serviceFields({ serviceType: 'worker', port: 3001, autoPort: true, healthCheckEnabled: true }), { serviceType: 'worker', port: null, autoPort: false, healthCheckEnabled: false, healthCheckPath: '/' });
  assert.deepEqual(serviceFields({}), { serviceType: 'web' });
  for (const runtime of ['node', 'bun', 'go', 'python']) assert.equal(serviceRuntimeError({ serviceType: 'worker', runtime }), '');
  for (const runtime of ['php', 'docker-compose']) assert.ok(serviceRuntimeError({ serviceType: 'worker', runtime }));
  assert.ok(serviceRuntimeError({ serviceType: 'worker', runtime: 'python', pythonMode: 'asgi' }));
  assert.equal(serviceRuntimeError({ serviceType: 'web', runtime: 'php' }), '');
});

test('worker repository step hides and disables HTTP controls; web restores controls and existing settings', async () => {
  const source = await readFile(new URL('../public/ui/app.js', import.meta.url), 'utf8');
  const body = source.match(/function toggleServiceFields\(\) \{[^]*?\n\}/)[0];
  let draft = { serviceType: 'worker' };
  const controls = [{ disabled: false }, { disabled: false }];
  const sections = [{ hidden: false, controls }];
  const notice = { hidden: true };
  let restored = 0;
  const toggle = runInNewContext(`${body}; toggleServiceFields`, {
    isWorkerProject, readDraft: () => draft, $$: (selector, root) => root ? root.controls : sections,
    $: () => notice, toggleProjectPort: () => { restored++; }, toggleHealthCheckFields: () => { restored++; }
  });
  toggle();
  assert.equal(sections[0].hidden, true); assert.ok(controls.every((input) => input.disabled)); assert.equal(notice.hidden, false);
  draft = { serviceType: 'web' }; toggle();
  assert.equal(sections[0].hidden, false); assert.ok(controls.every((input) => !input.disabled)); assert.equal(notice.hidden, true); assert.equal(restored, 2);
});

test('resuming an edit refreshes immutable worker type/runtime from live releases rather than stale draft flags', async () => {
  const source = await readFile(new URL('../public/ui/app.js', import.meta.url), 'utf8');
  const body = source.match(/async function ensureEditDraft\(\) \{[^]*?\n\}/)[0];
  const draft = { slug: 'jobs', repository: 'https://example.test/worker.git', runtime: 'php', serviceType: 'web', serviceTypeLocked: false };
  const project = { slug: 'jobs', serviceType: 'worker', runtime: 'node', deployment: { releases: [{ id: 'existing-release' }] } };
  const ensure = runInNewContext(`${body}; ensureEditDraft`, {
    flowMode: 'edit', editSlug: 'jobs', readDraft: () => draft, writeDraft: (patch) => ({ ...draft, ...patch }),
    state: { projects: [project] }, isWorkerProject
  });
  const result = await ensure();
  assert.equal(result.serviceType, 'worker'); assert.equal(result.runtime, 'node');
  assert.equal(result.serviceTypeLocked, true); assert.equal(result.workerRuntimeLocked, true);
  assert.equal(result.repository, draft.repository);
});

test('worker can advance through empty ENV while web empty ENV remains blocked', async () => {
  const source = await readFile(new URL('../public/ui/app.js', import.meta.url), 'utf8');
  const body = source.match(/async function submitDeploy\(event\) \{[^]*?\n\}/)[0];
  for (const serviceType of ['worker', 'web']) {
    let next;
    const submit = runInNewContext(`${body}; submitDeploy`, {
      state: { activeProject: { serviceType }, deployStep: 1 }, can: () => true,
      isWorkerProject, collectDeployEnvironmentContent: () => '',
      parseEnvironmentDocument: () => ({ variables: [] }), $: () => ({}),
      setDeployStep: (step) => { next = step; }
    });
    const action = submit({ preventDefault() {} });
    if (serviceType === 'worker') { await action; assert.equal(next, 2); }
    else { await assert.rejects(action, /environment variable/); assert.equal(next, undefined); }
  }
});
