import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile, stat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
const source = (await readFile(new URL('../dashboard-portal.sh', import.meta.url), 'utf8')).replaceAll('\r\n', '\n');
const functions = source.slice(source.indexOf('die()'), source.indexOf('[[ $EUID'));
const snapshot = source.slice(source.indexOf('if systemctl is-active --quiet dashboard-portal.service; then PREVIOUS_SERVICE_ACTIVE'), source.indexOf('# /run is cleared at boot.'));
const resources = {
  SERVICE_FILE: 'service', HELPER_SERVICE_FILE: 'helper-service', HELPER_ROOT: 'helper-root',
  MAINTENANCE_TMPFILES: 'maintenance-tmpfiles',
  CLI_INFO_ROOT: 'cli-info-root', UPDATE_COMMAND: 'update-command', NGINX_SITE: 'nginx-site',
  NGINX_ENABLED: 'nginx-enabled', NGINX_DEFAULT_ENABLED: 'nginx-default-enabled',
  NGINX_CATCHALL_SITE: 'nginx-catchall-site', NGINX_CATCHALL_ENABLED: 'nginx-catchall-enabled',
  APP_ROOT: 'app-root', CONFIG_ROOT: 'config'
};

function fixture(action, { partial = false, enabled = false, active = true, absentCatchall = false } = {}) {
  return `
set -u
root=$(mktemp -d)
trap 'rm -rf -- "$root"' EXIT
mkdir -p "$root/data" "$root/backup"
${Object.entries(resources).map(([variable, file]) => `${variable}="$root/${file}"\nprintf old > "$${variable}"`).join('\n')}
DATA_ROOT="$root/data"
printf old > "$DATA_ROOT/state.sqlite"
printf old > "$DATA_ROOT/state.sqlite-wal"
printf old > "$DATA_ROOT/state.sqlite-shm"
${absentCatchall ? 'rm "$NGINX_CATCHALL_SITE" "$NGINX_CATCHALL_ENABLED"' : ''}
printf ${active} > "$root/portal-active"
printf ${active} > "$root/helper-active"
printf ${enabled} > "$root/portal-enabled"
printf ${enabled} > "$root/helper-enabled"
systemctl() {
  printf '%s\\n' "$*" >> "$root/systemctl.log"
  local service role=portal
  for service in "$@"; do :; done
  [[ "$service" == hostmgr-deploy-helper.service ]] && role=helper
  case "$1" in
    is-active) [[ "$(cat "$root/$role-active")" == true ]] ;;
    is-enabled) [[ "$(cat "$root/$role-enabled")" == true ]] ;;
    stop) printf false > "$root/$role-active" ;;
    disable) printf false > "$root/$role-active"; printf false > "$root/$role-enabled" ;;
    enable) printf true > "$root/$role-enabled" ;;
    restart) printf true > "$root/$role-active" ;;
    *) return 0 ;;
  esac
}
nginx() { return 0; }
cp() {
  [[ "$(cat "$root/portal-active")" == false && "$(cat "$root/helper-active")" == false ]] || return 91
  ${partial ? '[[ "$*" != *nginx-catchall-site* ]] || return 92' : ''}
  command cp "$@"
}
(
set -Eeuo pipefail
TMP_DIR=''
BACKUP_DIR="$root/backup"
ROLLBACK_ARMED=false
SNAPSHOTS_READY=false
PREVIOUS_SERVICE_ACTIVE=false
PREVIOUS_SERVICE_ENABLED=false
PREVIOUS_HELPER_ACTIVE=false
PREVIOUS_HELPER_ENABLED=false
${functions}
${snapshot}
${Object.keys(resources).map(variable => `printf new > "$${variable}"`).join('\n')}
printf new > "$DATA_ROOT/state.sqlite"
${action}
)
code=$?
printf 'EXIT=%s\\n' "$code"
for path in ${Object.values(resources).join(' ')} data/state.sqlite data/state.sqlite-wal data/state.sqlite-shm; do printf 'FILE=%s:%s\\n' "$path" "$(cat "$root/$path")"; done
for role in portal helper; do printf 'STATE=%s:%s:%s\\n' "$role" "$(cat "$root/$role-active")" "$(cat "$root/$role-enabled")"; done
cat "$root/systemctl.log"
`;
}

