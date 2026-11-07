import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = (await readFile(new URL('../strckro.sh', import.meta.url), 'utf8')).replaceAll('\r\n', '\n');
const site = script.match(/cat > "\$NGINX_SITE" <<EOF\n([\s\S]*?)\nEOF/)[1];
const limits = script.match(/cat > "\$TMP_DIR\/limits\.conf" <<'EOF'\n([\s\S]*?)\nEOF/)[1];
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
const available = spawnSync(bash, ['--version']).status === 0;
const shellPath = (path) => path.replaceAll('\\', '/').replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`);
const exists = (path) => access(path).then(() => true, () => false);

test('the request-rate zone lives in its own managed http-level file, rendered literally', () => {
  assert.match(script, /^NGINX_LIMITS_CONF='\/etc\/nginx\/conf\.d\/strckro-limits\.conf'$/m);
  assert.equal(limits.match(/^limit_req_zone .*$/gm).length, 1);
  // A quoted heredoc keeps $binary_remote_addr and the regex for Nginx.
  assert.match(limits, /^limit_req_zone \$strckro_visitor zone=strckro_requests:10m rate=40r\/s;$/m);
  assert.match(script, /install -m 0644 -o root -g root "\$TMP_DIR\/limits\.conf" "\$NGINX_LIMITS_CONF"/);
});

test('an IPv6 visitor is counted as its /64 and an IPv4 visitor as its address', () => {
  const map = limits.match(/^map \$binary_remote_addr \$strckro_visitor \{\n([\s\S]*?)\n\}$/m)[1];
  // 16 bytes of IPv6: keep the first 8, which are the /64. (?s) because any byte, even a newline, can occur in an address.
  assert.match(map, /^\s+"~\(\?s\)\^\(\?<network>\.\{8\}\)\.\{8\}\$"\s+\$network;$/m);
  // Anything else (IPv4 is 4 bytes) is its own visitor.
  assert.match(map, /^\s+default\s+\$binary_remote_addr;$/m);
  // The zone is keyed by the mapped variable, never by the raw address.
  assert.doesNotMatch(limits, /limit_req_zone \$binary_remote_addr/);
});

test('the portal site applies that zone with a burst, and answers 429', () => {
  const location = site.match(/location \/ \{([\s\S]*?)\n    \}/)[1];
  assert.match(location, /^\s+limit_req zone=strckro_requests burst=200 nodelay;$/m);
  assert.match(location, /^\s+limit_req_status 429;$/m);
  assert.match(location, /^\s+limit_req_log_level warn;$/m, 'refusals must not log at the default error level');
  // The zone the site names is the zone the file defines.
  assert.equal(location.match(/zone=(\w+) /)[1], limits.match(/zone=(\w+):/)[1]);
});

test('the limits file is in place before Nginx is tested, and is backed up and restored with the rest', () => {
  assert.ok(script.indexOf('"$TMP_DIR/limits.conf" "$NGINX_LIMITS_CONF"') < script.indexOf('\nnginx_test\n'));
  assert.match(script, /backup_item nginx-limits "\$NGINX_LIMITS_CONF"/);
  assert.match(script, /restore_item nginx-limits "\$NGINX_LIMITS_CONF"/);
});

test('the installer renders its real-IP file before testing the configuration with nginx_test, never with a bare nginx -t', () => {
  const render = script.indexOf('\ninstall_realip_conf\n');
  const test = script.indexOf('\nnginx_test\n');
  assert.ok(render > 0 && test > render);
  assert.doesNotMatch(script.slice(render), /^nginx -t$/m, 'the install step must go through nginx_test');
});

const realipDefinition = script.slice(script.indexOf('install_realip_conf() {'), script.indexOf('\n# `nginx -t`, with one allowance.'));
const nginxTestDefinition = script.slice(script.indexOf('nginx_test() {'), script.indexOf('\ninstall_realip_conf\n'));
const DUPLICATE = '2026/11/07 21:37:21 [emerg] 623#623: "real_ip_header" directive is duplicate in /etc/nginx/conf.d/zz-host.conf:1';

async function nginxFixture(t, { ours = true } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'nginx-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'conf.d'), { recursive: true });
  await mkdir(join(dir, 'tmp'), { recursive: true });
  if (ours) await writeFile(join(dir, 'conf.d', 'strckro-realip.conf'), 'earlier\n');
  await writeFile(join(dir, 'calls'), '0\n');
  const root = shellPath(dir);
  // `nginx` is replaced by a function that answers like the scenario says, first call and later calls.
  const run = (first, later) => spawnSync(bash, ['-s'], {
    encoding: 'utf8',
    input: `set -euo pipefail\nNGINX_REALIP_CONF='${root}/conf.d/strckro-realip.conf'\nnginx() { local n; n=$(<'${root}/calls'); echo $((n + 1)) > '${root}/calls'; if [[ "$n" == 0 ]]; then printf '%s\\n' '${first.output}' >&2; return ${first.code}; fi; printf '%s\\n' '${later.output}' >&2; return ${later.code}; }\n${nginxTestDefinition}\nnginx_test\n`
  });
  return { dir, run, file: join(dir, 'conf.d', 'strckro-realip.conf') };
}

test('a configuration that passes is left alone', { skip: !available }, async (t) => {
  const { run, file } = await nginxFixture(t);
  const result = run({ output: 'syntax is ok', code: 0 }, { output: 'unused', code: 1 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.equal(await exists(file), true);
});

test('a duplicate real_ip directive from the host drops only Strckro\'s file, says so, and the update goes on', { skip: !available }, async (t) => {
  for (const directive of ['real_ip_header', 'real_ip_recursive']) {
    const { run, file, dir } = await nginxFixture(t);
    const result = run({ output: DUPLICATE.replace('real_ip_header', directive), code: 1 }, { output: 'test is successful', code: 0 });
    assert.equal(result.status, 0, `${directive}: ${result.stderr}`);
    assert.match(result.stderr, new RegExp(`WARNING: Nginx already has a real_ip_header or real_ip_recursive of its own \\(.*"${directive}" directive is duplicate in /etc/nginx/conf\\.d/zz-host\\.conf:1\\)`), directive);
    assert.equal(await exists(file), false, 'its file is removed so the host\'s own setting is the only one');
    assert.equal((await readFile(join(dir, 'calls'), 'utf8')).trim(), '2', 'nginx is asked again');
  }
});

test('anything else that fails stays a failure, and Strckro\'s file is left for the rollback', { skip: !available }, async (t) => {
  for (const output of ['[emerg] unknown directive "limit_req_zone2" in /etc/nginx/conf.d/strckro-limits.conf:7', '[emerg] "server" directive is not allowed here in /etc/nginx/sites-enabled/x:3']) {
    const { run, file, dir } = await nginxFixture(t);
    const result = run({ output, code: 1 }, { output: 'must not be asked', code: 0 });
    assert.notEqual(result.status, 0, output);
    assert.ok(result.stderr.includes(output), 'the real complaint is shown');
    assert.equal(await exists(file), true, 'not removed: the cause is not ours to guess');
    assert.equal((await readFile(join(dir, 'calls'), 'utf8')).trim(), '1', 'not asked again');
  }
});

test('a duplicate that persists after dropping the file is a failure, and one with no file of ours is not retried', { skip: !available }, async (t) => {
  const stillBroken = await nginxFixture(t);
  assert.notEqual(stillBroken.run({ output: DUPLICATE, code: 1 }, { output: DUPLICATE, code: 1 }).status, 0);
  const noFile = await nginxFixture(t, { ours: false });
  const result = noFile.run({ output: DUPLICATE, code: 1 }, { output: 'would pass', code: 0 });
  assert.notEqual(result.status, 0, 'with no file of ours there is nothing to drop, so the duplicate is the host\'s own problem');
  assert.equal((await readFile(join(noFile.dir, 'calls'), 'utf8')).trim(), '1');
});

test('the real-IP file is rendered to a temporary file and installed only when it is not empty', { skip: !available }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'realip-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'conf.d'), { recursive: true });
  await mkdir(join(dir, 'tmp'), { recursive: true });
  const root = shellPath(dir);
  const scripts = shellPath(fileURLToPath(new URL('../scripts', import.meta.url)));
  const run = (nodePath) => spawnSync(bash, ['-s'], {
    encoding: 'utf8',
    // `install -o root -g root` needs root; drop those two options so the rest of the command runs as written.
    input: `set -euo pipefail\ndie() { echo "$*" >&2; exit 1; }\ninstall() { local a=(); while [[ $# -gt 0 ]]; do case "$1" in -o|-g) shift 2;; *) a+=("$1"); shift;; esac; done; command install "\${a[@]}"; }\nNGINX_REALIP_CONF='${root}/conf.d/strckro-realip.conf'\nTMP_DIR='${root}/tmp'\nPORTAL_NODE='${nodePath}'\nHELPER_ROOT='${scripts}'\n${realipDefinition}\ninstall_realip_conf\n`
  });
  const rendered = run(shellPath(process.execPath));
  assert.equal(rendered.status, 0, rendered.stderr);
  assert.match(await readFile(join(dir, 'conf.d', 'strckro-realip.conf'), 'utf8'), /^real_ip_header CF-Connecting-IP;$/m);
  await rm(join(dir, 'conf.d', 'strckro-realip.conf'));
  const broken = run('/bin/true');
  assert.notEqual(broken.status, 0, 'an empty render stops the installer');
  assert.equal(await exists(join(dir, 'conf.d', 'strckro-realip.conf')), false);
});
