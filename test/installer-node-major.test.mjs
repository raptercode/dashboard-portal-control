import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
const available = spawnSync(bash, ['--version']).status === 0;
const source = (await readFile(new URL('../dashboard-portal.sh', import.meta.url), 'utf8')).replaceAll('\r\n', '\n');
const shellPath = (path) => path.replaceAll('\\', '/').replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`);
const selection = source.slice(source.indexOf('if [[ -z "$PORTAL_NODE_MAJOR" ]]'), source.indexOf('[[ -n "$DOMAIN"'));
const provision = source.slice(source.indexOf('install_node_version()'), source.indexOf('# Bun is a project runtime'));

test('installer selected runtime succeeds when unused Node 26 cannot load and global tools match selection', { skip: !available }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'portal-node-major-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const version of ['20.20.2', '22.23.3', '24.18.0', '26.10.0']) {
    const bin = join(dir, 'opt', `node-v${version}`, 'bin');
    await mkdir(bin, { recursive: true });
    await writeFile(join(bin, 'node'), version.startsWith('26') ? '#!/bin/bash\necho "libatomic.so.1: not found" >&2\nexit 127\n' : `#!/bin/bash\necho v${version}\n`);
    for (const tool of ['npm', 'npx']) await writeFile(join(bin, tool), '#!/bin/bash\necho 10.0.0\n');
  }
  await mkdir(join(dir, 'global'), { recursive: true });
  const root = shellPath(dir);
  const script = provision.replaceAll('/opt/', `${root}/opt/`).replaceAll('/usr/local/bin/', `${root}/global/`);
  for (const major of ['20', '22', '24']) {
    const result = spawnSync(bash, ['-s'], { encoding: 'utf8', input: `set -euo pipefail\ndie() { echo "$*" >&2; exit 1; }\nchmod +x '${root}'/opt/*/bin/*\nPORTAL_NODE_MAJOR=${major}\nNODE_VERSION=24.18.0\nNODE_SHA256=unused\n${script}\n'${root}/global/node' --version\n` });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp(`v${major}\\.`));
    assert.doesNotMatch(result.stderr, /libatomic/);
  }
});

test('legacy installer detects current major, honors config and explicit choice, and defaults only fresh installs', { skip: !available }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'portal-major-detect-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'global'));
  await writeFile(join(dir, 'global/node'), '#!/bin/bash\necho v22.23.3\n');
  const root = shellPath(dir);
  const block = selection.replaceAll('/usr/local/bin/node', `${root}/global/node`);
  const run = (extra, major = '') => spawnSync(bash, ['-s'], { encoding: 'utf8', input: `set -euo pipefail\ndie() { echo "$*" >&2; exit 1; }\nsystemctl() { echo 0; }\nchmod +x '${root}/global/node'\nCONFIG_ROOT='${root}'\nAPP_ROOT='${root}'\nPORTAL_NODE_MAJOR='${major}'\n${extra}\n${block}\necho "$PORTAL_NODE_MAJOR"\n` });
  assert.equal(run('').stdout.trim(), '24');
  await writeFile(join(dir, 'package.json'), '{}');
  assert.equal(run('').stdout.trim(), '22');
  await writeFile(join(dir, 'dashboard-portal.env'), 'HOSTMGR_NODE_MAJOR=20\n');
  assert.equal(run('').stdout.trim(), '20');
  assert.equal(run('', '26').stdout.trim(), '26');
  await writeFile(join(dir, 'dashboard-portal.env'), 'HOSTMGR_NODE_MAJOR=25\n');
  assert.notEqual(run('').status, 0);
});
