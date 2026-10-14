import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readlink, symlink, rm, access, copyFile, chmod, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseWorkerServiceState, assertWorkerStable } from '../scripts/worker-health.mjs';
import { prepareWorkerActivation } from '../scripts/worker-activation.mjs';
import { runInNewContext } from 'node:vm';
import { nodeMajorForProject } from '../scripts/node-versions.mjs';
import { pythonSettings } from '../scripts/python-project.mjs';

const helperSource = await readFile(new URL('../scripts/hostmgr-deploy-helper.mjs', import.meta.url), 'utf8');
const helperFunction = name => helperSource.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n\\}`))[0];

test('privileged helper accepts domainless web but rejects worker ports, domains and HTTP-only runtimes', () => {
  const validate = runInNewContext(`(${helperFunction('validateProject')})`, { validateSlug: () => {}, nodeMajorForProject, pythonSettings, HelperError: Error, validateDomain: value => value });
  const web = { slug: 'web', port: 3000, startScript: 'start', domains: { hosts: [] } };
  validate(web);
  const worker = { ...web, serviceType: 'worker', port: null, autoPort: false };
  validate(worker);
  for (const invalid of [{ ...worker, port: 3000 }, { ...worker, domains: { hosts: ['example.test'] } }, { ...worker, runtime: 'php' }, { ...worker, runtime: 'docker-compose' }, { ...worker, runtime: 'python', pythonMode: 'asgi', pythonEntry: 'app:app' }]) assert.throws(() => validate(invalid));
});

test('domainless activation invokes no Nginx/Certbot unless removing an existing managed route', async () => {
  const calls = [];
  let managed = false;
  const apply = runInNewContext(`(${helperFunction('applyDomains')})`, {
    join, NGINX_AVAILABLE: '/sites', NGINX_ENABLED: '/enabled',
    exists: async () => managed, removeManagedNginx: async slug => calls.push(slug),
    ensureUnmatchedNginx: () => assert.fail('no Nginx required for domainless project')
  });
  await apply({ slug: 'internal-web', domains: { hosts: [] } });
  assert.deepEqual(calls, []);
  managed = true;
  await apply({ slug: 'internal-web', domains: { hosts: [] } });
  assert.deepEqual(calls, ['internal-web']);
});

test('worker stability requires one running PID without restarts throughout the window', async () => {
  let elapsed = 0;
  const running = { active: 'active', substate: 'running', pid: 42, restarts: 0 };
  const options = { windowMs: 500, timeoutMs: 1000, intervalMs: 100, now: () => elapsed, wait: async ms => { elapsed += ms; } };
  await assertWorkerStable(async () => running, options);
  assert.equal(elapsed, 500);
  for (const changed of [{ ...running, pid: 43 }, { ...running, restarts: 1 }, { ...running, active: 'inactive' }, { ...running, substate: 'auto-restart' }]) {
    elapsed = 0;
    let reads = 0;
    await assert.rejects(assertWorkerStable(async () => ++reads === 1 ? running : changed, options), /exited|restarted/);
  }
  elapsed = 0;
  await assert.rejects(assertWorkerStable(async () => ({ ...running, active: 'activating', pid: 0 }), options), /timeout/);
  await assert.rejects(assertWorkerStable(async () => ({ ...running, restarts: NaN }), options), /could not be verified/);
});

test('systemd worker status parsing keeps PID, restart count and enabled state', () => {
  assert.deepEqual(parseWorkerServiceState('ActiveState=active\nSubState=running\nMainPID=123\nNRestarts=2\nUnitFileState=enabled\n'), { active: 'active', substate: 'running', pid: 123, restarts: 2, enabled: true });
  assert.throws(() => parseWorkerServiceState(''), /could not be verified/);
  assert.throws(() => parseWorkerServiceState('ActiveState=active\nSubState=running\nMainPID=\nNRestarts=0\nUnitFileState=enabled'), /could not be verified/);
  assert.equal(parseWorkerServiceState('ActiveState=inactive\nSubState=dead\nMainPID=0\nNRestarts=0\nUnitFileState=\n').enabled, false);
});

async function fixture(t, { previous = true, failedStart = false, failedStop = false, failedCopy = false, missingPreviousEnvironment = false, recordedCalls = [] } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'portal-worker-activation-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const old = join(root, 'old'); const next = join(root, 'next');
  await mkdir(old); await mkdir(next);
  const identity = { current: join(root, 'current'), unitFile: join(root, 'worker.service'), environmentFile: join(root, 'worker.env'), service: 'fixture-worker.service', gid: 1 };
  if (previous) {
    await writeFile(identity.unitFile, 'old-unit');
    if (!missingPreviousEnvironment) await writeFile(identity.environmentFile, 'OLD=value');
    await symlink(old, identity.current, 'dir');
  }
  const source = join(next, '.env');
  if (!failedCopy) await writeFile(source, 'NEW=value');
  const calls = recordedCalls; let starts = 0;
  const transaction = await prepareWorkerActivation({ identity, releaseId: 'fixture-release', releaseRoot: next, environmentSource: source, unit: 'new-unit', ownership: async () => {},
    readState: async () => ({ active: previous ? 'active' : 'inactive', enabled: previous }),
    run: async (_command, args) => {
      const op = args[0]; calls.push(op);
      if (op === 'stop' && failedStop && starts === 1) throw new Error('candidate cannot stop');
      if (op === 'start') {
        starts++;
        if (starts === 1 && failedStart) throw new Error('candidate startup failed');
      }
    }, assertStable: async () => { calls.push('stable'); }
  });
  return { identity, old, next, calls, transaction };
}

// These tests exercise the helper's POSIX symlink/file transaction, not a live host.
const posix = { skip: process.platform === 'win32' ? 'Helper activation uses POSIX symlinks; covered on Linux' : false };
test('active worker without its previous ENV is rejected before stopping or changing files', posix, async t => {
  const calls = [];
  await assert.rejects(fixture(t, { missingPreviousEnvironment: true, recordedCalls: calls }), /complete previous release/);
  assert.deepEqual(calls, []);
});
test('worker preparation leaves the old worker untouched and activation stops it before switching', posix, async t => {
  const { identity, old, next, calls, transaction } = await fixture(t);
  assert.deepEqual(calls, []);
  assert.equal(await readlink(identity.current), old);
  assert.equal(await readFile(identity.environmentFile, 'utf8'), 'OLD=value');
  await transaction.activate();
  assert.deepEqual(calls, ['stop', 'daemon-reload', 'enable', 'start', 'stable']);
  assert.equal(await readlink(identity.current), next);
  await transaction.rollback();
  assert.deepEqual(calls.slice(5), ['stop', 'daemon-reload', 'enable', 'start', 'stable']);
  assert.equal(await readlink(identity.current), old);
  assert.equal(await readFile(identity.unitFile, 'utf8'), 'old-unit');
  assert.equal(await readFile(identity.environmentFile, 'utf8'), 'OLD=value');
});

test('partial worker preparation failure restores files and the stopped previous process', posix, async t => {
  const { identity, old, calls, transaction } = await fixture(t, { failedCopy: true });
  await assert.rejects(transaction.activate(), /ENOENT/);
  await transaction.rollback();
  assert.equal(await readlink(identity.current), old);
  assert.equal(await readFile(identity.environmentFile, 'utf8'), 'OLD=value');
  assert.deepEqual(calls, ['stop', 'daemon-reload', 'enable', 'start', 'stable']);
});

test('first worker activation failure removes newly created live files and does not restart absent old release', posix, async t => {
  const { identity, calls, transaction } = await fixture(t, { previous: false, failedStart: true });
  await assert.rejects(transaction.activate(), /startup failed/);
  await transaction.rollback();
  for (const path of [identity.current, identity.unitFile, identity.environmentFile]) await assert.rejects(access(path), /ENOENT/);
  assert.deepEqual(calls, ['daemon-reload', 'enable', 'start', 'stop', 'disable', 'daemon-reload']);
});

test('failed candidate stop prevents restoring or concurrently starting the old worker', posix, async t => {
  const { identity, next, calls, transaction } = await fixture(t, { failedStop: true });
  await transaction.activate();
  await assert.rejects(transaction.rollback(), /cannot stop/);
  assert.equal(await readlink(identity.current), next);
  assert.equal(calls.filter(op => op === 'start').length, 1);
});

test('web preparation failure after replacing ENV restores all old files without restarting the old process', posix, async t => {
  const root = await mkdtemp(join(tmpdir(), 'portal-web-partial-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const identity = { root, releases: join(root, 'releases'), current: join(root, 'current'), unitFile: join(root, 'web.service'), environmentFile: join(root, 'web.env'), user: 'fixture', gid: 1 };
  const next = join(identity.releases, 'next'); const old = join(identity.releases, 'old');
  await mkdir(next, { recursive: true }); await mkdir(old);
  await writeFile(join(next, '.env'), 'NEW=value'); await writeFile(identity.environmentFile, 'OLD=value');
  await writeFile(identity.unitFile, 'old-unit'); await symlink(old, identity.current, 'dir');
  const commands = []; let failed = false;
  const prepare = runInNewContext(`(${helperFunction('prepareProjectRelease')})`, {
    projectIdentity: () => identity, ensureProjectUser: async () => {}, mkdir, chmod, join,
    PROJECT_ROOT: root, ENVIRONMENT_ROOT: root, assertDirectory: async () => {},
    exists: async path => access(path).then(() => true).catch(() => false),
    run: async (_command, args) => { commands.push(args[0]); },
    readWorkerState: async () => ({ active: 'active', enabled: true }),
    readNodePackageManager: async () => ({ name: 'npm' }),
    assertPnpmAvailable: async () => { throw new Error('npm fixture must not probe pnpm'); },
    nodeRuntimeEnvironment: () => ({}), process,
    readFile, readlink, optionalSnapshot: async read => { try { return await read(); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } },
    copyFile, chown: async () => {}, rename, rm, symlink, renderProjectUnit: () => 'new-unit', HelperError: Error,
    writeFile: async (path, contents, options) => {
      if (path === identity.unitFile && contents === 'new-unit' && !failed) { failed = true; throw new Error('unit write failed'); }
      return writeFile(path, contents, options);
    }
  });
  await assert.rejects(prepare({ slug: 'web', runtime: 'node' }, 'next'), /unit write failed/);
  assert.equal(await readFile(identity.environmentFile, 'utf8'), 'OLD=value');
  assert.equal(await readFile(identity.unitFile, 'utf8'), 'old-unit');
  assert.equal(await readlink(identity.current), old);
  assert.deepEqual(commands, ['--no-dereference']);
});

test('Nginx restore failure is surfaced instead of reporting silent recovery', async () => {
  const restore = runInNewContext(`(${helperFunction('restoreNginx')})`, {
    rm: async () => {}, writeFile: async () => {}, symlink: async () => {},
    testAndReloadNginx: async () => { throw new Error('reload still failed'); }
  });
  await assert.rejects(restore('/site', '/enabled', { site: 'previous', enabled: '/site' }), /reload still failed/);
});
