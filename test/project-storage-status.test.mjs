import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { spawn } from 'node:child_process';
import { link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { randomUUID } from 'node:crypto';
import { hashPassword } from '../src/auth.mjs';
import { storageSummary } from '../public/ui/core/model.js';
import { addEntry, measureStorage, mountProjectStorage, parseSpace, storageStatus } from '../scripts/project-storage.mjs';
import { start, login, request } from './support/server.mjs';

const linux = process.platform === 'linux';
const helperSource = await readFile(new URL('../scripts/hostmgr-deploy-helper.mjs', import.meta.url), 'utf8');
const releaseScreen = await readFile(new URL('../public/ui/screens/release.js', import.meta.url), 'utf8');
const helperFunction = (name) => helperSource.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n\\}`))[0];

const identity = { root: '/srv/hostmgr/projects/app' };
const directory = '/srv/hostmgr/projects/app/shared/storage';
const release = '/srv/hostmgr/projects/app/releases/0b2c0a4e-0000-4000-8000-000000000001';
const kind = { directory: { isDirectory: () => true, isSymbolicLink: () => false }, link: { isDirectory: () => false, isSymbolicLink: () => true } };
const missing = () => Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
const DF = '        1B-blocks         Avail\n      53687091200   31457280000\n';

// Runners that answer like find and df and remember how they were called. The listing starts with the
// folder itself, as find does.
function measuring({ files = [48234496], others = ['d 4096', 'l 30'], space = DF, listing } = {}) {
  const calls = [];
  const lines = listing ?? ['d 4096', ...files.map((size) => `f ${size}`), ...others];
  return {
    calls,
    scanAsProject: async (command, args, onLine) => { calls.push([command, ...args]); for (const line of lines) onLine(line); },
    runAsProject: async (command, args) => { calls.push([command, ...args]); return space; }
  };
}

test('df output and find lines are read strictly: a number is a number, anything else is not', () => {
  assert.deepEqual(parseSpace(DF), { totalBytes: 53687091200, availableBytes: 31457280000 });
  assert.deepEqual(parseSpace('1B-blocks Avail\n10 4'), { totalBytes: 10, availableBytes: 4 });
  for (const bad of ['', '1B-blocks Avail', '1B-blocks Avail\n10', '1B-blocks Avail\n10 4 2', 'x\n10 -4', 'x\nten four', null]) assert.equal(parseSpace(bad), null, String(bad));

  const total = { entries: 0, bytes: 0 };
  for (const line of ['d 4096', 'f 1500', 'l 12', 'd 4096', 'f 2500', 'p 0', 's 0']) addEntry(total, line);
  assert.deepEqual(total, { entries: 7, bytes: 4000 }, 'only regular files add to the size');
  for (const bad of ['', 'f', 'f -1', 'f 1.5', 'ff 10', '1500 f', 'find: permission denied', 'f 10 extra']) assert.throws(() => addEntry({ entries: 0, bytes: 0 }, bad), /could not be read/, JSON.stringify(bad));
});

test('measuring lists the folder without following links or leaving the disk, and does not count the folder itself', async () => {
  const world = measuring({ files: [1500, 2500], others: ['d 4096', 'l 30'] });
  assert.deepEqual(await measureStorage({ directory, ...world }), { bytes: 4000, items: 4, totalBytes: 53687091200, availableBytes: 31457280000 });
  assert.deepEqual(world.calls, [
    ['/usr/bin/find', directory, '-xdev', '-printf', '%y %s\n'],
    ['/usr/bin/df', '--output=size,avail', '--block-size=1', '--', directory]
  ]);
  assert.deepEqual(await measureStorage({ directory, ...measuring({ listing: ['d 4096'] }) }), { bytes: 0, items: 0, totalBytes: 53687091200, availableBytes: 31457280000 }, 'an empty folder holds nothing, whatever size the file system gives a folder');
  for (const broken of [{ listing: [] }, { listing: ['d 1', 'oops'] }, { space: 'nonsense' }]) {
    await assert.rejects(measureStorage({ directory, ...measuring(broken) }), /could not be read/, JSON.stringify(broken));
  }
  await assert.rejects(measureStorage({ directory, ...measuring(), scanAsProject: async () => { throw new Error('timed out'); } }), /timed out/);
});

test('status: no storage path means nothing is inspected or run', async () => {
  const world = measuring();
  for (const storagePath of [null, undefined, '']) {
    assert.deepEqual(await storageStatus({ identity, storagePath, currentRelease: release, inspect: missing, readLink: missing, ...world }), { configured: false });
  }
  assert.deepEqual(world.calls, []);
});

test('status: before the first deployment the folder does not exist and nothing is counted', async () => {
  const world = measuring();
  const status = await storageStatus({ identity, storagePath: 'uploads', currentRelease: null, inspect: missing, readLink: missing, ...world });
  assert.deepEqual(status, { configured: true, path: 'uploads', directory, deployed: false, mounted: false, exists: false, measured: false, usage: null });
  assert.deepEqual(world.calls, []);
});

test('status: active when the live release links the path to the storage folder', async () => {
  const world = measuring();
  const seen = [];
  const inspect = async (path) => { seen.push(path); return path === directory ? kind.directory : kind.link; };
  const status = await storageStatus({ identity, storagePath: './public/uploads/', currentRelease: release, inspect, readLink: async () => directory, ...world });
  assert.equal(status.mounted, true);
  assert.equal(status.deployed, true);
  assert.equal(status.exists, true);
  assert.equal(status.measured, true);
  assert.deepEqual(status.usage, { bytes: 48234496, items: 3, totalBytes: 53687091200, availableBytes: 31457280000 });
  assert.equal(status.path, 'public/uploads');
  assert.ok(seen.includes(`${release}/public/uploads`), 'looks at the link inside the live release');
});

test('status: pending when the live release has no link, a real folder, or a link somewhere else', async () => {
  for (const [entry, target] of [[null, null], [kind.directory, null], [kind.link, '/etc'], [kind.link, `${directory}/../other`]]) {
    const inspect = async (path) => { if (path === directory) return kind.directory; if (entry) return entry; return missing(); };
    const status = await storageStatus({ identity, storagePath: 'uploads', currentRelease: release, inspect, readLink: async () => target, ...measuring() });
    assert.equal(status.mounted, false, JSON.stringify([!!entry, target]));
    assert.equal(status.deployed, true);
    assert.equal(status.exists, true);
  }
});

test('status: a folder that cannot be counted is reported as such, not as an error', async () => {
  const inspect = async (path) => (path === directory ? kind.directory : missing());
  const status = await storageStatus({ identity, storagePath: 'uploads', currentRelease: release, inspect, readLink: missing, scanAsProject: async () => { throw new Error('timed out'); }, runAsProject: async () => DF });
  assert.deepEqual({ exists: status.exists, measured: status.measured, usage: status.usage }, { exists: true, measured: false, usage: null });
  const notAFolder = await storageStatus({ identity, storagePath: 'uploads', currentRelease: release, inspect: async () => kind.link, readLink: missing, ...measuring() });
  assert.equal(notAFolder.exists, false, 'a link where the folder should be is not counted');
});

test('helper counts as the project user with a deadline, looks the user up once, and returns only the storage status', async () => {
  const calls = [];
  const streamed = [];
  const states = [];
  const identityOf = (slug) => ({ user: `hostmgr-${slug}`, root: `/srv/hostmgr/projects/${slug}`, current: `/srv/hostmgr/projects/${slug}/current`, gid: null });
  const status = runInNewContext(`(${helperFunction('projectStorageStatus')})`, {
    STORAGE_MEASURE_TIMEOUT_MS: 20_000,
    loadProject: async () => ({ slug: 'app', storagePath: 'uploads' }),
    projectIdentity: identityOf,
    readlink: async () => release,
    storageStatus: async ({ identity: owner, storagePath, currentRelease, scanAsProject, runAsProject }) => {
      states.push({ storagePath, currentRelease });
      await scanAsProject('/usr/bin/find', [owner.root], () => {});
      await runAsProject('/usr/bin/df', [owner.root]);
      await scanAsProject('/usr/bin/find', [owner.root], () => {});
      return { configured: true, path: storagePath };
    },
    streamLines: async (command, args, options) => { streamed.push({ command, args, options }); },
    run: async (command, args, options) => { calls.push({ command, args, options }); return command.endsWith('/id') ? (args[0] === '-g' ? '990' : '991') : DF; }
  });
  assert.deepEqual(JSON.parse(JSON.stringify(await status('app'))), { storage: { configured: true, path: 'uploads' } });
  assert.deepEqual(states, [{ storagePath: 'uploads', currentRelease: release }]);
  assert.deepEqual(calls.filter((call) => call.command.endsWith('/id')).map((call) => [...call.args]), [['-g', 'hostmgr-app'], ['-u', 'hostmgr-app']], 'looked up once, not per command');
  const asOwner = { cwd: '/srv/hostmgr/projects/app', uid: 991, gid: 990, timeout: 20_000, failure: 'The project storage could not be measured.' };
  const counted = calls.filter((call) => !call.command.endsWith('/id'));
  assert.deepEqual(counted.map((call) => call.command), ['/usr/bin/df']);
  assert.equal(streamed.length, 2);
  for (const { options } of [...counted, ...streamed]) assert.deepEqual({ ...options }, asOwner);
  assert.match(helperSource, /request\.operation === 'project-storage-status'\) return projectStorageStatus\(request\.slug\);/);
  assert.match(helperSource, /const STORAGE_MEASURE_TIMEOUT_MS = 20_000;/);
});

test('helper never lets root list or measure the folder itself', () => {
  const body = helperFunction('projectStorageStatus');
  assert.equal(/\brun\('\/usr\/bin\/(du|df|find|ls|stat)'/.test(body), false, 'find and df only run through the project-user callbacks');
  assert.equal(/\b(readdir|opendir|stat)\(/.test(body), false);
  assert.match(body, /runAsProject = async \(command, commandArguments\) => run\(command, commandArguments, await asProject\(\)\)/);
  assert.match(body, /scanAsProject = async \(command, commandArguments, onLine\) => streamLines\(command, commandArguments, await asProject\(\), onLine\)/);
  assert.match(body, /uid: identity\.uid, gid: identity\.gid/);
});

// The helper's line streamer, run for real: lines that straddle chunk boundaries, failures, a callback that
// gives up, and the deadline.
class StreamError extends Error {}
const stream = runInNewContext(`(${helperFunction('streamLines')})`, { spawn, HelperError: StreamError });
const GENERATE = ['-e',"let out='';for(let i=1;i<=60000;i++){out+=i+'\\n'}process.stdout.write(out)"];

test('streaming hands over every line exactly once, whatever the chunking', { skip: !linux }, async () => {
  let lines = 0;
  let sum = 0;
  await stream(process.execPath, GENERATE, {}, (line) => { lines++; sum += Number(line); });
  assert.deepEqual({ lines, sum }, { lines: 60000, sum: (60000 * 60001) / 2 });
});

test('streaming fails on a non-zero exit, a missing command, a callback that refuses a line, and the deadline', { skip: !linux }, async () => {
  await assert.rejects(stream('/usr/bin/false', [], { failure: 'nope' }, () => {}), (error) => error instanceof StreamError && error.message === 'nope');
  await assert.rejects(stream('/usr/bin/does-not-exist', [], { failure: 'gone' }, () => {}), (error) => error instanceof StreamError && error.message === 'gone');
  let seen = 0;
  const started = Date.now();
  await assert.rejects(stream('/usr/bin/yes', [], { failure: 'bad line' }, () => { if (++seen === 3) throw new Error('refuse'); }), (error) => error instanceof StreamError && error.message === 'bad line');
  assert.ok(Date.now() - started < 5000, 'the endless command was stopped, not waited for');
  await assert.rejects(stream('/usr/bin/sleep', ['5'], { failure: 'slow', timeout: 100 }, () => {}), (error) => error instanceof StreamError && error.message === 'slow');
});

test('streaming never reports success for a listing it could not fully read', { skip: !linux }, async () => {
  // The last line has no newline: it was cut short, so counting what came before would silently undercount.
  const lines = [];
  await assert.rejects(stream('/usr/bin/printf', ['f 1\\nf 2'], { failure: 'cut short' }, (line) => lines.push(line)), (error) => error instanceof StreamError && error.message === 'cut short');
  assert.deepEqual(lines, ['f 1']);
  // The command finished cleanly but the callback refused a line: still a failure.
  // (One short line, so nothing is left over to give it away: only the refusal does.)
  for (const attempt of [1, 2, 3]) await assert.rejects(stream('/usr/bin/printf', ['f 1\\n'], { failure: 'refused' }, () => { throw new Error('refuse'); }), (error) => error instanceof StreamError && error.message === 'refused', `attempt ${attempt}`);
  // spawn itself can throw (for example an invalid uid); that must settle, not hang.
  await assert.rejects(stream('/usr/bin/true', [], { uid: 'not-a-number', failure: 'cannot start' }, () => {}), (error) => error instanceof StreamError && error.message === 'cannot start');
});

// The commands run for real, as a plain user, against a folder like the one an application fills.
const execute = promisify(execFile);
async function world(t) {
  const root = await mkdtemp(join(tmpdir(), 'hostmgr-storage-status-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = join(root, 'app');
  const releaseRoot = join(project, 'releases', 'r1');
  await mkdir(releaseRoot, { recursive: true });
  const scan = (command, args, onLine) => stream(command, args, {}, onLine);
  return { root, project, releaseRoot, identity: { root: project }, scanAsProject: scan, runAsProject: async (command, args) => (await execute(command, args)).stdout };
}

test('real folder: bytes and items are counted, a link out of the folder is never followed', { skip: !linux }, async (t) => {
  const w = await world(t);
  const options = { identity: w.identity, releaseRoot: w.releaseRoot, storagePath: 'uploads', scanAsProject: w.scanAsProject, runAsProject: w.runAsProject };
  await mountProjectStorage(options);
  const stored = join(w.project, 'shared', 'storage');
  const empty = await storageStatus({ ...options, currentRelease: w.releaseRoot });
  assert.deepEqual({ mounted: empty.mounted, exists: empty.exists, measured: empty.measured, bytes: empty.usage?.bytes, items: empty.usage?.items }, { mounted: true, exists: true, measured: true, bytes: 0, items: 0 }, 'an empty folder is empty, whatever size the file system gives a folder');

  await writeFile(join(w.releaseRoot, 'uploads', 'photo.jpg'), Buffer.alloc(1500)); // the application writes through ./uploads
  await mkdir(join(stored, 'albums', '2026'), { recursive: true });
  await writeFile(join(stored, 'albums', '2026', 'a.txt'), Buffer.alloc(2500));
  await link(join(stored, 'albums', '2026', 'a.txt'), join(stored, 'albums', 'same-file.txt'));
  const outside = join(w.root, 'outside.bin');
  await writeFile(outside, Buffer.alloc(5_000_000)); // far bigger than everything else
  await symlink(outside, join(stored, 'huge-link'));

  const status = await storageStatus({ ...options, currentRelease: w.releaseRoot });
  assert.equal(status.measured, true);
  // Regular files only: photo.jpg 1500 + a.txt 2500 + its hard link, which is listed under its own name, 2500.
  // The 5 MB file behind huge-link and the size of the folders themselves are not counted.
  assert.equal(status.usage.bytes, 6500);
  // photo.jpg, albums, 2026, a.txt, same-file.txt and huge-link; not the storage folder itself.
  assert.equal(status.usage.items, 6);
  assert.ok(status.usage.totalBytes > 0 && status.usage.availableBytes > 0 && status.usage.availableBytes <= status.usage.totalBytes);
});

test('real folder: before the next deployment the status says pending, and a missing folder is not counted', { skip: !linux }, async (t) => {
  const w = await world(t);
  const options = { identity: w.identity, storagePath: 'uploads', scanAsProject: w.scanAsProject, runAsProject: w.runAsProject };
  const fresh = await storageStatus({ ...options, currentRelease: null });
  assert.deepEqual({ deployed: fresh.deployed, mounted: fresh.mounted, exists: fresh.exists, measured: fresh.measured }, { deployed: false, mounted: false, exists: false, measured: false });

  await mkdir(join(w.project, 'shared', 'storage'), { recursive: true });
  const notLinked = await storageStatus({ ...options, currentRelease: w.releaseRoot });
  assert.deepEqual({ deployed: notLinked.deployed, mounted: notLinked.mounted, exists: notLinked.exists, measured: notLinked.measured }, { deployed: true, mounted: false, exists: true, measured: true });

  await mountProjectStorage({ ...options, releaseRoot: w.releaseRoot });
  assert.equal((await storageStatus({ ...options, currentRelease: w.releaseRoot })).mounted, true);
});

// ---------------------------------------------------------------------------------------------
// The Portal API.

const PASSWORD = 'Testing-Password-739!';
const SOCKET = '/fixture-storage-helper.sock';
const usage = { bytes: 1234, items: 7, totalBytes: 1_000_000, availableBytes: 400_000 };

async function portal(t, helper, permissions = [], projectExtra = {}) {
  const previous = process.env.HOSTMGR_DEPLOY_HELPER_SOCKET;
  process.env.HOSTMGR_DEPLOY_HELPER_SOCKET = SOCKET;
  t.after(() => { if (previous === undefined) delete process.env.HOSTMGR_DEPLOY_HELPER_SOCKET; else process.env.HOSTMGR_DEPLOY_HELPER_SOCKET = previous; });
  const { app, base } = await start({ projectStorageHelper: helper });
  t.after(() => app.close());
  const userId = randomUUID();
  const organizationId = randomUUID();
  const otherOrganizationId = randomUUID();
  await app.store.update((state) => {
    state.organizations.push({ id: organizationId, name: 'Alpha' }, { id: otherOrganizationId, name: 'Bravo' });
    state.users.push({ id: userId, email: 'member@example.test', password: hashPassword(PASSWORD), role: 'user', status: 'active', authVersion: 1 });
    if (permissions.length) state.memberships.push({ userId, organizationId, permissions: [...permissions] });
    for (const [slug, org, extra] of [['alpha', organizationId, projectExtra], ['plain', organizationId, {}], ['bravo', otherOrganizationId, { storagePath: 'files' }]]) {
      state.projects.push({ name: slug, slug, organizationId: org, organization: slug, repository: 'https://example.test/app.git', branch: 'main', directory: '/', port: 3000 + state.projects.length, runtime: 'node', environment: { keys: [] }, deployment: { state: 'idle', releases: [] }, ...extra });
    }
  });
  return { app, base, master: await login(base), member: await login(base, 'member@example.test', PASSWORD) };
}

const hostStatus = (storage) => async (socket, message) => {
  assert.equal(socket, SOCKET);
  assert.equal(message.operation, 'project-storage-status');
  return { ok: true, storage };
};

test('API: a project without storage answers without asking the host', async (t) => {
  let asked = 0;
  const { base, master } = await portal(t, async () => { asked++; return { ok: true, storage: {} }; });
  const result = await request(base, '/api/projects/plain/storage', master);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { configured: false, path: null, directory: null, state: 'none', available: true, simulated: false });
  assert.equal(asked, 0);
});

test('API: reports the folder, whether the live release uses it, and the usage', async (t) => {
  const { base, master } = await portal(t, hostStatus({ configured: true, deployed: true, mounted: true, exists: true, measured: true, usage }), [], { storagePath: 'uploads' });
  const result = await request(base, '/api/projects/alpha/storage', master);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { configured: true, path: 'uploads', directory: '/srv/hostmgr/projects/alpha/shared/storage', state: 'active', deployed: true, exists: true, measured: true, usage, available: true, simulated: false });
});

test('API: a storage path that the live release does not link yet is pending', async (t) => {
  const { base, master } = await portal(t, hostStatus({ configured: true, deployed: true, mounted: false, exists: false, measured: false, usage: null }), [], { storagePath: 'uploads' });
  const body = (await request(base, '/api/projects/alpha/storage', master)).body;
  assert.deepEqual({ state: body.state, deployed: body.deployed, exists: body.exists, measured: body.measured, usage: body.usage }, { state: 'pending', deployed: true, exists: false, measured: false, usage: null });
});

test('API: whatever else the helper sends does not reach the browser, and bad numbers are dropped', async (t) => {
  const hostile = { configured: true, deployed: true, mounted: true, exists: true, measured: true, secret: 'root-only', directory: '/etc', path: '/etc', usage: { bytes: -1, items: '7', totalBytes: 1.5, availableBytes: 1, extra: 'x' } };
  const { base, master } = await portal(t, hostStatus(hostile), [], { storagePath: 'uploads' });
  const result = await request(base, '/api/projects/alpha/storage', master);
  assert.equal(JSON.stringify(result.body).includes('root-only'), false);
  assert.equal(result.body.directory, '/srv/hostmgr/projects/alpha/shared/storage', 'the path comes from the Portal, not the helper');
  assert.equal(result.body.path, 'uploads');
  assert.deepEqual({ measured: result.body.measured, usage: result.body.usage }, { measured: false, usage: null });
});

test('API: one count answers simultaneous and repeated reads for a few seconds, and a failure is retried at once', async (t) => {
  let asked = 0;
  let fail = true;
  const { base, master } = await portal(t, async () => {
    asked++;
    await new Promise((resolve) => setTimeout(resolve, 30));
    return fail ? { ok: false, error: 'Host helper operation failed.' } : { ok: true, storage: { configured: true, deployed: true, mounted: true, exists: true, measured: true, usage } };
  }, [], { storagePath: 'uploads' });
  const failed = await request(base, '/api/projects/alpha/storage', master);
  assert.equal(failed.status, 200);
  assert.deepEqual({ available: failed.body.available, state: failed.body.state, path: failed.body.path }, { available: false, state: 'unknown', path: 'uploads' });
  assert.match(failed.body.notice, /storage/);
  assert.equal(asked, 1);

  fail = false;
  const together = await Promise.all([1, 2, 3].map(() => request(base, '/api/projects/alpha/storage', master)));
  assert.equal(asked, 2, 'the failure was not kept, and three simultaneous reads made one count');
  for (const result of together) assert.equal(result.body.measured, true);
  assert.equal((await request(base, '/api/projects/alpha/storage', master)).body.measured, true);
  assert.equal(asked, 2, 'repeated within the window: no new count');
});

test('API: a slow count stays shared and the cache window starts when it completes', async (t) => {
  let markStarted;
  let finish;
  const started = new Promise((resolve) => { markStarted = resolve; });
  const complete = new Promise((resolve) => { finish = resolve; });
  let asked = 0;
  const { base, master } = await portal(t, async () => {
    asked++;
    markStarted();
    await complete;
    return { ok: true, storage: { configured: true, deployed: true, mounted: true, exists: true, measured: true, usage } };
  }, [], { storagePath: 'uploads' });
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const status = () => request(base, '/api/projects/alpha/storage', master);
  const first = status();
  await started;
  t.mock.timers.tick(5_001);
  const second = status();
  await new Promise((resolve) => setTimeout(resolve, 50));
  finish();
  for (const result of await Promise.all([first, second, status()])) assert.equal(result.body.measured, true);
  assert.equal(asked, 1);

  t.mock.timers.tick(5_001);
  assert.equal((await status()).body.measured, true);
  assert.equal(asked, 2);
});

test('API: a failed helper answer is unavailable even when it carries a status', async (t) => {
  const { base, master } = await portal(t, async () => ({ ok: false, error: 'Host helper operation failed.', storage: { configured: true, deployed: true, mounted: true, exists: true, measured: true, usage } }), [], { storagePath: 'uploads' });
  const body = (await request(base, '/api/projects/alpha/storage', master)).body;
  assert.deepEqual({ available: body.available, state: body.state, measured: body.measured }, { available: false, state: 'unknown', measured: undefined });
});

test('API: on a host without a connected helper the status is unavailable, not simulated', async (t) => {
  const previous = process.env.HOSTMGR_DEPLOY_HELPER_SOCKET;
  delete process.env.HOSTMGR_DEPLOY_HELPER_SOCKET;
  t.after(() => { if (previous !== undefined) process.env.HOSTMGR_DEPLOY_HELPER_SOCKET = previous; });
  const { app, base } = await start({ mode: 'host', autoSyncPollingEnabled: false, projectRuntimeProbe: async () => ({ state: 'active' }) });
  t.after(() => app.close());
  await app.store.update((state) => {
    const org = state.organizations[0];
    state.projects.push({ name: 'live', slug: 'live', organizationId: org.id, organization: org.name, repository: 'https://example.test/app.git', branch: 'main', directory: '/', port: 3400, runtime: 'node', storagePath: 'uploads', environment: { keys: [] }, deployment: { state: 'idle', activeReleaseId: 'r1', releases: [] } });
  });
  const body = (await request(base, '/api/projects/live/storage', await login(base))).body;
  assert.deepEqual({ simulated: body.simulated, available: body.available, state: body.state, path: body.path }, { simulated: false, available: false, state: 'unknown', path: 'uploads' });
  assert.match(body.notice, /deployment helper/);
  assert.equal('usage' in body, false);
});

test('API: a helper that throws gives a readable answer, not a server error', async (t) => {
  const { base, master } = await portal(t, async () => { throw new Error('connect ENOENT /run/secret.sock'); }, [], { storagePath: 'uploads' });
  const result = await request(base, '/api/projects/alpha/storage', master);
  assert.equal(result.status, 200);
  assert.equal(result.body.available, false);
  assert.equal(JSON.stringify(result.body).includes('secret.sock'), false);
});

test('API: access follows the project, and anonymous callers see nothing', async (t) => {
  let asked = 0;
  const { base, member, master } = await portal(t, async () => { asked++; return { ok: true, storage: { configured: true, deployed: true, mounted: true, exists: true, measured: true, usage } }; }, ['project.view'], { storagePath: 'uploads' });
  assert.equal((await request(base, '/api/projects/alpha/storage')).status, 401);
  assert.equal((await request(base, '/api/projects/alpha/storage', member)).status, 200, 'project.view is enough to see where storage is and how full');
  assert.equal((await request(base, '/api/projects/bravo/storage', member)).status, 404, 'another organization stays hidden');
  assert.equal((await request(base, '/api/projects/missing/storage', master)).status, 404);
  assert.equal(asked, 1);
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
    const attempt = await request(base, '/api/projects/alpha/storage', member, method, {});
    assert.ok(attempt.status >= 400 && attempt.status < 500, `${method} is not a storage operation (${attempt.status})`);
  }
});

test('API: a member with no grant in the organization cannot read the status', async (t) => {
  const { base, member } = await portal(t, hostStatus({}), [], { storagePath: 'uploads' });
  assert.equal((await request(base, '/api/projects/alpha/storage', member)).status, 404);
});

test('API: sandbox mode shows a simulated status, with sample numbers only in the UI demo', async (t) => {
  const previous = process.env.HOSTMGR_DEPLOY_HELPER_SOCKET;
  delete process.env.HOSTMGR_DEPLOY_HELPER_SOCKET;
  t.after(() => { if (previous !== undefined) process.env.HOSTMGR_DEPLOY_HELPER_SOCKET = previous; });
  const { app, base } = await start();
  t.after(() => app.close());
  await app.store.update((state) => {
    const org = state.organizations[0];
    for (const [slug, active] of [['live', true], ['fresh', false]]) state.projects.push({ name: slug, slug, organizationId: org.id, organization: org.name, repository: 'https://example.test/app.git', branch: 'main', directory: '/', port: 3300 + state.projects.length, runtime: 'node', storagePath: 'uploads', environment: { keys: [] }, deployment: { state: 'idle', activeReleaseId: active ? 'r1' : null, releases: [] } });
  });
  const owner = await login(base);
  const live = (await request(base, '/api/projects/live/storage', owner)).body;
  assert.deepEqual({ simulated: live.simulated, state: live.state, available: live.available, measured: live.measured }, { simulated: true, state: 'active', available: true, measured: true });
  const fresh = (await request(base, '/api/projects/fresh/storage', owner)).body;
  assert.deepEqual({ simulated: fresh.simulated, state: fresh.state, exists: fresh.exists, usage: fresh.usage }, { simulated: true, state: 'pending', exists: false, usage: null });
});

// ---------------------------------------------------------------------------------------------
// The Storage tab.

test('the tab says what the state means, in words the owner can act on', () => {
  const base = { configured: true, path: 'uploads', directory, available: true, simulated: false };
  assert.deepEqual(storageSummary({ configured: false }), { configured: false });
  assert.deepEqual(storageSummary(undefined), { configured: false });

  const active = storageSummary({ ...base, state: 'active', deployed: true, exists: true, usage: { bytes: 48234496, items: 312, totalBytes: 53687091200, availableBytes: 31457280000 } });
  assert.deepEqual({ tone: active.tone, label: active.label, uncounted: active.uncounted, simulated: active.simulated }, { tone: 'success', label: 'ใช้งานอยู่', uncounted: false, simulated: false });
  assert.match(active.meaning, /ไฟล์ไม่หายเมื่อ deploy, rollback หรือ restart/);
  assert.deepEqual(active.rows.map(([key]) => key), ['Mount path', 'โฟลเดอร์บนโฮสต์', 'ขนาดที่ใช้', 'จำนวนรายการ', 'พื้นที่ดิสก์ที่เหลือ']);
  assert.deepEqual(active.rows.map(([, , mono]) => Boolean(mono)), [true, true, false, false, false]);
  assert.equal(active.rows[0][1], 'uploads');
  assert.equal(active.rows[2][1], '46.0 MB');
  assert.match(active.rows[3][1], /^312 /);
  assert.equal(active.rows[4][1], '29.3 GB จาก 50.0 GB');

  const waiting = storageSummary({ ...base, state: 'pending', deployed: true, exists: false, usage: null });
  assert.deepEqual({ tone: waiting.tone, label: waiting.label }, { tone: 'pending', label: 'รอ deploy ถัดไป' });
  assert.match(waiting.meaning, /จะมีผลเมื่อ deploy ครั้งถัดไป/);
  assert.deepEqual(waiting.rows.slice(2).map(([, value]) => value), ['—', '—', '—']);
  assert.equal(waiting.uncounted, false, 'a folder that does not exist yet is not a failed count');

  const first = storageSummary({ ...base, state: 'pending', deployed: false, exists: false, usage: null });
  assert.match(first.meaning, /ยังไม่มี release.*deploy ครั้งแรก/);

  const failed = storageSummary({ ...base, state: 'active', deployed: true, exists: true, usage: null });
  assert.equal(failed.uncounted, true, 'the folder is there but counting failed');

  const down = storageSummary({ ...base, state: 'unknown', available: false, notice: 'อ่านสถานะ storage จาก host ไม่สำเร็จ' });
  assert.deepEqual({ tone: down.tone, label: down.label, meaning: down.meaning, uncounted: down.uncounted }, { tone: 'danger', label: 'อ่านสถานะไม่ได้', meaning: 'อ่านสถานะ storage จาก host ไม่สำเร็จ', uncounted: false });

  assert.equal(storageSummary({ ...base, state: 'active', deployed: true, exists: true, usage: null, simulated: true }).simulated, true);
});

test('the application sheet shows a Storage tab for projects that can have storage, and links to where it is set', () => {
  assert.match(releaseScreen, /"storage",\s*"Storage",\s*ctx\.can\("project\.view", project\) && project\.runtime !== "docker-compose"/);
  assert.match(releaseScreen, /if \(id === "storage"\) await storagePane\(ctx, project, body\);/);
  assert.match(releaseScreen, /\/projects\/\$\{encodeURIComponent\(p\.slug\)\}\/edit\/repository/);
  assert.match(releaseScreen, /ctx\.can\("project\.configure", p\)/);
  assert.match(releaseScreen, /pathFor\(p\) \+ "\/storage"/);
});
