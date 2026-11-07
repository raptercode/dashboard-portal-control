import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { NODE_VERSIONS } from '../scripts/node-versions.mjs';

const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
const available = spawnSync(bash, ['--version']).status === 0;
const source = (await readFile(new URL('../strckro.sh', import.meta.url), 'utf8')).replaceAll('\r\n', '\n');
const shellPath = (path) => path.replaceAll('\\', '/').replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`);
const selection = source.slice(source.indexOf('if [[ -z "$PORTAL_NODE_MAJOR" ]]'), source.indexOf('[[ -n "$DOMAIN"'));
const provision = source.slice(source.indexOf('node_pin()'), source.indexOf('# Bun is a project runtime'));
const exists = (path) => access(path).then(() => true, () => false);

async function fakeRuntime(dir, version, { broken = false } = {}) {
  const bin = join(dir, 'opt', `node-v${version}`, 'bin');
  await mkdir(bin, { recursive: true });
  await writeFile(join(bin, 'node'), broken ? '#!/bin/bash\necho "libatomic.so.1: not found" >&2\nexit 127\n' : `#!/bin/bash\necho v${version}\n`);
  for (const tool of ['npm', 'npx']) await writeFile(join(bin, tool), '#!/bin/bash\necho 10.0.0\n');
}

test('installer pins, scripts/node-versions.mjs and the Docker default name the same Node.js releases', async () => {
  const pins = new Map([...source.matchAll(/^\s+(20|22|26)\) NODE_PIN_VERSION='([^']+)'; NODE_PIN_SHA='([0-9a-f]{64})' ;;$/gm)].map((match) => [Number(match[1]), { version: match[2], sha: match[3] }]));
  pins.set(24, { version: source.match(/^NODE_VERSION='([^']+)'$/m)[1], sha: source.match(/^NODE_SHA256='([0-9a-f]{64})'$/m)[1] });
  assert.deepEqual([...pins.keys()].sort(), [20, 22, 24, 26]);
  for (const [major, version] of Object.entries(NODE_VERSIONS)) assert.equal(pins.get(Number(major)).version, version, `Node ${major} pin differs between strckro.sh and scripts/node-versions.mjs`);
  assert.equal(new Set([...pins.values()].map((pin) => pin.sha)).size, 4, 'each pinned release needs its own checksum');
  const docker = await readFile(new URL('../Dockerfile', import.meta.url), 'utf8');
  assert.equal(docker.match(/^ARG NODE_VERSION=(\S+)$/m)[1], NODE_VERSIONS[24]);
});

test('installer selected runtime succeeds when an unusable provisioned Node 26 cannot load and global tools match selection', { skip: !available }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'portal-node-major-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const version of Object.values(NODE_VERSIONS)) await fakeRuntime(dir, version, { broken: version.startsWith('26.') });
  await mkdir(join(dir, 'global'), { recursive: true });
  const root = shellPath(dir);
  const script = provision.replaceAll('/opt/', `${root}/opt/`).replaceAll('/usr/local/bin/', `${root}/global/`);
  for (const major of ['20', '22', '24']) {
    const result = spawnSync(bash, ['-s'], { encoding: 'utf8', input: `set -euo pipefail\ndie() { echo "$*" >&2; exit 1; }\nchmod +x '${root}'/opt/*/bin/*\nPORTAL_NODE_MAJOR=${major}\nNODE_VERSION=${NODE_VERSIONS[24]}\nNODE_SHA256=unused\n${script}\n'${root}/global/node' --version\n` });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp(`v${major}\\.`));
    // The broken runtime is reported, not fatal, and never becomes the selected one.
    assert.match(result.stderr, /WARNING: Node\.js 26 is provisioned on this host but could not be moved to its pinned release/);
  }
});

