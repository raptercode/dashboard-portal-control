import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { releaseBlockers } from '../scripts/release-guard.mjs';

const status = (...entries) => `${entries.join('\0')}\0`;

test('uncommitted runtime files block a release; tests, docs and ignored files do not', () => {
  const found = releaseBlockers(status(
    '?? src/webhook-delivery.mjs', '?? scripts/nginx-realip.mjs', '?? public/ui/new.js', '?? views/x.html', '?? strckro.sh', '?? Dockerfile',
    '?? test/new.test.mjs', '?? docs/en/x.md', '?? notes.txt', '!! node_modules/x'
  ));
  assert.deepEqual(found.untracked, ['src/webhook-delivery.mjs', 'scripts/nginx-realip.mjs', 'public/ui/new.js', 'views/x.html', 'strckro.sh', 'Dockerfile']);
  assert.deepEqual(found.modified, []);
});

test('tracked changes are reported but never block, and renames are read as one entry', () => {
  const found = releaseBlockers(status(' M src/server.mjs', 'M  docs/en/CHANGELOG.md', 'R  src/new-name.mjs', 'src/old-name.mjs', 'A  src/added.mjs', '?? src/untracked.mjs'));
  assert.deepEqual(found.modified, ['src/server.mjs', 'docs/en/CHANGELOG.md', 'src/new-name.mjs', 'src/added.mjs']);
  assert.deepEqual(found.untracked, ['src/untracked.mjs']);
  assert.deepEqual(releaseBlockers(''), { untracked: [], modified: [] });
});

test('prepare-release refuses to build an archive that is missing a file the Portal imports', { skip: spawnSync('git', ['--version']).status !== 0 }, async (t) => {
  const repo = await mkdtemp(join(tmpdir(), 'release-guard-'));
  t.after(() => rm(repo, { recursive: true, force: true }));
  await mkdir(join(repo, 'scripts'));
  await mkdir(join(repo, 'src'));
  for (const file of ['prepare-release.mjs', 'release-guard.mjs', 'software-update.mjs']) await copyFile(new URL(`../scripts/${file}`, import.meta.url), join(repo, 'scripts', file));
  await writeFile(join(repo, 'package.json'), JSON.stringify({ name: 'fixture', version: '9.9.9', type: 'module' }));
  await writeFile(join(repo, 'src', 'server.mjs'), "import './helper.mjs';\n");
  const git = (...args) => spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.test', '-c', 'core.autocrlf=false', ...args], { cwd: repo, encoding: 'utf8' });
  assert.equal(git('init', '-q').status, 0);
  assert.equal(git('add', '-A').status, 0);
  assert.equal(git('commit', '-q', '-m', 'fixture').status, 0);
  // The portal now imports a file nobody committed.
  await writeFile(join(repo, 'src', 'helper.mjs'), 'export {};\n');
  const keyPath = join(repo, '..', `release-guard-key-${process.pid}.pem`);
  await writeFile(keyPath, generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }));
  t.after(() => rm(keyPath, { force: true }));
  const prepare = (...extra) => spawnSync(process.execPath, ['scripts/prepare-release.mjs', '--out=dist', '--archive-url=https://example.test/strckro-9.9.9.tar.gz', ...extra], { cwd: repo, encoding: 'utf8', env: { ...process.env, STRCKRO_UPDATE_PRIVATE_KEY_PATH: keyPath } });

  const refused = prepare();
  assert.equal(refused.status, 1, refused.stderr);
  assert.match(refused.stderr, /not committed.*src\/helper\.mjs/);
  assert.equal(await readFile(join(repo, 'dist', 'strckro-9.9.9.tar.gz')).then(() => true, () => false), false, 'no archive may be produced');

  assert.equal(git('add', '-A').status, 0);
  assert.equal(git('commit', '-q', '-m', 'add helper').status, 0);
  const built = prepare();
  assert.equal(built.status, 0, built.stderr);
  assert.match(built.stdout, /Prepared strckro-9\.9\.9\.tar\.gz/);
  // Run tar from the archive's own directory: GNU tar on Windows reads "C:\..." as a remote host.
  const listing = spawnSync('tar', ['-tzf', 'strckro-9.9.9.tar.gz'], { cwd: join(repo, 'dist'), encoding: 'utf8' });
  assert.ok(listing.stdout.includes('src/helper.mjs'), `archive listing: ${listing.stdout} ${listing.stderr}`);

  // Leaving a file out can be intentional, but only when asked for.
  await writeFile(join(repo, 'src', 'scratch.mjs'), 'export {};\n');
  assert.equal(prepare().status, 1);
  const allowed = prepare('--allow-untracked=yes');
  assert.equal(allowed.status, 0, allowed.stderr);
});
