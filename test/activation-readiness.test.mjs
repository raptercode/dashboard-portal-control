import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../scripts/hostmgr-deploy-helper.mjs', import.meta.url), 'utf8');
const assertion = source.match(/async function assertProjectEdge\(project[^]*?\n\}/)[0];

test('activation rechecks an upstream that becomes ready after its first probe', async () => {
  let attempts = 0;
  let elapsed = 0;
  const check = vm.runInNewContext(`(${assertion})`, {
    inspectLoadedProjectEdge: async () => ({ status: ++attempts < 3 ? 'upstream-down' : 'ok', checks: [] }),
    delay: async (ms) => { elapsed += ms; }, Date: { now: () => elapsed },
    HelperError: Error
  });
  await check({ port: 44739, healthCheckEnabled: false, healthCheckPath: '/' });
  assert.equal(attempts, 3);
  assert.ok(elapsed > 0);
});

test('an unavailable upstream times out with the last probe diagnostics', async () => {
  let elapsed = 0;
  let attempts = 0;
  const check = vm.runInNewContext(`(${assertion})`, {
    inspectLoadedProjectEdge: async () => { attempts++; return { status: 'upstream-down', checks: [{ id: 'upstream', ok: false, detail: 'ECONNREFUSED' }] }; },
    delay: async ms => { elapsed += ms; }, Date: { now: () => elapsed },
    HelperError: class extends Error { constructor(message, buildOutput) { super(message); this.buildOutput = buildOutput; } }
  });
  await assert.rejects(check({ port: 44739, healthCheckPath: '/health' }, { timeoutMs: 1000, intervalMs: 250 }), error => {
    assert.match(error.message, /after waiting for startup/);
    assert.match(error.buildOutput, /4 attempts over 1000 ms/);
    assert.match(error.buildOutput, /44739\/health/);
    assert.match(error.buildOutput, /ECONNREFUSED/);
    return true;
  });
  assert.equal(attempts, 4);
});

test('healthy and structurally broken edges do not enter the startup retry loop', async () => {
  for (const status of ['ok', 'default-site', 'not-loaded']) {
    let attempts = 0;
    const check = vm.runInNewContext(`(${assertion})`, {
      inspectLoadedProjectEdge: async () => { attempts++; return { status, checks: [] }; },
      delay: async () => assert.fail('unexpected retry'), Date, HelperError: Error
    });
    if (status === 'ok') await check({ port: 3000 });
    else await assert.rejects(check({ port: 3000 }), /Nginx/);
    assert.equal(attempts, 1);
  }
});

test('edge activation failure captures the candidate journal before rollback and redacts secrets', async () => {
  const calls = [];
  const project = { slug: 'fixture', runtime: 'python', deployment: { releases: [{ id: 'candidate', status: 'candidate' }] } };
  const context = vm.createContext({
    loadProject: async () => project, validateReleaseId: () => {}, pythonSettings: () => ({}),
    join: (...parts) => parts.join('/'), PROJECT_ROOT: '/projects', readTextOrEmpty: async () => 'TOKEN=private-fixture',
    prepareProjectRelease: async () => ({ identity: { service: 'fixture.service' }, rollback: async () => calls.push('rollback') }),
    startAndCheckProject: async () => {}, applyDomains: async () => { throw new Error('startup timed out'); },
    run: async (_command, args) => { calls.push('journal'); assert.ok(args.includes('fixture.service')); return 'startup failed TOKEN=private-fixture'; },
    helperFailure: error => ({ message: error.message, buildOutput: error.message }),
    redactBuildOutput: (value, environment) => { assert.equal(environment, 'TOKEN=private-fixture'); return value.replaceAll('private-fixture', '[REDACTED]'); }
  });
  for (const name of ['activateProject', 'captureActivationDiagnostics', 'rollbackFailedActivation']) {
    vm.runInContext(source.match(new RegExp(`async function ${name}\\([^]*?\\n\\}`))[0], context);
  }
  await assert.rejects(context.activateProject('fixture', 'candidate'), error => {
    assert.match(error.buildOutput, /Candidate runtime diagnostics \(before rollback\)/);
    assert.match(error.buildOutput, /startup failed TOKEN=\[REDACTED\]/);
    assert.ok(!error.buildOutput.includes('private-fixture'));
    return true;
  });
  assert.deepEqual(calls, ['journal', 'rollback']);
});
