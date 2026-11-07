import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, access, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { NODE_VERSIONS } from '../scripts/node-versions.mjs';

const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
const available = spawnSync(bash, ['--version']).status === 0;
const source = (await readFile(new URL('../strckro.sh', import.meta.url), 'utf8')).replaceAll('\r\n', '\n');
const shellPath = (path) => path.replaceAll('\\', '/').replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`);
// Function definitions only: from node_pin() up to the line that first calls provision_node_runtimes.
const definitions = source.slice(source.indexOf('node_pin()'), source.indexOf('\nprovision_node_runtimes\nnode_pin'));
const exists = (path) => access(path).then(() => true, () => false);

// A runtime laid out exactly as the Node.js archive unpacks it.
async function runtime(dir, version) {
  const root = join(dir, 'opt', `node-v${version}`);
  await mkdir(join(root, 'bin'), { recursive: true });
  await writeFile(join(root, 'bin', 'node'), `#!/bin/bash\necho v${version}\n`);
  for (const tool of ['npm', 'npx', 'corepack']) await writeFile(join(root, 'bin', tool), '#!/bin/bash\necho 10.0.0\n');
  for (const module of ['npm', 'corepack']) await mkdir(join(root, 'lib', 'node_modules', module), { recursive: true });
  await mkdir(join(root, 'include', 'node'), { recursive: true });
  await mkdir(join(root, 'share', 'doc'), { recursive: true });
  for (const file of ['CHANGELOG.md', 'LICENSE', 'README.md']) await writeFile(join(root, file), 'text\n');
}

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'node-prune-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = shellPath(dir);
  for (const sub of ['units', 'projects', 'proc', join('proc', 'self')]) await mkdir(join(dir, sub), { recursive: true });
  const prune = (extra = '') => spawnSync(bash, ['-s'], {
    encoding: 'utf8',
    input: `set -euo pipefail\ndie() { echo "$*" >&2; exit 1; }\nchmod +x '${root}'/opt/*/bin/* 2>/dev/null || true\nNODE_VERSION=${NODE_VERSIONS[24]}\nNODE_SHA256=unused\nNODE_RUNTIME_ROOT='${root}/opt'\nSERVICE_UNIT_DIR='${root}/units'\nPROJECT_CONFIG_DIR='${root}/projects'\nPROC_DIR='${root}/proc'\n${definitions}\n${extra}\nprune_node_runtimes\n`
  });
  return { dir, root, prune };
}

