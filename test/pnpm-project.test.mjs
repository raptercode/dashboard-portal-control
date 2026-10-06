import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, cp, symlink, readlink, rename, chmod, copyFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import vm from 'node:vm';
import { selectNodePackageManager, readNodePackageManager, assertPnpmAvailable, pnpmServiceStart, PNPM_PATH, PNPM_VERSION } from '../scripts/node-package-manager.mjs';
import { installCandidateDependencies, prepareNativeRelease, probeHostTools } from '../src/server.mjs';
import { TOOLS, createInitialState } from '../src/core.mjs';
import { nodeRuntimeEnvironment } from '../scripts/node-versions.mjs';

test('Node manager selection follows an explicit declaration before the lockfile', () => {
  assert.deepEqual(selectNodePackageManager({}, false), { name: 'npm' });
  assert.deepEqual(selectNodePackageManager({}, true), { name: 'pnpm', version: null });
  assert.deepEqual(selectNodePackageManager({ packageManager: 'npm@11.16.0' }, true), { name: 'npm' });
  assert.deepEqual(selectNodePackageManager({ packageManager: 'pnpm@11.19.0' }, false), { name: 'pnpm', version: '11.19.0' });
  assert.throws(() => selectNodePackageManager({ packageManager: 'pnpm@latest' }, true), /exact pnpm/);
  assert.throws(() => selectNodePackageManager({ packageManager: 'pnpm@11.19.0' }, true, 20), /requires Node/);
  assert.throws(() => selectNodePackageManager({ packageManager: 'pnpm@11.19.0;touch evil' }, true), /exact pnpm/);
});

test('pnpm is optional and doctor observes its actual presence', async () => {
  assert.equal(TOOLS.pnpm.required, false);
  assert.equal(createInitialState().tools.pnpm.status, 'Missing');
  const tools = [{ id: 'pnpm', ...TOOLS.pnpm }];
  const missing = await probeHostTools(tools, async () => ({ ok: false }));
  assert.equal(missing[0].status, 'Missing');
  const installed = await probeHostTools(tools, async (command, args) => {
    assert.ok(command.endsWith('/pnpm'));
    assert.ok(args.includes('--config.pm-on-fail=error'));
    return { ok: true, output: '11.19.0' };
  });
  assert.equal(installed[0].version, '11.19.0');
});

test('deploy only probes pnpm and never installs or switches a missing or mismatched version', async () => {
  const project = { nodeMajor: 24, packageManager: { name: 'pnpm', version: '11.19.0' } };
  const calls = [];
  const run = async (command, args) => { calls.push([command, args]); throw new Error('ENOENT'); };
  await assert.rejects(assertPnpmAvailable(project, run), /Install pnpm in Setup or over SSH/);
  assert.ok(calls.length >= 1);
  assert.ok(calls[0][1].includes('--version'));
  await assert.rejects(assertPnpmAvailable(project, async () => '10.0.0'), /will not download or switch/);
  assert.equal(await assertPnpmAvailable(project, async () => '11.19.0\n'), '11.19.0');
});

test('pnpm frozen installs include build dependencies and do not retry an invalid lockfile', async () => {
  const calls = [];
  await installCandidateDependencies({ runtime: 'pnpm', hasLockfile: true, options: {}, runNpm: async args => calls.push(args) });
  assert.ok(calls[0].includes('--frozen-lockfile'));
  assert.ok(calls[0].includes('--prod=false'));
  calls.length = 0;
  await assert.rejects(installCandidateDependencies({ runtime: 'pnpm', hasLockfile: true, options: {}, runNpm: async args => {
    calls.push(args); throw new Error('ERR_PNPM_OUTDATED_LOCKFILE');
  } }), error => /pnpm-lock.yaml/.test(error.message) && /ERR_PNPM_OUTDATED_LOCKFILE/.test(error.failureLog));
  assert.equal(calls.length, 1);
  calls.length = 0;
  await installCandidateDependencies({ runtime: 'pnpm', hasLockfile: false, options: {}, runNpm: async args => calls.push(args) });
  assert.ok(calls[0].includes('--no-frozen-lockfile'));
});

test('both dependency failure paths retain useful errors and redact registry and project secrets', async () => {
  for (const hasLockfile of [true, false]) {
    await assert.rejects(installCandidateDependencies({ hasLockfile, options: {}, environmentContent: 'API_KEY=fixture-secret\n', runNpm: async () => {
      throw Object.assign(new Error('ERESOLVE'), { commandOutput: 'ERESOLVE peer conflict fixture-secret https://user:pass@registry.test/ _authToken=registry-secret' });
    } }), error => {
      assert.match(error.failureLog, /ERESOLVE peer conflict/);
      assert.doesNotMatch(error.failureLog, /fixture-secret|user:pass|registry-secret/);
      return true;
    });
  }
});

