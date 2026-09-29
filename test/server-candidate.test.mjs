import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { candidateRuntimeEnvironment, copyCandidateSource, healthCheckCandidate, installCandidateDependencies, redactBuildOutput, resolveProjectPort } from '../src/server.mjs';

import { start } from './support/server.mjs';

test('candidate source copy works on Node 24 and excludes repository internals', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'hostmgr-candidate-copy-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const source = join(dir, 'source');
  const destination = join(dir, 'candidate');
  await mkdir(join(source, 'node_modules'), { recursive: true });
  await mkdir(join(source, '.git'), { recursive: true });
  await writeFile(join(source, 'package.json'), '{"name":"candidate"}');
  await writeFile(join(source, 'node_modules', 'ignored.js'), 'ignored');
  await writeFile(join(source, '.git', 'HEAD'), 'ref: refs/heads/main');

  await copyCandidateSource(source, destination);

  assert.equal((await readFile(join(destination, 'package.json'), 'utf8')).includes('candidate'), true);
  await assert.rejects(access(join(destination, 'node_modules')));
  await assert.rejects(access(join(destination, '.git')));
});

test('candidate dependency install uses npm install only when a lockfile is absent or unusable', async () => {
  const calls = [];
  const events = [];
  const reportPhase = async (...event) => events.push(event);
  const runner = async (args) => { calls.push(args); };

  assert.equal(await installCandidateDependencies({ hasLockfile: false, runNpm: runner, options: {}, reportPhase }), 'unlocked');
  assert.deepEqual(calls, [['install']]);
  assert.match(events.at(-1)[2], /synced Git checkout was not changed/);

  calls.length = 0;
  events.length = 0;
  assert.equal(await installCandidateDependencies({ hasLockfile: true, runNpm: runner, options: {}, reportPhase }), 'locked');
  assert.deepEqual(calls, [['ci']]);

  calls.length = 0;
  events.length = 0;
  const staleLockRunner = async (args) => {
    calls.push(args);
    if (args[0] === 'ci') throw new Error('npm error code EUSAGE\nnpm error Missing: @esbuild/linux-x64 from lock file');
  };
  assert.equal(await installCandidateDependencies({ hasLockfile: true, runNpm: staleLockRunner, options: {}, reportPhase }), 'unlocked');
  assert.deepEqual(calls, [['ci'], ['install']]);
  assert.match(events[1][2], /Retrying npm install/);

  await assert.rejects(
    installCandidateDependencies({ hasLockfile: true, runNpm: async () => { throw new Error('npm error code ECONNRESET'); }, options: {} }),
    /Candidate dependency installation failed/
  );
});

test('failed build output is bounded and redacts project environment values', () => {
  const secret = 'production-secret-value';
  const output = redactBuildOutput('x'.repeat(60 * 1024) + '\nnpm error API_KEY=' + secret + '\nAuthorization: Bearer bearer-value', 'API_KEY=' + secret + '\n');
  assert.match(output, /API_KEY=<redacted>/);
  assert.match(output, /Authorization: Bearer <redacted>/);
  assert.equal(output.includes(secret), false);
  assert.match(output, /earlier deployment output omitted/);
  assert.ok(Buffer.byteLength(output, 'utf8') <= 48 * 1024);
});

test('candidate health checks reserve their PORT and HOST after loading project environment', () => {
  const environment = candidateRuntimeEnvironment({
    baseEnvironment: { HOME: '/home/dashboardportal' },
    environmentContent: 'PORT=4000\nHOST=0.0.0.0\nDATABASE_URL=postgres://example',
    candidatePort: 24000
  });
  assert.equal(environment.PORT, '24000');
  assert.equal(environment.HOST, '127.0.0.1');
  assert.equal(environment.HOSTMGR_CANDIDATE, 'true');
  assert.equal(environment.DATABASE_URL, 'postgres://example');
});

test('candidate health failures retain redacted startup output for the release log', async (t) => {
  const previousNpmPath = process.env.HOSTMGR_NPM_PATH;
  process.env.HOSTMGR_NPM_PATH = process.execPath;
  t.after(() => {
    if (previousNpmPath === undefined) delete process.env.HOSTMGR_NPM_PATH;
    else process.env.HOSTMGR_NPM_PATH = previousNpmPath;
  });

  await assert.rejects(
    healthCheckCandidate(process.cwd(), {
      runtime: 'node',
      startScript: 'start',
      healthCheckEnabled: true,
      healthCheckPath: '/',
      healthCheckTimeoutMs: 1_000,
      candidatePort: 25_678
    }, { environment: {} }, null),
    (error) => {
      assert.match(error.message, /exited before the health check passed/);
      assert.match(error.failureLog, /Cannot find module/);
      return true;
    }
  );
});

test('Bun candidate installs use a frozen lockfile and fall back only for a lock mismatch', async () => {
  const calls = [];
  const runner = async (args) => { calls.push(args); };
  assert.equal(await installCandidateDependencies({ hasLockfile: true, runtime: 'bun', runNpm: runner, options: {} }), 'locked');
  assert.deepEqual(calls, [['install', '--frozen-lockfile']]);

  calls.length = 0;
  const staleLockRunner = async (args) => {
    calls.push(args);
    if (args.includes('--frozen-lockfile')) throw new Error('error: lockfile had changes, but lockfile is frozen');
  };
  assert.equal(await installCandidateDependencies({ hasLockfile: true, runtime: 'bun', runNpm: staleLockRunner, options: {} }), 'unlocked');
  assert.deepEqual(calls, [['install', '--frozen-lockfile'], ['install']]);
});

test('automatic project ports retry reserved and listening ports, including their candidate ports', async () => {
  const attempts = [12_000, 13_000, 14_000];
  const checked = [];
  const port = await resolveProjectPort(
    { slug: 'new-app', runtime: 'bun', port: null },
    null,
    [{ slug: 'existing-app', runtime: 'node', port: 12_000 }],
    async (candidate) => { checked.push(candidate); return candidate !== 13_000; },
    () => attempts.shift()
  );
  assert.equal(port, 14_000);
  assert.deepEqual(checked, [13_000, 14_000, 24_000]);
});