test('old Node.js runtimes are removed only when nothing uses them and their major has a working pin', { skip: !available }, async (t) => {
  const { dir, root, prune } = await fixture(t);
  const pinned = { 20: NODE_VERSIONS[20], 22: NODE_VERSIONS[22], 24: NODE_VERSIONS[24] };
  for (const version of [pinned[20], pinned[22], pinned[24]]) await runtime(dir, version);
  // Out of date and unreferenced: these go.
  for (const version of ['24.18.0', '22.9.0', '20.20.1']) await runtime(dir, version);
  // Out of date but named by a project unit: its owner has not redeployed yet.
  await runtime(dir, '22.23.3');
  await writeFile(join(dir, 'units', 'hostmgr-project-api.service'), `[Service]\nExecStart=/usr/bin/env PATH=${root}/opt/node-v22.23.3/bin:/usr/local/bin:/usr/bin:/bin ${root}/opt/node-v22.23.3/bin/npm run start\n`);
  // Out of date but named by project configuration.
  await runtime(dir, '22.20.0');
  await mkdir(join(dir, 'projects', 'web'), { recursive: true });
  await writeFile(join(dir, 'projects', 'web', 'runtime.env'), `NODE=${root}/opt/node-v22.20.0/bin/node\n`);
  // Out of date but a process runs from it (the real check is exercised separately on Linux).
  await runtime(dir, '22.1.0');
  // Its major has no pinned release installed: removing it would leave the major without a runtime.
  await runtime(dir, '26.10.0');
  // Newer than the pin, so somebody else put it there.
  await runtime(dir, '24.99.0');
  // Out of date and unreferenced, but an administrator installed something into it: it is theirs now.
  await runtime(dir, '22.8.0');
  await mkdir(join(dir, 'opt', 'node-v22.8.0', 'lib', 'node_modules', 'pm2'), { recursive: true });
  await runtime(dir, '22.7.0');
  await writeFile(join(dir, 'opt', 'node-v22.7.0', 'bin', 'pnpm'), '#!/bin/sh\n');
  // Exactly what the Node archive ships (node, npm, npx, corepack; npm and corepack as modules): removable.
  await runtime(dir, '22.6.0');
  for (const tool of ['npm', 'npx', 'corepack']) await writeFile(join(dir, 'opt', 'node-v22.6.0', 'bin', tool), '#!/bin/sh\n');
  for (const module of ['npm', 'corepack']) await mkdir(join(dir, 'opt', 'node-v22.6.0', 'lib', 'node_modules', module), { recursive: true });
  // Not a managed name.
  await mkdir(join(dir, 'opt', 'node-vnext'), { recursive: true });
  await mkdir(join(dir, 'opt', 'node-v24.18'), { recursive: true });
  await mkdir(join(dir, 'opt', 'node-v25.1.0'), { recursive: true });

  const result = prune(`node_runtime_in_use() { [[ "$1" == *'/node-v22.1.0' ]]; }`);
  assert.equal(result.status, 0, result.stderr);
  for (const gone of ['24.18.0', '22.9.0', '20.20.1', '22.6.0']) {
    assert.equal(await exists(join(dir, 'opt', `node-v${gone}`)), false, `${gone} should be removed`);
    assert.match(result.stdout, new RegExp(`Removed the unused Node\\.js runtime .*node-v${gone.replaceAll('.', '\\.')}\\n`));
  }
  for (const kept of [pinned[20], pinned[22], pinned[24], '22.23.3', '22.20.0', '22.1.0', '26.10.0', '24.99.0', '22.8.0', '22.7.0']) {
    assert.equal(await exists(join(dir, 'opt', `node-v${kept}`, 'bin', 'node')), true, `${kept} must stay`);
  }
  for (const name of ['node-vnext', 'node-v24.18', 'node-v25.1.0']) assert.equal(await exists(join(dir, 'opt', name)), true, name);
  assert.doesNotMatch(result.stdout, /node-v(22\.23\.3|22\.20\.0|22\.1\.0|26\.10\.0|24\.99\.0|22\.8\.0|22\.7\.0)/);

  // Once the unit is rewritten for the new release, the next update removes the old runtime.
  await writeFile(join(dir, 'units', 'hostmgr-project-api.service'), `[Service]\nExecStart=/usr/bin/env PATH=${root}/opt/node-v${pinned[22]}/bin:/usr/bin ${root}/opt/node-v${pinned[22]}/bin/npm run start\n`);
  const next = prune(`node_runtime_in_use() { return 1; }`);
  assert.equal(next.status, 0, next.stderr);
  assert.equal(await exists(join(dir, 'opt', 'node-v22.23.3')), false);
  assert.equal(await exists(join(dir, 'opt', 'node-v22.20.0')), true, 'still named by project configuration');
});

test('a pinned runtime that does not run protects every older runtime of its major', { skip: !available }, async (t) => {
  const { dir, prune } = await fixture(t);
  await runtime(dir, '24.18.0');
  const broken = join(dir, 'opt', `node-v${NODE_VERSIONS[24]}`, 'bin');
  await mkdir(broken, { recursive: true });
  await writeFile(join(broken, 'node'), '#!/bin/bash\nexit 127\n');
  const result = prune(`node_runtime_in_use() { return 1; }`);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await exists(join(dir, 'opt', 'node-v24.18.0', 'bin', 'node')), true);
});

test('a runtime counts as untouched only when it is exactly what the Node.js archive unpacks to', { skip: !available }, async (t) => {
  const { dir, prune } = await fixture(t);
  await runtime(dir, NODE_VERSIONS[22]);
  const variants = {
    '22.1.1': async (root) => { await mkdir(join(root, 'etc'), { recursive: true }); await writeFile(join(root, 'etc', 'npmrc'), 'prefix=/opt\n'); },
    '22.1.2': async (root) => writeFile(join(root, 'ecosystem.config.js'), 'module.exports = {};\n'),
    '22.1.3': async (root) => rm(join(root, 'bin'), { recursive: true }),
    '22.1.4': async (root) => writeFile(join(root, 'bin', '.wrapper'), '#!/bin/sh\n'),
    '22.1.5': async (root) => writeFile(join(root, 'lib', 'node_modules', '.package-lock.json'), '{}\n'),
    '22.1.6': async (root) => mkdir(join(root, 'share', 'extra'), { recursive: true }),
    '22.1.7': async (root) => mkdir(join(root, 'lib', 'extra'), { recursive: true }),
    '22.1.8': async (root) => rm(join(root, 'bin', 'node')),
    '22.1.9': async (root) => mkdir(join(root, 'app', 'src'), { recursive: true }),
    '22.2.1': async (root) => writeFile(join(root, 'include', 'my-header.h'), '\n'),
    '22.2.2': async (root) => rm(join(root, 'lib', 'node_modules', 'npm'), { recursive: true })
  };
  for (const [version, change] of Object.entries(variants)) {
    await runtime(dir, version);
    await change(join(dir, 'opt', `node-v${version}`));
  }
  await runtime(dir, '22.0.1');
  const result = prune(`node_runtime_in_use() { return 1; }`);
  assert.equal(result.status, 0, result.stderr);
  for (const version of Object.keys(variants)) assert.equal(await exists(join(dir, 'opt', `node-v${version}`)), true, `${version} holds something the archive does not, or lacks something it has: keep it`);
  assert.equal(await exists(join(dir, 'opt', 'node-v22.0.1')), false, 'the untouched control is removed');
  assert.equal(result.stdout.trim().split('\n').length, 1);
});