test('only an explicit pnpm Setup request installs the fixed version without lifecycle scripts', async () => {
  const helper = await readFile(new URL('../scripts/hostmgr-deploy-helper.mjs', import.meta.url), 'utf8');
  const source = helper.match(/async function installTool\(tool\) \{[^]*?\n\}/)[0];
  const calls = [];
  const install = vm.runInNewContext(`${source}; installTool`, { NPM: '/usr/local/bin/npm', PNPM_PATH, PNPM_VERSION, HelperError: Error,
    run: async (command, args) => { calls.push([command, Array.from(args)]); return PNPM_VERSION; }
  });
  await install('pnpm');
  assert.equal(calls[0][0], '/usr/local/bin/npm');
  assert.ok(calls[0][1].includes('--ignore-scripts'));
  assert.ok(calls[0][1].includes('pnpm@11.19.0'));
  const installer = await readFile(new URL('../dashboard-portal.sh', import.meta.url), 'utf8');
  assert.doesNotMatch(installer, /(?:npm|npx).*install.*pnpm|pnpm.*setup/);
  assert.match(installer, /node-package-manager\.mjs[^\n]*HELPER_ROOT/);
});

test('pnpm service launcher preserves selected Node and disables package manager downloads', async () => {
  const source = await readFile(new URL('../scripts/hostmgr-deploy-helper.mjs', import.meta.url), 'utf8');
  const render = vm.runInNewContext(`(${source.match(/function renderProjectUnit\(project, identity\) \{[^]*?\n\}/)[0]})`, { pnpmServiceStart });
  const unit = render({ runtime: 'node', nodeMajor: 22, packageManager: { name: 'pnpm' }, startScript: 'start:prod', slug: 'fixture', port: 39999 }, { current: '/srv/fixture/current', root: '/srv/fixture', user: 'fixture', environmentFile: '/etc/fixture.env' });
  assert.match(unit, /PATH=\/opt\/node-v22\.23\.3\/bin:[^\n]+ \/usr\/local\/bin\/pnpm --config.manage-package-manager-versions=false --config.pm-on-fail=error --config.verify-deps-before-run=false run start:prod/);
  assert.match(unit, /User=fixture/);
});

test('activation copies preserve relative pnpm links after the candidate is removed', { skip: process.platform === 'win32' }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'pnpm-links-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const projectRoot = join(root, 'projects');
  const source = join(projectRoot, 'fixture/releases/release');
  const runtimeRoot = join(root, 'runtime');
  const target = join(runtimeRoot, 'releases/release');
  await mkdir(join(source, 'node_modules/.pnpm/dep/node_modules/dep'), { recursive: true });
  await writeFile(join(source, 'node_modules/.pnpm/dep/node_modules/dep/index.js'), 'export default 42;');
  await symlink('.pnpm/dep/node_modules/dep', join(source, 'node_modules/dep'));
  await writeFile(join(source, 'package.json'), JSON.stringify({ packageManager: 'pnpm@11.19.0' }));
  await writeFile(join(source, '.env'), 'NODE_ENV=production\n');
  const helper = await readFile(new URL('../scripts/hostmgr-deploy-helper.mjs', import.meta.url), 'utf8');
  let probedAsUser = false;
  const prepare = vm.runInNewContext(`(${helper.match(/async function prepareProjectRelease\(project, releaseId\) \{[^]*?\n\}/)[0]})`, {
    projectIdentity: () => ({ root: runtimeRoot, releases: join(runtimeRoot, 'releases'), current: join(runtimeRoot, 'current'), user: 'fixture', uid: 1234, gid: 1234, environmentFile: join(root, 'env/fixture.env'), unitFile: join(root, 'fixture.service') }),
    ensureProjectUser: async () => {}, run: async () => {}, chown: async () => {},
    mkdir, rm, cp, rename, chmod, copyFile, readFile, writeFile, readlink, symlink, join, basename,
    readNodePackageManager, nodeRuntimeEnvironment, process, HelperError: Error,
    assertPnpmAvailable: async (_project, _run, options) => { assert.equal(options.uid, 1234); assert.equal(options.gid, 1234); probedAsUser = true; },
    assertDirectory: async () => {}, exists: path => stat(path).then(() => true).catch(() => false),
    renderProjectUnit: () => 'fixture unit', PROJECT_ROOT: projectRoot, ENVIRONMENT_ROOT: join(root, 'env')
  });
  await prepare({ slug: 'fixture', runtime: 'node', nodeMajor: 24 }, 'release');
  assert.equal(probedAsUser, true);
  await rm(source, { recursive: true });
  assert.equal(await readlink(join(target, 'node_modules/dep')), '.pnpm/dep/node_modules/dep');
  assert.match(await readFile(join(target, 'node_modules/dep/index.js'), 'utf8'), /42/);
});

