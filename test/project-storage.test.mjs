import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat, mkdir, mkdtemp, readFile, readdir, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { createApplication } from '../src/server.mjs';
import { InputError, validateProjectSync } from '../src/core.mjs';
import { nodeMajorForProject } from '../scripts/node-versions.mjs';
import { pythonSettings } from '../scripts/python-project.mjs';
import { mountProjectStorage, storageDirectory, validateStoragePath } from '../scripts/project-storage.mjs';

const linux = process.platform === 'linux';
const helperSource = await readFile(new URL('../scripts/hostmgr-deploy-helper.mjs', import.meta.url), 'utf8');
const moduleSource = await readFile(new URL('../scripts/project-storage.mjs', import.meta.url), 'utf8');
const installerSource = await readFile(new URL('../strckro.sh', import.meta.url), 'utf8');
const helperFunction = (name) => helperSource.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n\\}`))[0];

test('storage path accepts a folder inside the app and normalizes it', () => {
  for (const [input, expected] of [['uploads', 'uploads'], ['./uploads/', 'uploads'], ['  public/uploads  ', 'public/uploads'], ['storage/app/public', 'storage/app/public'], ['my-files_2.0', 'my-files_2.0']]) assert.equal(validateStoragePath(input), expected, input);
  for (const empty of [undefined, null, '', '   ', './']) assert.equal(validateStoragePath(empty), null, JSON.stringify(empty));
});

test('storage path rejects anything that could leave the app folder or break the runtime', () => {
  const invalid = ['/', '/etc', '/uploads', '../uploads', 'a/../b', 'a/./b', '.', '..', '.git', '.env', 'uploads/.hidden', 'a//b', 'a\\b', 'a b', 'up;id', 'up\nloads', 'node_modules', 'src/node_modules/x', 'vendor', 'Vendor/cache', 'venv', 'hostmgr-app', 'a/b/c/d/e/f', 'x'.repeat(65), `${'a/'.repeat(79)}a`, 7, {}, ['uploads']];
  for (const value of invalid) assert.throws(() => validateStoragePath(value), Error, JSON.stringify(value));
  // The message is shown to the owner, so it must be ours and not "value.trim is not a function".
  for (const value of [7, true, {}, ['uploads']]) assert.throws(() => validateStoragePath(value), (error) => error.constructor === Error && /must be text/.test(error.message), JSON.stringify(value));
  assert.throws(() => validateStoragePath('/etc'), /relative to the app folder/);
});

test('project sync validation: omitted keeps the stored value, empty turns it off, bad values are input errors', () => {
  const base = { name: 'App', slug: 'app', repository: 'https://github.com/example/app.git', port: 3000, runtime: 'node' };
  assert.equal('storagePath' in validateProjectSync(base), false);
  assert.equal(validateProjectSync({ ...base, storagePath: './uploads/' }).storagePath, 'uploads');
  assert.equal(validateProjectSync({ ...base, storagePath: '' }).storagePath, null);
  assert.equal(validateProjectSync({ ...base, storagePath: null }).storagePath, null);
  assert.equal(validateProjectSync({ ...base, runtime: 'python', storagePath: 'media' }).storagePath, 'media');
  assert.equal(validateProjectSync({ ...base, runtime: 'go', storagePath: 'media' }).storagePath, 'media');
  for (const storagePath of ['../x', '/abs', '.env', 'node_modules', 5]) assert.throws(() => validateProjectSync({ ...base, storagePath }), InputError, String(storagePath));
  const compose = { ...base, runtime: 'docker-compose', composeFile: 'compose.yaml', composeService: 'web' };
  assert.equal(validateProjectSync({ ...compose, storagePath: '' }).storagePath, null);
  assert.throws(() => validateProjectSync({ ...compose, storagePath: 'uploads' }), /named volumes/);
});

test('privileged helper re-validates the stored storage path before it touches the host', () => {
  const validate = runInNewContext(`(${helperFunction('validateProject')})`, { validateSlug: () => {}, nodeMajorForProject, pythonSettings, HelperError: Error, validateDomain: (value) => value, validateStoragePath });
  const web = { slug: 'web', port: 3000, startScript: 'start', domains: { hosts: [] } };
  validate({ ...web });
  const normalized = { ...web, storagePath: './uploads/' };
  validate(normalized);
  assert.equal(normalized.storagePath, 'uploads');
  validate({ ...web, storagePath: null });
  for (const storagePath of ['../etc', '/etc', '.git', 'node_modules', 4]) assert.throws(() => validate({ ...web, storagePath }), Error, String(storagePath));
  assert.throws(() => validate({ ...web, runtime: 'docker-compose', composeFile: 'compose.yaml', composeService: 'web', storagePath: 'uploads' }), /named volumes/);
});

test('helper links the storage as the project user and fails with a message the owner can read', async () => {
  const calls = [];
  const build = (overrides = {}) => runInNewContext(`(${helperFunction('mountStorage')})`, {
    HelperError: class HelperError extends Error {},
    mountProjectStorage,
    run: async (command, args, options) => { calls.push({ command, args, options }); return ''; },
    ...overrides
  });
  const owner = { root: '/srv/hostmgr/projects/app', uid: 991, gid: 990 };
  await build()({ storagePath: 'uploads' }, owner, '/srv/hostmgr/projects/app/releases/r1');
  assert.deepEqual(calls.map((call) => call.command), ['/usr/bin/mkdir', '/usr/bin/mkdir', '/usr/bin/ln']);
  for (const { options } of calls) {
    assert.equal(options.uid, 991);
    assert.equal(options.gid, 990);
    assert.equal(options.cwd, owner.root);
    assert.match(options.failure, /persistent storage folder could not be linked/);
  }
  const failing = build({ mountProjectStorage: async () => { throw new Error('The storage path "uploads" is a file in the release.'); } });
  await assert.rejects(failing({ storagePath: 'uploads' }, owner, '/r'), (error) => error.constructor.name === 'HelperError' && /is a file in the release/.test(error.message));
  class Kept extends Error {}
  const passthrough = build({ HelperError: Kept, mountProjectStorage: async () => { throw new Kept('already a helper error'); } });
  await assert.rejects(passthrough({ storagePath: 'uploads' }, owner, '/r'), (error) => error instanceof Kept && error.message === 'already a helper error');
});

test('activation mounts storage once the release is in place, before the runtime is prepared, and never for Compose', () => {
  const prepare = helperFunction('prepareProjectRelease');
  const placed = prepare.indexOf('await rename(staging, destination);');
  const mounted = prepare.indexOf('mountStorage(project, identity, destination)');
  assert.ok(placed !== -1 && mounted > placed, 'mount comes after the release exists');
  assert.ok(mounted < prepare.indexOf("project.runtime === 'go'"), 'mount comes before runtime preparation');
  assert.ok(mounted < prepare.indexOf('prepareWorkerActivation('), 'workers get the mount too');
  assert.match(prepare, /if \(project\.storagePath\) await mountStorage\(project, identity, destination\);/);
  assert.equal(helperFunction('prepareDockerProjectRelease').includes('mountStorage'), false);
});

test('the installer copies project-storage.mjs next to the helper, and every helper import is installed', () => {
  assert.match(installerSource, /install -m 0750 -o root -g root "\$APP_ROOT\/scripts\/project-storage\.mjs" "\$HELPER_ROOT\/project-storage\.mjs"/);
  const imports = [...helperSource.matchAll(/from '\.\/([A-Za-z0-9._-]+\.mjs)'/g)].map((match) => match[1]);
  assert.ok(imports.includes('project-storage.mjs'));
  for (const name of imports) assert.ok(installerSource.includes(`"$APP_ROOT/scripts/${name}"`), `${name} is imported by the helper but the installer never copies it to the host`);
});

// The helper runs as root over a tree that holds code the Portal did not write. This module may only
// read metadata; every change must go through the callback that runs as the project user.
test('the storage module can only read the filesystem; all changes go through the project-user callback', () => {
  const fsImports = [...moduleSource.matchAll(/import \{([^}]*)\} from 'node:fs\/promises'/g)].map((match) => match[1].split(',').map((item) => item.trim()).sort().join(','));
  assert.deepEqual(fsImports, ['lstat,readlink']);
  assert.doesNotMatch(moduleSource.replace(/\/\/.*$/gm, ''), /\b(rm|rmdir|unlink|symlink|mkdir|writeFile|rename|chown|chmod|cp|copyFile|spawn|exec|execFile)\s*\(/);
  assert.doesNotMatch(moduleSource, /node:child_process/);
});

function fake({ existing = null, target = null } = {}) {
  const calls = [];
  return {
    calls,
    runAsProject: async (command, args) => { calls.push([command, ...args]); },
    inspect: async () => { if (!existing) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); return existing; },
    readLink: async () => target
  };
}
const kind = { directory: { isDirectory: () => true, isSymbolicLink: () => false }, file: { isDirectory: () => false, isSymbolicLink: () => false }, link: { isDirectory: () => false, isSymbolicLink: () => true } };
const identity = { root: '/srv/hostmgr/projects/app' };
const releaseRoot = '/srv/hostmgr/projects/app/releases/0b2c0a4e-0000-4000-8000-000000000001';
const storage = '/srv/hostmgr/projects/app/shared/storage';

test('mounting creates the persistent folder and a link, in that order, as the project user', async () => {
  const world = fake();
  assert.equal(storageDirectory(identity), storage);
  assert.equal(await mountProjectStorage({ identity, releaseRoot, storagePath: './public/uploads/', ...world }), true);
  assert.deepEqual(world.calls, [
    ['/usr/bin/mkdir', '-p', '-m', '0750', '--', storage],
    ['/usr/bin/mkdir', '-p', '--', `${releaseRoot}/public`],
    ['/usr/bin/ln', '-s', '--', storage, `${releaseRoot}/public/uploads`]
  ]);
});

test('mounting replaces a folder or a link the repository shipped, never a file', async () => {
  const folder = fake({ existing: kind.directory });
  await mountProjectStorage({ identity, releaseRoot, storagePath: 'uploads', ...folder });
  assert.deepEqual(folder.calls.map((call) => call.slice(0, 3).join(' ')), ['/usr/bin/mkdir -p -m', '/usr/bin/rm -rf --', '/usr/bin/mkdir -p --', '/usr/bin/ln -s --']);
  assert.deepEqual(folder.calls[1], ['/usr/bin/rm', '-rf', '--', `${releaseRoot}/uploads`]);

  const foreign = fake({ existing: kind.link, target: '/etc' });
  await mountProjectStorage({ identity, releaseRoot, storagePath: 'uploads', ...foreign });
  assert.deepEqual(foreign.calls[1], ['/usr/bin/rm', '-f', '--', `${releaseRoot}/uploads`]);
  assert.deepEqual(foreign.calls.at(-1), ['/usr/bin/ln', '-s', '--', storage, `${releaseRoot}/uploads`]);

  const file = fake({ existing: kind.file });
  await assert.rejects(mountProjectStorage({ identity, releaseRoot, storagePath: 'uploads', ...file }), /is a file in the release/);
  assert.equal(file.calls.some((call) => call[0].endsWith('/rm') || call[0].endsWith('/ln')), false);
});

test('mounting twice is a no-op, and no storage path means nothing is done', async () => {
  const mounted = fake({ existing: kind.link, target: storage });
  assert.equal(await mountProjectStorage({ identity, releaseRoot, storagePath: 'uploads', ...mounted }), false);
  assert.deepEqual(mounted.calls, [['/usr/bin/mkdir', '-p', '-m', '0750', '--', storage]]);
  for (const storagePath of [null, undefined, '']) {
    const none = fake();
    assert.equal(await mountProjectStorage({ identity, releaseRoot, storagePath, ...none }), false);
    assert.deepEqual(none.calls, []);
  }
  await assert.rejects(mountProjectStorage({ identity, releaseRoot, storagePath: '../out', ...fake() }), /storage path/i);
});

const execute = promisify(execFile);
async function releases(t, ...names) {
  const root = await mkdtemp(join(tmpdir(), 'hostmgr-storage-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = join(root, 'app');
  for (const name of names) await mkdir(join(project, 'releases', name), { recursive: true });
  return { root, project, identity: { root: project }, release: (name) => join(project, 'releases', name), runAsProject: (command, args) => execute(command, args) };
}

test('uploaded files survive a new release and the pruning of the old one', { skip: !linux }, async (t) => {
  const world = await releases(t, 'r1', 'r2');
  await mkdir(join(world.release('r1'), 'uploads'));
  await writeFile(join(world.release('r1'), 'uploads', 'shipped.txt'), 'from the repository');
  assert.equal(await mountProjectStorage({ identity: world.identity, releaseRoot: world.release('r1'), storagePath: 'uploads', runAsProject: world.runAsProject }), true);
  const stored = join(world.project, 'shared', 'storage');
  assert.equal((await lstat(join(world.release('r1'), 'uploads'))).isSymbolicLink(), true);
  assert.equal(await readlink(join(world.release('r1'), 'uploads')), stored);
  assert.deepEqual(await readdir(stored), [], 'the repository folder is hidden, as a volume would hide it');

  await writeFile(join(world.release('r1'), 'uploads', 'photo.jpg'), 'image bytes'); // the app writes through ./uploads
  assert.equal(await readFile(join(stored, 'photo.jpg'), 'utf8'), 'image bytes');

  await mountProjectStorage({ identity: world.identity, releaseRoot: world.release('r2'), storagePath: 'uploads', runAsProject: world.runAsProject });
  assert.equal(await readFile(join(world.release('r2'), 'uploads', 'photo.jpg'), 'utf8'), 'image bytes');

  await rm(world.release('r1'), { recursive: true, force: true }); // what pruneHistoricalReleases does
  assert.equal(await readFile(join(stored, 'photo.jpg'), 'utf8'), 'image bytes');
  assert.equal(await readFile(join(world.release('r2'), 'uploads', 'photo.jpg'), 'utf8'), 'image bytes');
});

test('a nested storage path creates its parent folders and can be applied again to an old release', { skip: !linux }, async (t) => {
  const world = await releases(t, 'r1');
  const options = { identity: world.identity, releaseRoot: world.release('r1'), storagePath: 'public/media', runAsProject: world.runAsProject };
  assert.equal(await mountProjectStorage(options), true);
  assert.equal(await readlink(join(world.release('r1'), 'public', 'media')), join(world.project, 'shared', 'storage'));
  assert.equal(await mountProjectStorage(options), false);
  assert.equal(await mountProjectStorage({ ...options, storagePath: 'files' }), true);
  assert.equal((await lstat(join(world.release('r1'), 'files'))).isSymbolicLink(), true);
});

test('a link planted by the repository is replaced and never followed', { skip: !linux }, async (t) => {
  const world = await releases(t, 'r1');
  const outside = join(world.root, 'outside');
  await mkdir(outside);
  await writeFile(join(outside, 'keep.txt'), 'untouched');
  await symlink(outside, join(world.release('r1'), 'uploads'));
  await mountProjectStorage({ identity: world.identity, releaseRoot: world.release('r1'), storagePath: 'uploads', runAsProject: world.runAsProject });
  assert.equal(await readlink(join(world.release('r1'), 'uploads')), join(world.project, 'shared', 'storage'));
  assert.deepEqual(await readdir(outside), ['keep.txt']);
  assert.equal(await readFile(join(outside, 'keep.txt'), 'utf8'), 'untouched');
});

test('a file named like the storage path stops the deployment and is left alone', { skip: !linux }, async (t) => {
  const world = await releases(t, 'r1');
  await writeFile(join(world.release('r1'), 'uploads'), 'a real file');
  await assert.rejects(mountProjectStorage({ identity: world.identity, releaseRoot: world.release('r1'), storagePath: 'uploads', runAsProject: world.runAsProject }), /is a file in the release/);
  assert.equal(await readFile(join(world.release('r1'), 'uploads'), 'utf8'), 'a real file');
});

test('sync API stores the storage path, keeps it when omitted, clears it when empty, refuses bad values', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'hostmgr-storage-api-'));
  const app = await createApplication({ dataPath: join(root, 'state.sqlite'), password: 'correct-horse-battery-staple', secretKey: Buffer.alloc(32, 7).toString('base64'), mode: 'demo', sandboxClone: false, metricsEnabled: false, portAvailability: async () => true });
  await app.store.update((state) => {
    state.tools.git.status = 'Installed';
    state.git.identity = { name: 'Test owner', email: 'owner@example.com' };
  });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  // StateStore owns a process-lifetime SQLite handle, as in the other API tests, so the folder stays.
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'owner@local.test', password: 'correct-horse-battery-staple' }) });
  const { csrfToken } = await login.json();
  const headers = { cookie: login.headers.get('set-cookie').split(';')[0], 'content-type': 'application/json', 'x-csrf-token': csrfToken };
  const project = { name: 'Images API', slug: 'images-api', repository: 'https://github.com/example/images.git', branch: 'main', port: 3811, runtime: 'node' };
  const sync = (body) => fetch(`${base}/api/projects/sync`, { method: 'POST', headers, body: JSON.stringify(body) });
  const stored = () => app.store.snapshot().projects.find((item) => item.slug === project.slug);

  assert.equal((await sync(project)).status, 200);
  assert.equal('storagePath' in stored(), false);

  const saved = await sync({ ...project, storagePath: './uploads/' });
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).project.storagePath, 'uploads');
  const listed = await (await fetch(`${base}/api/projects`, { headers })).json();
  assert.equal(listed.projects.find((item) => item.slug === project.slug).storagePath, 'uploads');

  assert.equal((await sync(project)).status, 200, 'a sync that does not mention storage (for example the CLI)');
  assert.equal(stored().storagePath, 'uploads');

  for (const storagePath of ['../outside', '/etc', '.env', 'node_modules']) {
    const refused = await sync({ ...project, storagePath });
    assert.equal(refused.status, 400, storagePath);
    assert.equal(stored().storagePath, 'uploads');
  }
  const compose = await sync({ ...project, runtime: 'docker-compose', composeFile: 'compose.yaml', composeService: 'web', storagePath: 'uploads' });
  assert.equal(compose.status, 400);
  assert.match((await compose.json()).error, /named volumes/);

  assert.equal((await sync({ ...project, storagePath: '' })).status, 200);
  assert.equal(stored().storagePath, null);
});
