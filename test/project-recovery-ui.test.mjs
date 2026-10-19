import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const app = await readFile(new URL('../public/ui/app.js', import.meta.url), 'utf8');
const functions = ['projectRecoveredAfterFailure', 'projectDisplayStatus', 'projectDeploymentLabel', 'projectDeploymentCard', 'rollbackProject', 'restartProject', 'syncExistingProject']
  .map(name => app.match(new RegExp(`(?:async )?function ${name}\\([^]*?^}`, 'm'))?.[0] || '').join('\n');
const project = () => ({
  slug: 'example', name: 'Example', sync: { status: 'synced', revision: 'b'.repeat(40) }, runtimeStatus: { state: 'up' },
  deploymentProgress: { id: 'failed-job', status: 'failed', updatedAt: '2026-10-19T19:56:09Z' },
  deployment: { state: 'active', activeReleaseId: 'active-release', previousReleaseId: 'previous-release', releases: [
    { id: 'failed-release', status: 'failed', revision: 'b'.repeat(40), createdAt: '2026-10-19T19:52:53Z', events: [{ status: 'failed', at: '2026-10-19T19:56:09Z' }] },
    { id: 'active-release', status: 'active', revision: 'a'.repeat(40), activatedAt: '2026-10-19T21:20:57Z' },
    { id: 'previous-release', status: 'superseded', revision: 'a'.repeat(40) }
  ] }
});
function element(tag, className = '', textContent = '') {
  return { tag, className, textContent, children: [], append(...nodes) { this.children.push(...nodes); }, setAttribute() {}, addEventListener() {} };
}
const text = node => [node.textContent, ...node.children.map(text)].join(' ');
function context(overrides = {}) {
  const ctx = vm.createContext({ element, can: () => true, ...overrides });
  vm.runInContext(functions, ctx);
  return ctx;
}

test('a successful rollback after a failed candidate shows the running release and keeps failure history accessible', () => {
  const ctx = context();
  const fixture = project();
  assert.equal(ctx.projectDisplayStatus(fixture).key, 'released');
  const card = ctx.projectDeploymentCard(fixture);
  assert.match(text(card), /ย้อนกลับสำเร็จ/);
  assert.match(text(card), /งาน deploy ที่ล้มเหลว/);
  assert.ok(!card.className.includes('is-failed'));
});

test('rollback progress takes precedence over an older failed job; a new failure or stopped app still needs attention', () => {
  const ctx = context();
  const fixture = project();
  fixture.deployment.state = 'rolling_back';
  assert.equal(ctx.projectDisplayStatus(fixture).key, 'deploying');
  assert.match(ctx.projectDisplayStatus(fixture).label, /ย้อนกลับ/);
  assert.match(text(ctx.projectDeploymentCard(fixture)), /กำลังย้อนกลับ/);
  assert.ok(!ctx.projectDeploymentCard(fixture).className.includes('is-failed'));
  fixture.deployment.state = 'active';
  fixture.deploymentProgress.updatedAt = '2026-10-19T21:30:00Z';
  assert.equal(ctx.projectDisplayStatus(fixture).key, 'attention');
  assert.ok(ctx.projectDeploymentCard(fixture).className.includes('is-failed'));
  fixture.deploymentProgress.updatedAt = '2026-10-19T19:56:09Z';
  fixture.runtimeStatus.state = 'down';
  assert.equal(ctx.projectDisplayStatus(fixture).key, 'attention');
});

test('rollback confirmation identifies both releases even when they have the same commit', async () => {
  let description;
  const ctx = context({ confirmAction: async (_title, detail) => { description = detail; return false; } });
  await ctx.rollbackProject(project(), {});
  assert.match(description, /active-release/);
  assert.match(description, /previous-release/);
  assert.match(description, /commit เดียวกัน/);
});

test('the real Sync latest handler explicitly requests a retry, unlike a configuration save', async () => {
  let calls = 0;
  const ctx = context({
    withBusy: async (_button, work) => work(), serviceFields: () => ({}), toast() {}, refresh: async () => {},
    api: async (path, options) => {
      calls++;
      assert.equal(path, '/api/projects/sync');
      assert.equal(options.body.retryDeployment, true);
      return { project: project() };
    }
  });
  await ctx.syncExistingProject(project(), {});
  assert.equal(calls, 1);
});

test('Restart confirms the deployed release, reports progress, and refreshes after a failed request without saving ENV', async () => {
  const fixture = project();
  let refreshed = 0;
  let rendered = 0;
  const ctx = context({
    state: { projects: [fixture] }, view: 'projects',
    withBusy: async (_button, work) => work(),
    confirmAction: async (_title, detail) => { assert.match(detail, /ENV.*เดิม/); assert.match(detail, /Deploy/); return true; },
    renderLiveProjects() { rendered++; assert.equal(ctx.projectDisplayStatus(fixture).label, 'กำลัง Restart…'); },
    api: async (path, options) => {
      assert.equal(path, '/api/projects/example/restart');
      assert.equal(options.body.confirm, true);
      throw new Error('restart failed');
    },
    refresh: async () => { refreshed++; }
  });
  await assert.rejects(ctx.restartProject(fixture, {}), /restart failed/);
  assert.equal(rendered, 1);
  assert.equal(refreshed, 1);
});
