import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { basename } from 'node:path';
import { join } from 'node:path';
import { projectServiceUser } from '../scripts/project-service-user.mjs';
import vm from 'node:vm';
import { projectIdentity } from '../src/native-project.mjs';

// Exercise the helper's real command/error pipeline without opening its root socket.
const source = await readFile(new URL('../scripts/hostmgr-deploy-helper.mjs', import.meta.url), 'utf8');
const context = vm.createContext({ spawn, Buffer, basename, MAX_COMMAND_OUTPUT_BYTES: 64 * 1024 });
vm.runInContext(source.slice(source.indexOf('function run(command, args, options = {})')), context);

test('valid long project slugs produce stable Linux accounts of at most 32 characters', () => {
  const user = projectIdentity('seo-writer-contribute-api').user;
  assert.ok(user.length <= 32, `useradd rejects ${user} (${user.length} characters)`);
  assert.equal(user, projectIdentity('seo-writer-contribute-api').user);
  assert.notEqual(user, projectIdentity('seo-writer-contribute-api-next').user);
  assert.ok(projectIdentity('a'.repeat(63)).user.length <= 32);
  assert.equal(projectIdentity('demo-app').user, 'hostmgr-demo-app');
  assert.equal(projectIdentity('a'.repeat(24)).user, `hostmgr-${'a'.repeat(24)}`);
});

test('root helper and application use the same account mapping, installed with the helper', async () => {
  const helperIdentity = vm.runInNewContext(`(${source.match(/function projectIdentity\(slug\) \{[^]*?\n\}/)[0]})`, {
    validateSlug: () => {}, projectServiceUser, join, RUNTIME_ROOT: '/srv/hostmgr/projects', ENVIRONMENT_ROOT: '/etc/hostmgr/projects'
  });
  assert.equal(helperIdentity('seo-writer-contribute-api').user, projectIdentity('seo-writer-contribute-api').user);
  const installer = await readFile(new URL('../dashboard-portal.sh', import.meta.url), 'utf8');
  assert.match(installer, /install[^\n]*project-service-user\.mjs[^\n]*HELPER_ROOT/);
});

test('helper activation errors retain command, exit code and redacted stderr through serialization', async () => {
  const secret = 'fixture-secret-value';
  try {
    await context.run(process.execPath, ['-e', `console.error('invalid user name; credential=${secret}'); process.exit(3)`], { failure: 'The project service account could not be created.' });
    assert.fail('command should fail');
  } catch (error) {
    const failure = context.helperFailure(error, 'Activation failed.', `CREDENTIAL="${secret}"\n`);
    const payload = JSON.parse(JSON.stringify({ ok: false, error: failure.message, buildOutput: failure.buildOutput }));
    assert.match(payload.buildOutput, /invalid user name/);
    assert.match(payload.buildOutput, /exit(?: code)?[=: ]+3/i);
    assert.match(payload.buildOutput, /node/i);
    assert.ok(!payload.buildOutput.includes(secret));
  }
});

test('helper spawn failures include the executable and error code', async () => {
  await assert.rejects(context.run('hostmgr-nonexistent-fixture-command', [], { timeout: 100 }), (error) => {
    const failure = context.helperFailure(error, 'Activation failed.');
    assert.match(failure.buildOutput, /hostmgr-nonexistent-fixture-command/);
    assert.match(failure.buildOutput, /ENOENT/);
    return true;
  });
});

test('synchronous uid/gid spawn rejection preserves the same diagnostics as async failure', async () => {
  const denied = vm.createContext({ spawn: () => { throw Object.assign(new Error('spawn EPERM'), { code: 'EPERM' }); }, Buffer, basename });
  vm.runInContext(source.slice(source.indexOf('function run(command, args, options = {})')), denied);
  await assert.rejects(denied.run('/usr/bin/python3', [], { uid: 993, gid: 983 }), error => {
    assert.match(error.commandOutput, /Command: python3/);
    assert.match(error.commandOutput, /EPERM/);
    return true;
  });
});

test('only the root helper retains uid/gid capabilities while keeping NoNewPrivileges', async () => {
  const installer = await readFile(new URL('../dashboard-portal.sh', import.meta.url), 'utf8');
  const unit = installer.match(/cat > "\$HELPER_SERVICE_FILE" <<EOF[^]*?\nEOF/)[0];
  assert.match(unit, /NoNewPrivileges=true/);
  assert.match(unit, /AmbientCapabilities=CAP_SETUID CAP_SETGID/);
  assert.equal((installer.match(/AmbientCapabilities=/g) || []).length, 1);
});

test('helper preserves useful output beyond the former 12 KiB limit and marks truncation', () => {
  const output = context.redactBuildOutput('first error\n' + 'x'.repeat(20 * 1024), '');
  assert.match(output, /^first error/);
  const truncated = context.redactBuildOutput('x'.repeat(80 * 1024), '');
  assert.match(truncated, /earlier.*omitted/);
  assert.ok(Buffer.byteLength(truncated) <= 48 * 1024);
});

test('DNS activation failure names the affected domain and retains resolver diagnostics', async () => {
  const issue = vm.runInNewContext(`(${source.match(/async function issueCertificate\(project\) \{[^]*?\n\}/)[0]})`, {
    acmeEmail: async () => 'owner@example.test',
    run: async () => { throw { commandOutput: 'Command: getent\nExit code: 2' }; },
    HelperError: class extends Error { constructor(message, buildOutput) { super(message); this.buildOutput = buildOutput; } }
  });
  await assert.rejects(issue({domains:{hosts:['seo.example.test']}}), error => {
    assert.match(error.message, /seo\.example\.test.*A\/AAAA/);
    assert.match(error.buildOutput, /Exit code: 2/);
    return true;
  });
});
