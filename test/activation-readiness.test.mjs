import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { buildEdgeEvaluation } from '../scripts/nginx-edge.mjs';

const source = await readFile(new URL('../scripts/hostmgr-deploy-helper.mjs', import.meta.url), 'utf8');
const assertion = source.match(/async function assertProjectEdge\(project[^]*?\n\}/)[0];

test('a loaded edge waits for graceful reload workers before treating the old 404 and TLS rejection as failure', async () => {
  let attempts = 0;
  let elapsed = 0;
  const sitePath = '/etc/nginx/sites-available/hostmgr-fixture.conf';
  const enabledPath = '/etc/nginx/sites-enabled/hostmgr-fixture.conf';
  const check = vm.runInNewContext(`(${assertion})`, {
    inspectLoadedProjectEdge: async () => {
      const ready = ++attempts > 1;
      return buildEdgeEvaluation({
        siteExists: true, enabled: true, hosts: ['api.example.test'], port: 39984, sitePath, enabledPath,
        nginx: `# configuration file ${enabledPath}:\nserver {\n listen 80;\n server_name api.example.test;\n}\nserver {\n listen 443 ssl;\n server_name api.example.test;\n location / { proxy_pass http://127.0.0.1:39984; }\n}\n`,
        upstreamProbe: { status: 200, kind: 'app' },
        httpProbe: ready ? { status: 308, location: 'https://api.example.test/', kind: 'empty' } : { status: 404, kind: 'app' },
        tlsProbe: { status: ready ? 'valid' : 'invalid', expiresAt: null }
      });
    },
    delay: async ms => { elapsed += ms; }, Date: { now: () => elapsed },
    HelperError: Error
  });
  await check({ port: 39984 }, { timeoutMs: 1000, intervalMs: 250 });
  assert.equal(attempts, 2);
  assert.equal(elapsed, 250);
});

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

test('a loaded edge bounds TLS and HTTP retries and reports the actual failed probe', async () => {
  for (const failedId of ['certificate', 'http']) {
    let elapsed = 0;
    let attempts = 0;
    const check = vm.runInNewContext(`(${assertion})`, {
      inspectLoadedProjectEdge: async () => {
        attempts++;
        return { status: 'error', checks: [
          ...['site', 'enabled', 'loaded', 'conflict', 'tls'].map(id => ({ id, ok: true })),
          { id: failedId, ok: false, detail: `fixture ${failedId} failed` }
        ] };
      },
      delay: async ms => { elapsed += ms; }, Date: { now: () => elapsed },
      HelperError: class extends Error { constructor(message, buildOutput) { super(message); this.buildOutput = buildOutput; } }
    });
    await assert.rejects(check({ port: 39984 }, { timeoutMs: 1000, intervalMs: 250 }), error => {
      assert.match(error.message, failedId === 'certificate' ? /TLS certificate/ : /HTTP/);
      assert.match(error.buildOutput, /4 attempts over 1000 ms/);
      assert.match(error.buildOutput, new RegExp(`fixture ${failedId} failed`));
      return true;
    });
    assert.equal(attempts, 4);
    assert.equal(elapsed, 1000);
  }
});

test('a real configuration failure does not wait even while the upstream is starting', async () => {
  for (const failedId of ['site', 'enabled', 'loaded', 'conflict', 'tls']) {
    let attempts = 0;
    const check = vm.runInNewContext(`(${assertion})`, {
      inspectLoadedProjectEdge: async () => {
        attempts++;
        return { status: 'upstream-down', checks: [{ id: failedId, ok: false }] };
      },
      delay: async () => assert.fail('configuration errors cannot recover by waiting'), Date, HelperError: Error
    });
    await assert.rejects(check({ port: 39984 }), /Nginx/);
    assert.equal(attempts, 1);
  }
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

test('an app deployment keeps pending domains out of Nginx and certificate activation', async () => {
  let activatedHosts;
  const project = { slug: 'fixture', runtime: 'python', domains: { hosts: ['active.example.test', 'pending.example.test'], activeHosts: ['active.example.test'] }, deployment: { releases: [{ id: 'candidate', status: 'candidate' }] } };
  const activate = vm.runInNewContext(`(${source.match(/async function activateProject\([^]*?\n\}/)[0]})`, {
    loadProject: async () => project, validateReleaseId() {}, pythonSettings: () => ({}),
    join: (...parts) => parts.join('/'), PROJECT_ROOT: '/projects', readTextOrEmpty: async () => '',
    prepareProjectRelease: async () => ({ identity: {}, previousTarget: null }), startAndCheckProject: async () => {},
    applyDomains: async project => { activatedHosts = Array.from(project.domains.hosts); }, pruneHistoricalReleases: async () => 0
  });
  await activate('fixture', 'candidate');
  assert.deepEqual(activatedHosts, ['active.example.test']);
});