test('with no runtimes at all the pruning pass succeeds and removes nothing', { skip: !available }, async (t) => {
  const { dir, prune } = await fixture(t);
  await mkdir(join(dir, 'opt'), { recursive: true });
  const result = prune(`node_runtime_in_use() { return 1; }`);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
});

test('a process running from an old runtime keeps it (real /proc-style check)', { skip: !available || process.platform === 'win32' }, async (t) => {
  const { dir, root, prune } = await fixture(t);
  await runtime(dir, NODE_VERSIONS[22]);
  await runtime(dir, '22.1.0');
  await runtime(dir, '22.2.0');
  await mkdir(join(dir, 'proc', '4242'), { recursive: true });
  await symlink(join(dir, 'opt', 'node-v22.1.0', 'bin', 'node'), join(dir, 'proc', '4242', 'exe'));
  await mkdir(join(dir, 'proc', '4243'), { recursive: true });
  await symlink(join(dir, 'opt', 'node-v22.2.0', 'bin'), join(dir, 'proc', '4243', 'cwd'));
  // A working directory that is exactly the runtime directory, with nothing after it.
  await runtime(dir, '22.4.0');
  await mkdir(join(dir, 'proc', '4244'), { recursive: true });
  await symlink(join(dir, 'opt', 'node-v22.4.0'), join(dir, 'proc', '4244', 'cwd'));
  // A unit linked in with `systemctl link` is a symbolic link in the unit directory.
  await runtime(dir, '22.5.0');
  await mkdir(join(dir, 'elsewhere'), { recursive: true });
  await writeFile(join(dir, 'elsewhere', 'app.service'), `[Service]\nExecStart=${root}/opt/node-v22.5.0/bin/node app.js\n`);
  await symlink(join(dir, 'elsewhere'), join(dir, 'units', 'linked'));
  await runtime(dir, '22.3.0');
  const result = prune();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await exists(join(dir, 'opt', 'node-v22.1.0')), true, 'its executable is running');
  assert.equal(await exists(join(dir, 'opt', 'node-v22.2.0')), true, 'its working directory is inside');
  assert.equal(await exists(join(dir, 'opt', 'node-v22.4.0')), true, 'its working directory is the directory itself');
  assert.equal(await exists(join(dir, 'opt', 'node-v22.5.0')), true, 'a unit reached through a symbolic link names it');
  assert.equal(await exists(join(dir, 'opt', 'node-v22.3.0')), false, 'nothing uses this one');
  assert.match(result.stdout, new RegExp(`Removed the unused Node\\.js runtime ${root.replaceAll('.', '\\.')}/opt/node-v22\\.3\\.0\\n`));
});

test('when /proc cannot be read nothing is pruned, because "unknown" must not mean "unused"', { skip: !available }, async (t) => {
  const { dir, prune } = await fixture(t);
  await runtime(dir, NODE_VERSIONS[22]);
  await runtime(dir, '22.1.0');
  await rm(join(dir, 'proc'), { recursive: true });
  const result = prune();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await exists(join(dir, 'opt', 'node-v22.1.0', 'bin', 'node')), true);
});

test('the installer reviews old runtimes only after the new release is serving over HTTPS, and never fails on it', () => {
  const health = source.indexOf('HTTPS health check failed after certificate issuance');
  const call = source.indexOf("prune_node_runtimes || echo 'WARNING");
  const disarm = source.lastIndexOf('ROLLBACK_ARMED=false');
  assert.ok(health > 0 && call > health && disarm > call, 'prune after the HTTPS health check and before the rollback is disarmed');
  assert.equal(source.match(/^prune_node_runtimes(?!\(\)| \|\|)/gm)?.length ?? 0, 0, 'no unguarded call');
  assert.match(source, /^PROC_DIR='\/proc'$/m);
});
