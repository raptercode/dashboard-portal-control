import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { phpSettings, phpStartArgs, phpUserOptions, phpProcessEnvironment } from '../scripts/php-project.mjs';
import { InputError, SecretVault, validateProjectSync } from '../src/core.mjs';
import { createRelease, renderSystemdUnit, validateNativeProject } from '../src/native-project.mjs';
import { preparePhpRelease } from '../src/server.mjs';
import { scanProjectRuntimeDirectory } from '../src/project-runtime.mjs';

const project = { name: 'Laravel API', slug: 'laravel-api', repository: 'https://github.com/example/laravel.git', branch: 'main', port: 3200, runtime: 'php', framework: 'laravel', phpMode: 'artisan', phpDocroot: 'public', phpInstall: 'composer' };

test('PHP accepts typed start modes and requires a non-root installation identity', () => {
  const native = validateNativeProject(validateProjectSync(project));
  assert.equal(native.startScript, null);
  assert.equal(native.buildScript, null);
  assert.equal(createRelease(native).phpMode, 'artisan');
  assert.match(renderSystemdUnit(native), /User=hostmgr-laravel-api/);
  assert.match(renderSystemdUnit(native), /artisan serve --host 127\.0\.0\.1 --port 3200/);
  assert.deepEqual(phpStartArgs({ phpMode: 'server', phpDocroot: 'public', phpRouter: 'public/index.php' }, 3200), ['-S', '127.0.0.1:3200', '-t', 'public', 'public/index.php']);
  assert.deepEqual(phpStartArgs({ phpMode: 'spark' }, 3200), ['spark', 'serve', '--host', '127.0.0.1', '--port', '3200']);
  for (const phpDocroot of ['../public', '/tmp/public', 'public;id']) assert.throws(() => validateProjectSync({ ...project, phpMode: 'server', phpDocroot }), InputError);
  assert.throws(() => phpSettings({ phpMode: 'module' }));
  assert.throws(() => phpUserOptions({ uid: 0, gid: 1000 }, '/srv/project'), /non-root/);
  const environment = phpProcessEnvironment('/srv/project', { HOSTMGR_SECRET_KEY: 'secret', COMPOSER_AUTH: 'token' });
  assert.equal(environment.HOSTMGR_SECRET_KEY, undefined);
  assert.equal(environment.COMPOSER_HOME, join('/srv/project', '.composer'));
});

test('PHP detection and source preflight exclude vendor and reserve runtime paths', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'hostmgr-php-source-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, project.slug, 'repository');
  await mkdir(join(source, 'vendor'), { recursive: true });
  await mkdir(join(source, 'public'), { recursive: true });
  await writeFile(join(source, 'vendor', 'do-not-copy'), 'untrusted vendor');
  await writeFile(join(source, '.hostmgr-php-ready'), 'untrusted marker');
  await writeFile(join(source, 'artisan'), '#!/usr/bin/env php\n');
  await writeFile(join(source, 'composer.json'), JSON.stringify({ require: { 'laravel/framework': '^11.0' } }));
  const detected = await scanProjectRuntimeDirectory(source);
  assert.equal(detected.recommendedRuntime, 'php');
  assert.equal(detected.recommendedFramework, 'laravel');
  const release = createRelease(project);
  const vault = new SecretVault(Buffer.alloc(32, 7).toString('base64'));
  await preparePhpRelease(project, release, { environment: { encryptedContent: vault.encrypt('PORT=9999\nAPP_KEY=test-secret\n') } }, vault, root);
  const candidate = join(root, project.slug, 'releases', release.id);
  await assert.rejects(stat(join(candidate, 'vendor')), { code: 'ENOENT' });
  await assert.rejects(stat(join(candidate, '.hostmgr-php-ready')), { code: 'ENOENT' });
  const environment = await readFile(join(candidate, '.env'), 'utf8');
  assert.match(environment, /PORT=3200/);
  assert.doesNotMatch(environment, /PORT=9999/);
  assert.equal(await readFile(join(source, 'vendor', 'do-not-copy'), 'utf8'), 'untrusted vendor');
});
