import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/cli-info.mjs', import.meta.url));
const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });

test('help aliases and subcommand help list real commands without requiring root', () => {
  for (const args of [[], ['-h'], ['--help'], ['update', '--help'], ['configure-update', '-h'], ['--reset-pwd', '--help']]) {
    const result = run(...args);
    assert.equal(result.status, 0, result.stderr);
    for (const command of ['update', 'configure-update', '--reset-pwd', '--manifest', '--public-key', '--channel', '--check', '--versions']) assert.ok(result.stdout.includes(command));
    assert.match(result.stdout, /no sudo required/);
  }
});

test('version aliases report available information even when host tools are absent', () => {
  for (const flag of ['-v', '--versions', '--version']) {
    const result = run(flag);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Dashboard Portal:/);
    assert.match(result.stdout, /CLI Node\.js: v/);
    for (const major of [20, 22, 24, 26]) assert.match(result.stdout, new RegExp(`Node ${major}:`));
  }
  assert.equal(run('--unknown').status, 64);
});

test('installed wrapper routes read-only flags ahead of privileged operations', async () => {
  const source = await readFile(new URL('../dashboard-portal.sh', import.meta.url), 'utf8');
  const wrapper = source.match(/cat > "\$UPDATE_COMMAND" <<EOF\r?\n([^]*?)\r?\nEOF/)[1];
  assert.ok(wrapper.indexOf('CLI_INFO_SCRIPT') < wrapper.indexOf('PASSWORD_SCRIPT'));
  assert.match(source, /chmod 0755 "\$UPDATE_COMMAND"/);
  assert.match(source, /install -d -m 0755 -o root -g root "\$CLI_INFO_ROOT"/);
  assert.match(source, /install -m 0644[^\n]*cli-info\.mjs/);
  assert.match(source, /install -d -m 0750 -o root -g root "\$HELPER_ROOT"/);
});

test('generated Bash wrapper dispatches help and versions without invoking updater or password reset', async (t) => {
  const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
  if (spawnSync(bash, ['--version']).status !== 0) return t.skip('Bash unavailable');
  const source = await readFile(new URL('../dashboard-portal.sh', import.meta.url), 'utf8');
  const wrapper = source.match(/cat > "\$UPDATE_COMMAND" <<EOF\r?\n([^]*?)\r?\nEOF/)[1]
    .replaceAll('\\$', '$').replaceAll('${PORTAL_NODE}', 'node').replaceAll('${CLI_INFO_SCRIPT}', 'readonly-info')
    .replaceAll('${PASSWORD_SCRIPT}', 'password-reset').replaceAll('${UPDATE_SCRIPT}', 'privileged-updater');
  for (const args of [[], ['-h'], ['--help'], ['-v'], ['--versions'], ['update', '--help'], ['--reset-pwd', '-h']]) {
    const result = spawnSync(bash, ['-s', '--', ...args], { encoding: 'utf8', input: `exec() { printf '%s\\n' "$*"; exit 0; }\n${wrapper}\n` });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /readonly-info/);
    assert.doesNotMatch(result.stdout, /privileged-updater|password-reset/);
  }
});