function run(action, options) {
  const result = spawnSync(bash, ['-s'], { input: fixture(action, options), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

test('explicit die and command failure restore snapshots and prior active but disabled services', () => {
  for (const action of ["die 'injected health failure'", 'false']) {
    const output = run(action);
    assert.match(output, /EXIT=1/);
    for (const resource of Object.values(resources)) assert.ok(output.includes(`FILE=${resource}:old`), resource);
    assert.match(output, /FILE=data\/state.sqlite:old/);
    assert.match(output, /STATE=portal:true:false/);
    assert.match(output, /STATE=helper:true:false/);
    assert.ok(output.indexOf('restart hostmgr-deploy-helper.service') < output.indexOf('restart dashboard-portal.service'));
  }
});

test('partial snapshot failure leaves originals intact and recovers both service states', () => {
  const output = run('false', { partial: true, enabled: true });
  assert.match(output, /EXIT=92/);
  for (const resource of Object.values(resources)) assert.ok(output.includes(`FILE=${resource}:old`), resource);
  assert.match(output, /STATE=portal:true:true/);
  assert.match(output, /STATE=helper:true:true/);
});

test('rollback preserves inactive enabled services and removes newly created catchall resources', () => {
  const output = run('false', { active: false, enabled: true, absentCatchall: true });
  assert.match(output, /STATE=portal:false:true/);
  assert.match(output, /STATE=helper:false:true/);
  assert.match(output, /FILE=nginx-catchall-site:\n/);
  assert.match(output, /FILE=nginx-catchall-enabled:\n/);
  assert.doesNotMatch(output, /restart (?:dashboard-portal|hostmgr-deploy-helper).service/);
});

test('success cleans up safely and does not restore old files', () => {
  const output = run('ROLLBACK_ARMED=false\ncleanup');
  assert.match(output, /EXIT=0/);
  assert.match(output, /FILE=cli-info-root:new/);
  assert.match(output, /FILE=nginx-catchall-site:new/);
  assert.doesNotMatch(output, /disable --now/);
});

test('signals preserve failure status and restore old state', () => {
  for (const [signal, status] of [['INT', 130], ['TERM', 143]]) {
    const output = run(`kill -${signal} "$BASHPID"`);
    assert.ok(output.includes(`EXIT=${status}`));
    assert.match(output, /FILE=cli-info-root:old/);
    assert.match(output, /STATE=helper:true:false/);
  }
});

test('installer refuses a busy maintenance lease before stopping services without replacing the lock', () => {
  const lock = source.slice(source.indexOf('command -v flock'), source.indexOf('if systemctl is-active --quiet dashboard-portal.service; then PREVIOUS_SERVICE_ACTIVE'));
  const result = spawnSync(bash, ['-s'], { encoding: 'utf8', input: `
root=$(mktemp -d)
trap 'rm -rf -- "$root"' EXIT
MAINTENANCE_ROOT="$root/maintenance"
MAINTENANCE_LOCK="$MAINTENANCE_ROOT/operations.lock"
APP_USER=root
mkdir "$MAINTENANCE_ROOT"
printf sentinel > "$MAINTENANCE_LOCK"
die() { echo "$*" >&2; exit 1; }
stat() { if [[ "$2" == %h ]]; then printf '1\\n'; else printf '0\\n'; fi; }
install() { return 0; }
chown() { return 0; }
chmod() { return 0; }
flock() { printf '%s\\n' "$*" > "$root/flock"; return 1; }
systemctl() { touch "$root/stopped"; }
(
set -e
${lock}
systemctl stop dashboard-portal.service
)
code=$?
[[ "$code" == 1 && ! -e "$root/stopped" && "$(cat "$MAINTENANCE_LOCK")" == sentinel ]] || exit 93
[[ "$(cat "$root/flock")" == '--exclusive --nonblock 9' ]] || exit 94
` });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /operations are active/);
});

const tmpfilesPrerequisite = process.platform !== 'linux' ? 'Requires Linux systemd-tmpfiles and root ownership acceptance' : process.getuid() !== 0 ? 'Requires root to verify production tmpfiles ownership' : spawnSync('systemd-tmpfiles', ['--version']).status !== 0 ? 'Requires systemd-tmpfiles installed in the Linux acceptance fixture' : false;
test('boot tmpfiles restores maintenance paths and preserves an existing live lock inode', { skip: tmpfilesPrerequisite }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'portal-tmpfiles-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'etc/tmpfiles.d'), { recursive: true });
  const config = join(root, 'etc/tmpfiles.d/dashboard-portal-maintenance.conf');
  const printf = source.split('\n').find((line) => line.startsWith("printf 'd %s 0750 root"));
  assert.ok(printf);
  const generated = spawnSync('bash', ['-c', `MAINTENANCE_ROOT=/run/dashboard-portal-maintenance\nMAINTENANCE_LOCK="$MAINTENANCE_ROOT/operations.lock"\nAPP_USER=root\nMAINTENANCE_TMPFILES=${JSON.stringify(config)}\n${printf}`], { encoding: 'utf8' });
  assert.equal(generated.status, 0, generated.stderr);
  const create = () => {
    const result = spawnSync('systemd-tmpfiles', ['--root', root, '--create', config], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  };
  create();
  const lock = join(root, 'run/dashboard-portal-maintenance/operations.lock');
  const info = await stat(lock);
  assert.equal(info.mode & 0o777, 0o660);
  assert.equal(info.uid, 0);
  assert.equal((await stat(join(root, 'run/dashboard-portal-maintenance'))).mode & 0o777, 0o750);
  await writeFile(lock, 'live inode sentinel');
  create();
  const held = spawnSync('bash', ['-c', 'exec 9<>"$1"; flock --exclusive 9; systemd-tmpfiles --root "$2" --create "$3" || exit 90; flock --exclusive --nonblock --conflict-exit-code 75 "$1" /bin/true; [[ "$?" == 75 ]]', 'tmpfiles-lock-check', lock, root, config], { encoding: 'utf8' });
  assert.equal(held.status, 0, held.stderr);
  assert.equal((await stat(lock)).ino, info.ino);
  assert.equal(await readFile(lock, 'utf8'), 'live inode sentinel');
  assert.match(source, /After=systemd-tmpfiles-setup\.service/g);
});