test('installer moves other provisioned majors to their pins, skips absent majors and keeps old runtimes', { skip: !available }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'portal-node-refresh-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await fakeRuntime(dir, '24.18.0');
  await fakeRuntime(dir, '22.23.3');
  await mkdir(join(dir, 'global'), { recursive: true });
  await mkdir(join(dir, 'tmp'), { recursive: true });
  const root = shellPath(dir);
  const script = provision.replaceAll('/opt/', `${root}/opt/`).replaceAll('/usr/local/bin/', `${root}/global/`);
  // Network, checksum and extraction are stubbed: the test is about which runtimes are fetched.
  const stubs = `
curl() { local url='' out=''; while [[ $# -gt 0 ]]; do
  if [[ "$1" == https://* ]]; then url="$1"; fi
  if [[ "$1" == -o ]]; then out="$2"; fi
  shift; done
  echo "$url" >> '${root}/downloads.log'; : > "$out"; }
sha256sum() { local line; read -r line || true; if [[ -n "\${FAIL_ARCHIVE:-}" && "$line" == *"\${FAIL_ARCHIVE}"* ]]; then return 1; fi; }
tar() { local dir=''; while [[ $# -gt 0 ]]; do
  if [[ "$1" == --directory ]]; then dir="$2"; fi
  shift; done
  mkdir -p "$dir/bin"
  printf '#!/bin/bash\\necho v%s\\n' "\${dir##*node-v}" > "$dir/bin/node"
  for tool in npm npx; do printf '#!/bin/bash\\necho 10.0.0\\n' > "$dir/bin/$tool"; done
  chmod +x "$dir/bin/"*; }
`;
  const run = (extra = '') => spawnSync(bash, ['-s'], { encoding: 'utf8', input: `set -euo pipefail\ndie() { echo "$*" >&2; exit 1; }\nchmod +x '${root}'/opt/*/bin/*\nTMP_DIR='${root}/tmp'\nPORTAL_NODE_MAJOR=24\nNODE_VERSION=${NODE_VERSIONS[24]}\nNODE_SHA256=unused\n${extra}\n${stubs}\n${script}\n'${root}/global/node' --version\n` });

  const failed = run(`FAIL_ARCHIVE=node-v${NODE_VERSIONS[22]}`);
  assert.equal(failed.status, 0, failed.stderr);
  assert.match(failed.stderr, /WARNING: Node\.js 22 is provisioned on this host but could not be moved to its pinned release.*checksum verification failed/);
  assert.equal(await exists(join(dir, 'opt', `node-v${NODE_VERSIONS[22]}`)), false, 'a runtime that failed verification must not be installed');
  assert.equal(await exists(join(dir, 'opt', 'node-v22.23.3', 'bin', 'node')), true, 'the previous runtime stays in place');
  assert.match(failed.stdout, new RegExp(`v${NODE_VERSIONS[24]}`));

  const ok = run();
  assert.equal(ok.status, 0, ok.stderr);
  assert.doesNotMatch(ok.stderr, /WARNING/);
  assert.match(ok.stdout, new RegExp(`v${NODE_VERSIONS[24]}`));
  const downloads = (await readFile(join(dir, 'downloads.log'), 'utf8')).trim().split('\n');
  const archive = (major) => `https://nodejs.org/dist/v${NODE_VERSIONS[major]}/node-v${NODE_VERSIONS[major]}-linux-x64.tar.xz`;
  assert.deepEqual(downloads.filter((url, index) => downloads.indexOf(url) === index), [archive(24), archive(22)], 'Node 20 and 26 are not provisioned here and must not be downloaded');
  for (const major of [22, 24]) assert.equal(await exists(join(dir, 'opt', `node-v${NODE_VERSIONS[major]}`, 'bin', 'node')), true);
  for (const old of ['24.18.0', '22.23.3']) assert.equal(await exists(join(dir, 'opt', `node-v${old}`, 'bin', 'node')), true, `${old} stays for services activated against it`);
  assert.equal(await exists(join(dir, 'opt', `node-v${NODE_VERSIONS[20]}`)), false);
  assert.equal(await exists(join(dir, 'opt', `node-v${NODE_VERSIONS[26]}`)), false);
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
