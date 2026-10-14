import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, stat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runInNewContext } from 'node:vm';
import { validateProjectSync, SecretVault, InputError } from '../src/core.mjs';
import { validateNativeProject, createRelease, renderSystemdUnit, validatePackageScripts } from '../src/native-project.mjs';
import { resolveProjectPort, healthCheckCandidate, preparePythonRelease, copyCandidateSource } from '../src/server.mjs';
import { pythonStartArgs } from '../scripts/python-project.mjs';
import { start, login, request } from './support/server.mjs';

const input = { name: 'Worker', slug: 'queue-worker', repository: 'https://example.test/worker.git', serviceType: 'worker', port: null, runtime: 'node', buildScript: 'build', startScript: 'start' };

test('worker contracts reserve no port, require process health and reject HTTP-only runtimes', async () => {
  const worker = validateProjectSync(input);
  assert.equal(worker.port, null);
  assert.equal(worker.autoPort, false);
  assert.equal(worker.healthCheckEnabled, false);
  assert.deepEqual(worker.domains.hosts, []);
  assert.equal(await resolveProjectPort(worker, null, [], () => { throw new Error('Worker must not probe/reserve ports'); }), null);
  const native = validateNativeProject(worker);
  assert.equal(native.candidatePort, null);
  assert.doesNotMatch(renderSystemdUnit(native), /Environment=PORT=/);
  const release = createRelease(native);
  assert.equal(release.serviceType, 'worker');
  assert.equal(release.health.kind, 'process');
  assert.equal(release.health.enabled, true);
  assert.equal(release.health.status, 'pending');
  assert.equal(release.health.port, null);
  await assert.rejects(healthCheckCandidate('/not-executed', native, {}, null), /must not be started/);
  for (const runtime of ['php', 'docker-compose']) assert.throws(() => validateProjectSync({ ...input, runtime }), InputError);
  assert.throws(() => validateProjectSync({ ...input, runtime: 'python', pythonMode: 'asgi' }), /script run type/);
  assert.throws(() => validateProjectSync({ ...input, port: 3000 }), /HTTP port/);
  assert.throws(() => validateProjectSync({ ...input, domains: ['worker.example.test'] }), /HTTP domains/);
  assert.deepEqual(pythonStartArgs({ serviceType: 'worker', pythonMode: 'script', pythonEntry: 'main.py' }, null), ['-E', '-s', '-u', 'main.py']);
  assert.deepEqual(validateProjectSync({ ...input, serviceType: 'web', domains: [] }).domains.hosts, []);
});

test('Node and Bun worker candidate preparation builds without executing start or HTTP preflight', async t => {
  const root = await mkdtemp(join(tmpdir(), 'portal-worker-prep-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const module = await readFile(new URL('../src/server.mjs', import.meta.url), 'utf8');
  const functionSource = module.match(/async function prepareNativeRelease\([^]*?\n\}/)[0];
  const vault = new SecretVault(Buffer.alloc(32, 7).toString('base64'));
  for (const runtime of ['node', 'bun']) {
    const project = validateNativeProject({ ...input, slug: `worker-${runtime}`, runtime });
    const source = join(root, project.slug, 'repository');
    await mkdir(source, { recursive: true });
    await writeFile(join(source, 'package.json'), JSON.stringify({ scripts: { build: `${runtime} build.mjs`, start: `${runtime} consumer.mjs` } }));
    let healthChecks = 0; const runtimeCalls = [];
    const prepare = runInNewContext(`${functionSource}; prepareNativeRelease`, {
      repositoryDirectory: () => source, join, stat, readFile, mkdir, writeFile, rm, InputError,
      validatePackageScripts, hasRuntimeLockfile: async () => true, copyCandidateSource,
      installCandidateDependencies: async () => {},
      readNodePackageManager: async () => ({ name: 'npm' }),
      generateCandidatePrisma: async () => {},
      nodeRuntimeEnvironment: () => ({}),
      runCandidateRuntime: async (_project, args) => { runtimeCalls.push(args); },
      healthCheckCandidate: async () => { healthChecks++; }, runtimeLabel: () => runtime
    });
    const release = createRelease(project);
    await prepare(project, release, { environment: { encryptedContent: vault.encrypt('QUEUE=synthetic\nPORT=user-selected\n') } }, vault, root);
    assert.deepEqual(runtimeCalls.map(args => Array.from(args)), [['--version'], ['run', 'build']]);
    assert.equal(healthChecks, 0);
    const env = await readFile(join(root, project.slug, 'releases', release.id, '.env'), 'utf8');
    assert.equal(env, 'QUEUE=synthetic\nPORT=user-selected\n');
    assert.doesNotMatch(env, /PORT=null|HOST=127/);
    const emptyRelease = createRelease(project);
    await prepare(project, emptyRelease, { environment: { keys: [] } }, null, root);
    assert.equal(await readFile(join(root, project.slug, 'releases', emptyRelease.id, '.env'), 'utf8'), '');
    assert.equal(healthChecks, 0);
  }
});

test('Python worker source preparation preserves user ENV and injects no HTTP address', async t => {
  const root = await mkdtemp(join(tmpdir(), 'portal-python-worker-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = { ...input, runtime: 'python', pythonMode: 'script', pythonEntry: 'consumer.py', pythonInstall: 'none' };
  const source = join(root, project.slug, 'repository'); await mkdir(source, { recursive: true });
  await writeFile(join(source, 'consumer.py'), 'raise Exception("must not execute during preparation")');
  const release = createRelease(project); const vault = new SecretVault(Buffer.alloc(32, 9).toString('base64'));
  await preparePythonRelease(project, release, { environment: { encryptedContent: vault.encrypt('QUEUE=synthetic\nPORT=explicit-value\n') } }, vault, root);
  const env = await readFile(join(root, project.slug, 'releases', release.id, '.env'), 'utf8');
  assert.match(env, /PORT=explicit-value/); assert.doesNotMatch(env, /PORT=null|HOST=127/);
});

test('worker API persists purpose and refuses type changes once a release exists', async t => {
  const { app, base } = await start(); t.after(() => app.close());
  const headers = await login(base);
  await request(base, '/api/tools/git/install', headers, 'POST', { confirm: true });
  await request(base, '/api/git-config', headers, 'POST', { name: 'Fixture owner', email: 'owner@example.test' });
  const synced = await request(base, '/api/projects/sync', headers, 'POST', input);
  assert.equal(synced.status, 200, JSON.stringify(synced.body));
  assert.equal(synced.body.project.serviceType, 'worker');
  assert.equal(synced.body.project.port, null);
  assert.deepEqual(synced.body.project.domains.hosts, []);
  assert.equal((await request(base, '/api/projects/queue-worker/domains', headers, 'POST', { domains: ['worker.example.test'] })).status, 400);
  await app.store.update(state => { state.projects[0].deployment.releases = [{ id: '11111111-1111-4111-8111-111111111111', status: 'failed', serviceType: 'worker' }]; });
  const changed = await request(base, '/api/projects/sync', headers, 'POST', { ...input, serviceType: 'web' });
  assert.equal(changed.status, 400); assert.match(changed.body.error, /cannot change/);
  const runtimeChanged = await request(base, '/api/projects/sync', headers, 'POST', { ...input, runtime: 'bun' });
  assert.equal(runtimeChanged.status, 400); assert.match(runtimeChanged.body.error, /runtime cannot change/);
  assert.equal(app.store.snapshot().projects[0].serviceType, 'worker');
});