test('real pnpm candidate installs, builds and passes HTTP health with the selected manager', { skip: !process.env.HOSTMGR_PNPM_SMOKE }, async t => {
  const version = process.env.HOSTMGR_PNPM_SMOKE_VERSION || '11.19.0';
  const root = await mkdtemp(join(tmpdir(), 'pnpm-candidate-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = join(root, 'fixture/repository');
  await mkdir(repo, { recursive: true });
  await writeFile(join(repo, 'package.json'), JSON.stringify({ name: 'pnpm-fixture', version: '1.0.0', packageManager: 'pnpm@' + version, dependencies: { 'is-number': '7.0.0' }, scripts: { build: 'node build.cjs', start: 'node server.cjs' } }));
  await writeFile(join(repo, 'build.cjs'), `if (!process.env.npm_config_user_agent.startsWith('pnpm/${version}')) throw Error('wrong manager'); require('node:fs').writeFileSync('built.txt', String(require('is-number')(42)));`);
  await writeFile(join(repo, 'server.cjs'), `if (!process.env.npm_config_user_agent.startsWith('pnpm/${version}')) throw Error('wrong manager'); require('node:http').createServer((q,s)=>s.end('ok')).listen(Number(process.env.PORT), '127.0.0.1');`);
  const project = { name: 'pnpm fixture', slug: 'fixture', repository: 'https://github.com/example/fixture.git', branch: 'main', protocol: 'https', port: 49413, directory: '/', runtime: 'node', nodeMajor: 24, buildScript: 'build', startScript: 'start', healthCheckEnabled: true, candidatePort: 59413, healthCheckPath: '/', healthCheckTimeoutMs: 10000 };
  const events = [];
  await prepareNativeRelease(project, { id: 'release' }, { environment: { encryptedContent: 'fixture' } }, { decrypt: () => 'NODE_ENV=production\n' }, root, (...args) => events.push(args));
  assert.equal(await readFile(join(root, 'fixture/releases/release/built.txt'), 'utf8'), 'true');
  assert.ok(events.some(e => e[2].includes('installed pnpm ' + version)));
  assert.deepEqual(await readNodePackageManager(repo), { name: 'pnpm', version });
  await assert.rejects(readFile(join(repo, 'pnpm-lock.yaml')));
  await copyFile(join(root, 'fixture/releases/release/pnpm-lock.yaml'), join(repo, 'pnpm-lock.yaml'));
  // pnpm 11 can create workspace settings during the initial install.
  await copyFile(join(root, 'fixture/releases/release/pnpm-workspace.yaml'), join(repo, 'pnpm-workspace.yaml')).catch(error => { if (error.code !== 'ENOENT') throw error; });
  events.length = 0;
  await prepareNativeRelease({ ...project, healthCheckEnabled: false }, { id: 'locked' }, { environment: {} }, null, root, (...args) => events.push(args));
  assert.ok(events.some(e => /Locked dependencies installed with pnpm/.test(e[2])));
  const manifest = JSON.parse(await readFile(join(repo, 'package.json'), 'utf8'));
  manifest.dependencies['is-number'] = '6.0.0';
  await writeFile(join(repo, 'package.json'), JSON.stringify(manifest));
  await assert.rejects(prepareNativeRelease({ ...project, healthCheckEnabled: false }, { id: 'stale' }, { environment: {} }, null, root), error => /ERR_PNPM_OUTDATED_LOCKFILE/.test(error.failureLog));
  await assert.rejects(stat(join(root, 'fixture/releases/stale')));
});

test('pnpm 12 installed beside selected Node is resolved and reused by service startup', async () => {
  const project = { nodeMajor: 24, startScript: 'start:prod', packageManager: selectNodePackageManager({ packageManager: 'pnpm@12.9.1' }, true) };
  const path = '/opt/node-v24.18.0/bin/pnpm';
  const version = await assertPnpmAvailable(project, async command => {
    if (command !== path) throw new Error('ENOENT');
    return '12.9.1';
  });
  assert.equal(version, '12.9.1');
  assert.equal(project.packageManager.executable, path);
  assert.match(pnpmServiceStart(project), /\/opt\/node-v24\.18\.0\/bin\/pnpm /);
});
