import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InputError, StateStore, validateDomain, validatePasswordChange, validateProject, validateProjectSync, validateTool } from '../src/core.mjs';

test('validators accept a safe project and DNS hostname', () => {
  assert.deepEqual(validateProject({ name: 'Demo', slug: 'demo-app', repository: 'https://github.com/example/demo.git', port: 3000, healthCheckPath: '/ready' }), { name: 'Demo', organization: 'Default', slug: 'demo-app', repository: 'https://github.com/example/demo.git', branch: 'main', directory: '/', port: 3000, healthCheckEnabled: true, healthCheckPath: '/ready' });
  assert.equal(validateProject({ name: 'Demo', slug: 'demo-app', repository: 'https://github.com/example/demo.git', port: 3000, healthCheckEnabled: false }).healthCheckEnabled, false);
  assert.equal(validateDomain({ hostname: 'Demo.Test' }), 'demo.test');
  assert.equal(validateTool('nginx'), 'nginx');
});

test('validators reject dangerous free-form inputs', () => {
  assert.throws(() => validateTool('nginx; id'), InputError);
  assert.throws(() => validateProject({ name: 'Demo', slug: '../escape', repository: 'https://example.com/a.git', port: 3000 }), InputError);
  assert.throws(() => validateProject({ name: 'Demo', slug: 'demo', repository: 'ssh://bad', port: 3000 }), InputError);
  assert.throws(() => validateProject({ name: 'Demo', slug: 'demo', repository: 'https://example.com/a.git', directory: '/../secrets', port: 3000 }), InputError);
  assert.throws(() => validateDomain({ hostname: 'not a domain' }), InputError);
});

test('password changes require a distinct, newline-free password of sufficient length', () => {
  assert.deepEqual(validatePasswordChange({ currentPassword: 'correct-horse-battery-staple', newPassword: 'New-correct-horse1!' }), { currentPassword: 'correct-horse-battery-staple', newPassword: 'New-correct-horse1!' });
  assert.throws(() => validatePasswordChange({ currentPassword: 'same-password', newPassword: 'same-password' }), InputError);
  assert.throws(() => validatePasswordChange({ currentPassword: 'correct-horse-battery-staple', newPassword: 'short' }), InputError);
  assert.throws(() => validatePasswordChange({ currentPassword: 'correct-horse-battery-staple', newPassword: 'new-password\nwith-break' }), InputError);
  assert.throws(() => validatePasswordChange({ currentPassword: 'correct-horse-battery-staple', newPassword: 'alllowercase1!' }), InputError);
});

test('project sync accepts an explicit no-build configuration but rejects shell commands', () => {
  const project = { name: 'Runtime app', slug: 'runtime-app', repository: 'https://github.com/example/runtime.git', branch: 'main', port: 3000, protocol: 'https', buildScript: '', startScript: 'start' };
  assert.equal(validateProjectSync(project).buildScript, null);
  assert.equal(validateProjectSync(project).startScript, 'start');
  assert.throws(() => validateProjectSync({ ...project, buildScript: 'build && id' }), InputError);
});

test('SQLite state store writes transactionally and preserves a tool update', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hostmgr-core-'));
  const path = join(directory, 'state.sqlite');
  const store = new StateStore(path);
  await store.load();
  await store.update((state) => { state.tools.nginx.status = 'Installed'; });
  const reopened = new StateStore(path);
  await reopened.load();
  assert.equal(reopened.snapshot().tools.nginx.status, 'Installed');
});
