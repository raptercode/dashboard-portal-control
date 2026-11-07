#!/usr/bin/env bash
# Direct installer for one Ubuntu 24.04 or 25.04 host. It intentionally refuses an
# HTTP-only installation: this service has a login and must not expose it over
# cleartext traffic.
set -Eeuo pipefail
IFS=$'\n\t'
umask 077

DOMAIN=''
EMAIL=''
PORTAL_NODE_MAJOR=''
for arg in "$@"; do
  case "$arg" in
    --domain=*) DOMAIN="${arg#*=}" ;;
    --email=*) EMAIL="${arg#*=}" ;;
    --node-major=*) PORTAL_NODE_MAJOR="${arg#*=}" ;;
    *) echo 'Usage: sudo ./strckro.sh --domain=portal.example.com --email=admin@example.com [--node-major=20|22|24|26]' >&2; exit 64 ;;
  esac
done

APP_USER='dashboardportal'
APP_ROOT='/opt/dashboard-portal'
DATA_ROOT='/var/lib/dashboard-portal'
CONFIG_ROOT='/etc/dashboard-portal'
BACKUP_ROOT='/var/backups/dashboard-portal'
SERVICE_FILE='/etc/systemd/system/dashboard-portal.service'
HELPER_SERVICE_FILE='/etc/systemd/system/hostmgr-deploy-helper.service'
HELPER_ROOT='/usr/local/lib/dashboard-portal'
HELPER_SCRIPT='/usr/local/lib/dashboard-portal/hostmgr-deploy-helper.mjs'
PASSWORD_SCRIPT='/usr/local/lib/dashboard-portal/password-config.mjs'
UPDATE_SCRIPT='/usr/local/lib/dashboard-portal/strckro-update.mjs'
UPDATE_LIBRARY='/usr/local/lib/dashboard-portal/software-update.mjs'
UPDATE_COMMAND='/usr/local/sbin/strckro'
# The command was called dashboard-portal before the Strckro name; it is removed on install.
LEGACY_UPDATE_COMMAND='/usr/local/sbin/dashboard-portal'
CLI_INFO_ROOT='/usr/local/share/dashboard-portal'
CLI_INFO_SCRIPT='/usr/local/share/dashboard-portal/cli-info.mjs'
UPDATE_PUBLIC_KEY_SOURCE='scripts/dashboard-portal-update-public.pem'
UPDATE_PUBLIC_KEY_FILE='/etc/dashboard-portal/update-public-key.pem'
DEFAULT_UPDATE_MANIFEST_URL='https://github.com/raptercode/dashboard-portal-control/releases/latest/download/stable.json'
DEFAULT_UPDATE_CHANNEL='stable'
HELPER_SOCKET='/run/dashboard-portal/deploy-helper.sock'
MAINTENANCE_ROOT='/run/dashboard-portal-maintenance'
MAINTENANCE_LOCK='/run/dashboard-portal-maintenance/operations.lock'
MAINTENANCE_TMPFILES='/etc/tmpfiles.d/dashboard-portal-maintenance.conf'
NGINX_SITE='/etc/nginx/sites-available/dashboard-portal'
NGINX_ENABLED='/etc/nginx/sites-enabled/dashboard-portal'
NGINX_DEFAULT_ENABLED='/etc/nginx/sites-enabled/default'
NGINX_CATCHALL_SITE='/etc/nginx/sites-available/hostmgr-unmatched.conf'
NGINX_CATCHALL_ENABLED='/etc/nginx/sites-enabled/hostmgr-unmatched.conf'
# http-level: lets Nginx report the visitor's address when Cloudflare Proxy is in front.
NGINX_REALIP_CONF='/etc/nginx/conf.d/strckro-realip.conf'
# Root-only (0600): holds the secret Nginx stamps on proxied requests so the portal
# can tell Nginx from any other process on this host. Never put it in the site file.
NGINX_PROXY_SNIPPET='/etc/nginx/snippets/strckro-proxy.conf'
# http-level: the request-rate zone the portal site applies, so one address cannot flood the API.
NGINX_LIMITS_CONF='/etc/nginx/conf.d/strckro-limits.conf'
# Where pinned Node.js runtimes live and what may still point at them (overridden only by tests).
NODE_RUNTIME_ROOT='/opt'
SERVICE_UNIT_DIR='/etc/systemd/system'
PROJECT_CONFIG_DIR='/etc/hostmgr'
PROC_DIR='/proc'
PORT='3100'
NODE_VERSION='24.22.2'
NODE_SHA256='48cc0e21e048790e54c0cf5749c2725005313d652651c40b7a21feb9697aaf75'
BUN_VERSION='1.3.13'
BUN_SHA256='9d8a24292a7068090205daac0a5a223f5f69736f5287e37bf88d3b4031edc750'
GO_VERSION='1.27.1'
GO_SHA256='63d339f0da5ab53635a56f2490a7984dfe12dfcff22ad749f63edaf590168445'

TMP_DIR=''
BACKUP_DIR=''
ROLLBACK_ARMED=false
SNAPSHOTS_READY=false
PREVIOUS_SERVICE_ACTIVE=false
PREVIOUS_SERVICE_ENABLED=false
PREVIOUS_HELPER_ACTIVE=false
PREVIOUS_HELPER_ENABLED=false

die() { echo "ERROR: $*" >&2; exit 1; }

set_config_value() {
  local key="$1" value="$2" file="$3"
  if grep -q "^${key}=" "$file"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >> "$file"
  fi
}

cleanup() {
  if [[ -n "$TMP_DIR" && -d "$TMP_DIR" ]]; then rm -rf -- "$TMP_DIR"; fi
}

backup_item() {
  local label="$1" path="$2"
  mkdir -p "$BACKUP_DIR/$label"
  if [[ -e "$path" || -L "$path" ]]; then
    mkdir -p "$BACKUP_DIR/$label"
    cp -a --no-dereference "$path" "$BACKUP_DIR/$label/original"
    : > "$BACKUP_DIR/$label/present"
  fi
  : > "$BACKUP_DIR/$label/complete"
}

restore_item() {
  local label="$1" path="$2"
  [[ -f "$BACKUP_DIR/$label/complete" ]] || return 0
  rm -rf -- "$path"
  if [[ -f "$BACKUP_DIR/$label/present" ]]; then
    cp -a --no-dereference "$BACKUP_DIR/$label/original" "$path"
  fi
}

rollback() {
  local code="$1"
  trap - EXIT ERR INT TERM
  set +e
  if [[ "$code" -ne 0 && "$ROLLBACK_ARMED" == true ]]; then
    echo "Installation failed; restoring Strckro files from $BACKUP_DIR" >&2
    systemctl disable --now dashboard-portal.service >/dev/null 2>&1 || true
    systemctl disable --now hostmgr-deploy-helper.service >/dev/null 2>&1 || true
    if [[ "$SNAPSHOTS_READY" == true ]]; then
    restore_item service "$SERVICE_FILE"
    restore_item helper-service "$HELPER_SERVICE_FILE"
    restore_item maintenance-tmpfiles "$MAINTENANCE_TMPFILES"
    restore_item helper-root "$HELPER_ROOT"
    restore_item cli-info-root "$CLI_INFO_ROOT"
    restore_item update-command "$UPDATE_COMMAND"
    restore_item legacy-command "$LEGACY_UPDATE_COMMAND"
    restore_item nginx-site "$NGINX_SITE"
    restore_item nginx-enabled "$NGINX_ENABLED"
    restore_item nginx-default-enabled "$NGINX_DEFAULT_ENABLED"
    restore_item nginx-catchall-site "$NGINX_CATCHALL_SITE"
    restore_item nginx-catchall-enabled "$NGINX_CATCHALL_ENABLED"
    restore_item nginx-realip "$NGINX_REALIP_CONF"
    restore_item nginx-limits "$NGINX_LIMITS_CONF"
    restore_item nginx-proxy-snippet "$NGINX_PROXY_SNIPPET"
    restore_item app-root "$APP_ROOT"
    restore_item config "$CONFIG_ROOT"
    restore_item state-db "$DATA_ROOT/state.sqlite"
    restore_item state-db-wal "$DATA_ROOT/state.sqlite-wal"
    restore_item state-db-shm "$DATA_ROOT/state.sqlite-shm"
    fi
    systemctl daemon-reload >/dev/null 2>&1 || true
    if [[ "$PREVIOUS_HELPER_ENABLED" == true ]]; then
      systemctl enable hostmgr-deploy-helper.service >/dev/null 2>&1 || true
    fi
    if [[ "$PREVIOUS_HELPER_ACTIVE" == true ]]; then
      systemctl restart hostmgr-deploy-helper.service >/dev/null 2>&1 || true
    fi
    if [[ "$PREVIOUS_SERVICE_ENABLED" == true ]]; then
      systemctl enable dashboard-portal.service >/dev/null 2>&1 || true
    fi
    if [[ "$PREVIOUS_SERVICE_ACTIVE" == true ]]; then
      systemctl restart dashboard-portal.service >/dev/null 2>&1 || true
    fi
    nginx -t >/dev/null 2>&1 && systemctl reload nginx >/dev/null 2>&1 || true
    echo 'Package installation and a successfully issued TLS certificate are not rolled back automatically.' >&2
  fi
  cleanup
  exit "$code"
}
trap 'rollback "$?"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

[[ $EUID -eq 0 ]] || die 'Run with sudo.'
if [[ -z "$PORTAL_NODE_MAJOR" ]]; then
  if [[ -f "$CONFIG_ROOT/dashboard-portal.env" ]]; then
    PORTAL_NODE_MAJOR="$(sed -n 's/^HOSTMGR_NODE_MAJOR=//p' "$CONFIG_ROOT/dashboard-portal.env")"
  fi
  if [[ -z "$PORTAL_NODE_MAJOR" && -f "$APP_ROOT/package.json" ]]; then
    portal_pid="$(systemctl show dashboard-portal.service --property=MainPID --value 2>/dev/null || true)"
    current_node='/usr/local/bin/node'
    if [[ "$portal_pid" =~ ^[1-9][0-9]*$ && -x "/proc/$portal_pid/exe" ]]; then current_node="/proc/$portal_pid/exe"; fi
    current_version="$("$current_node" --version)" || die 'Cannot detect the installed Portal Node.js major. Specify --node-major explicitly.'
    [[ "$current_version" =~ ^v([0-9]+)\. ]] || die 'Cannot parse the installed Portal Node.js version.'
    PORTAL_NODE_MAJOR="${BASH_REMATCH[1]}"
  fi
  PORTAL_NODE_MAJOR="${PORTAL_NODE_MAJOR:-24}"
fi
[[ "$PORTAL_NODE_MAJOR" =~ ^(20|22|24|26)$ ]] || die 'Portal Node.js major must be 20, 22, 24 or 26.'
[[ -n "$DOMAIN" && "$DOMAIN" =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$ ]] || die 'A lower-case FQDN is required in --domain.'
[[ -n "$EMAIL" && "$EMAIL" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]] || die 'A valid --email is required. HTTPS is mandatory for a public login.'
[[ -f package.json && -f package-lock.json && -d src && -d public && -f scripts/hostmgr-deploy-helper.mjs && -f scripts/sqlite.mjs && -f scripts/node-versions.mjs && -f scripts/maintenance-lock.mjs && -f scripts/worker-health.mjs && -f scripts/worker-activation.mjs && -f scripts/mail-host-config.mjs && -f scripts/nginx-edge.mjs && -f scripts/domain-dns.mjs && -f scripts/nginx-realip.mjs &&-f scripts/password-config.mjs && -f scripts/strckro-update.mjs && -f scripts/software-update.mjs && -f "$UPDATE_PUBLIC_KEY_SOURCE" ]] || die 'Run this script from an extracted Strckro release directory.'
source /etc/os-release
[[ "${ID:-}" == 'ubuntu' && ( "${VERSION_ID:-}" == '24.04' || "${VERSION_ID:-}" == '25.04' ) ]] || die 'This installer supports Ubuntu 24.04 or 25.04 only.'
[[ "$(dpkg --print-architecture)" == 'amd64' ]] || die 'This release currently supports amd64 only.'

# DNS must already exist before Certbot starts. This proves only name
# resolution; firewall and inbound routing are checked by the ACME challenge.
mapfile -t DNS_ADDRESSES < <(getent ahosts "$DOMAIN" | awk '{print $1}' | sort -u)
(( ${#DNS_ADDRESSES[@]} > 0 )) || die "DNS for $DOMAIN does not resolve on this host. Create its A/AAAA record and wait for propagation."
printf 'DNS preflight: %s resolves to %s\n' "$DOMAIN" "${DNS_ADDRESSES[*]}"

TMP_DIR="$(mktemp -d /tmp/dashboard-portal.XXXXXX)"
BACKUP_DIR="${BACKUP_ROOT}/install-$(date -u +%Y%m%dT%H%M%SZ)"
install -d -m 0700 -o root -g root "$BACKUP_DIR"
# Use a stable inode outside the helper RuntimeDirectory, which disappears when
# that service stops. Existing participating operations hold shared leases.
if ! id -u "$APP_USER" >/dev/null 2>&1; then
  useradd --system --create-home --home-dir "$DATA_ROOT" --shell /usr/sbin/nologin "$APP_USER"
fi
command -v flock >/dev/null || die 'flock is required for installer maintenance exclusion.'
[[ ! -L "$MAINTENANCE_ROOT" && ! -L "$MAINTENANCE_LOCK" ]] || die 'Maintenance paths must not be symbolic links.'
if [[ -e "$MAINTENANCE_ROOT" ]]; then
  [[ -d "$MAINTENANCE_ROOT" && "$(stat -c %u "$MAINTENANCE_ROOT")" == 0 ]] || die 'Maintenance directory must be root-owned.'
  (( (8#$(stat -c %a "$MAINTENANCE_ROOT") & 8#022) == 0 )) || die 'Maintenance directory must not be writable by group or others.'
fi
install -d -m 0750 -o root -g "$APP_USER" "$MAINTENANCE_ROOT"
if [[ -e "$MAINTENANCE_LOCK" ]]; then
  [[ -f "$MAINTENANCE_LOCK" && "$(stat -c %u "$MAINTENANCE_LOCK")" == 0 && "$(stat -c %h "$MAINTENANCE_LOCK")" == 1 ]] || die 'Maintenance lock must be a root-owned regular file without hard links.'
  (( (8#$(stat -c %a "$MAINTENANCE_LOCK") & 8#007) == 0 )) || die 'Maintenance lock must not be accessible to unrelated users.'
else
  (set -o noclobber; : > "$MAINTENANCE_LOCK")
fi
chown "root:$APP_USER" "$MAINTENANCE_LOCK"
chmod 0660 "$MAINTENANCE_LOCK"
exec 9<>"$MAINTENANCE_LOCK"
flock --exclusive --nonblock 9 || die 'Portal host operations are active; retry installation after they finish.'
if systemctl is-active --quiet dashboard-portal.service; then PREVIOUS_SERVICE_ACTIVE=true; fi
if systemctl is-enabled --quiet dashboard-portal.service; then PREVIOUS_SERVICE_ENABLED=true; fi
if systemctl is-active --quiet hostmgr-deploy-helper.service; then PREVIOUS_HELPER_ACTIVE=true; fi
if systemctl is-enabled --quiet hostmgr-deploy-helper.service; then PREVIOUS_HELPER_ENABLED=true; fi
ROLLBACK_ARMED=true
# Maintenance must begin with no in-flight deploy/tool/mail operations. Stopping
# services prevents new writers, but is not a drain protocol for existing work.
# Snapshot SQLite only after both services have stopped successfully.
if [[ "$PREVIOUS_SERVICE_ACTIVE" == true || -f "$SERVICE_FILE" ]]; then systemctl stop dashboard-portal.service; fi
if [[ "$PREVIOUS_HELPER_ACTIVE" == true || -f "$HELPER_SERVICE_FILE" ]]; then systemctl stop hostmgr-deploy-helper.service; fi
if systemctl is-active --quiet dashboard-portal.service || systemctl is-active --quiet hostmgr-deploy-helper.service; then
  die 'Portal and helper must be stopped before taking the state snapshot.'
fi
backup_item service "$SERVICE_FILE"
backup_item helper-service "$HELPER_SERVICE_FILE"
backup_item maintenance-tmpfiles "$MAINTENANCE_TMPFILES"
backup_item helper-root "$HELPER_ROOT"
backup_item cli-info-root "$CLI_INFO_ROOT"
backup_item update-command "$UPDATE_COMMAND"
backup_item legacy-command "$LEGACY_UPDATE_COMMAND"
backup_item nginx-site "$NGINX_SITE"
backup_item nginx-enabled "$NGINX_ENABLED"
backup_item nginx-default-enabled "$NGINX_DEFAULT_ENABLED"
backup_item nginx-catchall-site "$NGINX_CATCHALL_SITE"
backup_item nginx-catchall-enabled "$NGINX_CATCHALL_ENABLED"
backup_item nginx-realip "$NGINX_REALIP_CONF"
backup_item nginx-limits "$NGINX_LIMITS_CONF"
backup_item nginx-proxy-snippet "$NGINX_PROXY_SNIPPET"
backup_item app-root "$APP_ROOT"
backup_item config "$CONFIG_ROOT"
backup_item state-db "$DATA_ROOT/state.sqlite"
backup_item state-db-wal "$DATA_ROOT/state.sqlite-wal"
backup_item state-db-shm "$DATA_ROOT/state.sqlite-shm"
SNAPSHOTS_READY=true

# /run is cleared at boot. tmpfiles creates the lock without truncating an
# existing inode; never replace or remove this inode while leases may exist.
install -d -m 0755 -o root -g root /etc/tmpfiles.d
printf 'd %s 0750 root %s -\nf %s 0660 root %s -\n' "$MAINTENANCE_ROOT" "$APP_USER" "$MAINTENANCE_LOCK" "$APP_USER" > "$MAINTENANCE_TMPFILES"
chown root:root "$MAINTENANCE_TMPFILES"
chmod 0644 "$MAINTENANCE_TMPFILES"
systemd-tmpfiles --create "$MAINTENANCE_TMPFILES"

export DEBIAN_FRONTEND=noninteractive
# apt drops signature verification to the unprivileged `_apt` user and needs a
# conventional sticky temporary directory. Do not allow a restrictive umask or
# prior deployment to leave `/tmp` inaccessible to package verification.
chmod 1777 /tmp
apt-get update
apt-get install -y --no-install-recommends nginx certbot python3-certbot-nginx curl ca-certificates xz-utils unzip git
if [[ "$PORTAL_NODE_MAJOR" == '20' ]]; then
  apt-get install -y --no-install-recommends build-essential python3
  echo 'WARNING: Node.js 20 is end of life and the October 2026 Node.js security release has no 20.x build. Move the Portal to Node.js 24 when you can (--node-major=24, after a backup).' >&2
fi
# libatomic1 is needed by any provisioned Node.js 26, not only a Portal running on it.
if [[ "$PORTAL_NODE_MAJOR" == '26' ]] || compgen -G '/opt/node-v26.*' >/dev/null; then apt-get install -y --no-install-recommends libatomic1; fi

# Pinned Linux x64 runtimes. Checksums come from the signed SHASUMS256.txt of each
# release on nodejs.org; scripts/node-versions.mjs must name the same versions
# (a test compares them).
node_pin() {
  case "$1" in
    20) NODE_PIN_VERSION='20.20.2'; NODE_PIN_SHA='df770b2a6f130ed8627c9782c988fda9669fa23898329a61a871e32f965e007d' ;;
    22) NODE_PIN_VERSION='22.23.4'; NODE_PIN_SHA='1805bcd35e6815559bd2eb97db438d3fdb0eb3a5e6a977b7c1badca76337e9ce' ;;
    24) NODE_PIN_VERSION="$NODE_VERSION"; NODE_PIN_SHA="$NODE_SHA256" ;;
    26) NODE_PIN_VERSION='26.13.0'; NODE_PIN_SHA='d28a96af6c38596f6d9d97c0ee531c13d238d757742387d1928de822d959e997' ;;
    *) die "Unsupported Node.js major: $1" ;;
  esac
}

install_node_version() {
  local major="$1" version sha archive target
  node_pin "$major"
  version="$NODE_PIN_VERSION"; sha="$NODE_PIN_SHA"
  target="/opt/node-v${version}"
  if [[ ! -x "$target/bin/node" ]]; then
    archive="node-v${version}-linux-x64.tar.xz"
    curl --fail --location --proto '=https' --tlsv1.2 --silent --show-error \
      "https://nodejs.org/dist/v${version}/${archive}" -o "$TMP_DIR/$archive"
    printf '%s  %s\n' "$sha" "$TMP_DIR/$archive" | sha256sum --check --status || die "Node.js ${version} archive checksum verification failed."
    install -d -m 0755 "$target"
    tar --extract --xz --file "$TMP_DIR/$archive" --directory "$target" --strip-components=1 --no-same-owner
  fi
  "$target/bin/node" --version | grep -qx "v${version}" || die "Node.js ${version} installation is incomplete."
  [[ -x "$target/bin/npm" ]] || die "Node.js ${version} installation is missing npm."
}
# A project service names /opt/node-v<version>, so a new pin would leave every project
# on another major without a runtime until it was provisioned by hand. Only the
# Portal's own major is required. Other majors already present on this host move to
# their pinned release too, but a failure there is reported and leaves the existing
# runtime in place, so an unused or broken runtime never blocks a Portal update.
# Old /opt/node-v<version> directories stay for services activated against them.
provision_node_runtimes() {
  local other output status
  install_node_version "$PORTAL_NODE_MAJOR"
  for other in 20 22 24 26; do
    if [[ "$other" != "$PORTAL_NODE_MAJOR" ]] && compgen -G "/opt/node-v${other}.*" >/dev/null; then
      set +e
      output="$(set -e; install_node_version "$other" 2>&1)"
      status=$?
      set -e
      if [[ "$status" -ne 0 ]]; then
        echo "WARNING: Node.js ${other} is provisioned on this host but could not be moved to its pinned release; it keeps the runtime it has. ${output}" >&2
      fi
    fi
  done
}

# True when a running process has its executable or working directory at or inside $1. If /proc
# cannot be read there is no way to tell, and the answer that can lose nothing is "in use".
node_runtime_in_use() {
  [[ -d "$PROC_DIR/self" ]] || return 0
  [[ -n "$(find "$PROC_DIR" -maxdepth 2 \( -name exe -o -name cwd \) \( -lname "$1" -o -lname "$1/*" \) -print -quit 2>/dev/null)" ]]
}

# True when every entry of directory $1 (hidden ones included) is one of the names that follow.
only_entries() {
  local dir="$1" entry name allowed
  shift
  while IFS= read -r entry; do
    [[ -n "$entry" ]] || continue
    allowed=false
    for name in "$@"; do [[ "$entry" == "$name" ]] && allowed=true; done
    [[ "$allowed" == true ]] || return 1
  done < <(find "$dir" -mindepth 1 -maxdepth 1 -printf '%f\n' 2>/dev/null)
}

# True only for a directory that is exactly what the Node.js archive unpacks to: a node binary and
# npm are there; the top level, bin, lib, lib/node_modules, share and include hold nothing but the
# names that archive uses. Anything an administrator added (a global package such as pm2 or pnpm,
# etc/npmrc from `npm config set -g`, an application, a dotfile) makes the directory theirs, not ours.
node_runtime_pristine() {
  local dir="$1"
  [[ -f "$dir/bin/node" && -d "$dir/lib/node_modules/npm" ]] || return 1
  only_entries "$dir" CHANGELOG.md LICENSE README.md bin include lib share || return 1
  only_entries "$dir/bin" node npm npx corepack || return 1
  only_entries "$dir/lib" node_modules || return 1
  only_entries "$dir/lib/node_modules" npm corepack || return 1
  [[ ! -e "$dir/share" ]] || only_entries "$dir/share" doc man systemtap || return 1
  [[ ! -e "$dir/include" ]] || only_entries "$dir/include" node || return 1
}

# Delete a managed Node.js runtime directory once it is out of date and nothing uses it, so
# superseded builds, which carry known security fixes they lack, do not linger. Every condition must hold:
#  - the name is exactly node-v<major>.<minor>.<patch> for a supported major, and not a link;
#  - it is OLDER than that major's pin (a newer one was put there by someone else);
#  - it is pristine: nothing was installed into it afterwards;
#  - the pinned release of that major is installed and runs, so the major is never left without a runtime;
#  - no unit or project configuration names it (a project on a non-24 major keeps the path it
#    was activated with until its next deployment) and no process runs from it.
# A runtime still in use is kept and reconsidered on the next update. Failing to delete one is never fatal.
# Anything of your own that points into an old /opt/node-v<version> (a cron line, a wrapper
# script) is not something this can see: keep such things outside those directories.
prune_node_runtimes() {
  local dir version major
  for dir in "$NODE_RUNTIME_ROOT"/node-v*; do
    [[ -d "$dir" && ! -L "$dir" ]] || continue
    version="${dir##*/node-v}"
    [[ "$version" =~ ^(20|22|24|26)\.[0-9]+\.[0-9]+$ ]] || continue
    major="${BASH_REMATCH[1]}"
    node_pin "$major"
    [[ "$version" != "$NODE_PIN_VERSION" && "$(printf '%s\n%s\n' "$version" "$NODE_PIN_VERSION" | sort -V | head -n 1)" == "$version" ]] || continue
    node_runtime_pristine "$dir" || continue
    "$NODE_RUNTIME_ROOT/node-v${NODE_PIN_VERSION}/bin/node" --version 2>/dev/null | grep -qx "v${NODE_PIN_VERSION}" || continue
    # -R, not -r: a unit added with `systemctl link` is a symbolic link in this directory.
    if grep -RqF -- "$dir/" "$SERVICE_UNIT_DIR" "$PROJECT_CONFIG_DIR" 2>/dev/null; then continue; fi
    if node_runtime_in_use "$dir"; then continue; fi
    if rm -rf -- "$dir"; then echo "Removed the unused Node.js runtime $dir"; else echo "WARNING: could not remove the unused Node.js runtime $dir" >&2; fi
  done
  return 0
}
provision_node_runtimes
node_pin "$PORTAL_NODE_MAJOR"
PORTAL_NODE="/opt/node-v${NODE_PIN_VERSION}/bin/node"
PORTAL_NPM="/opt/node-v${NODE_PIN_VERSION}/bin/npm"
# Keep the complete pinned Node distribution on PATH. A node-only symlink
# cannot execute the reproducible npm-based project deployment contract.
for node_tool in node npm npx; do
  [[ -x "$(dirname "$PORTAL_NODE")/${node_tool}" ]] || die "Selected Node.js distribution is missing ${node_tool}."
  ln -sfn "$(dirname "$PORTAL_NODE")/${node_tool}" "/usr/local/bin/${node_tool}"
done
if [[ -x "$(dirname "$PORTAL_NODE")/corepack" ]]; then ln -sfn "$(dirname "$PORTAL_NODE")/corepack" /usr/local/bin/corepack; fi
[[ "$(/usr/local/bin/node --version)" == "$("$PORTAL_NODE" --version)" ]] || die 'Installed Node.js version did not match the selected runtime.'
"/usr/local/bin/npm" --version >/dev/null || die 'Installed Node.js npm runtime could not be executed.'

# Bun is a project runtime, not a dependency of Strckro itself. Pin
# and verify the baseline x64 binary so projects can safely select it after a
# fresh install or an ordinary Portal update.
if [[ ! -x "/opt/bun-v${BUN_VERSION}/bin/bun" ]]; then
  bun_archive="bun-linux-x64-baseline.zip"
  curl --fail --location --proto '=https' --tlsv1.2 --silent --show-error \
    "https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/${bun_archive}" -o "$TMP_DIR/$bun_archive"
  printf '%s  %s\n' "$BUN_SHA256" "$TMP_DIR/$bun_archive" | sha256sum --check --status || die 'Bun archive checksum verification failed.'
  unzip -q "$TMP_DIR/$bun_archive" -d "$TMP_DIR/bun"
  [[ -x "$TMP_DIR/bun/bun-linux-x64-baseline/bun" ]] || die 'Bun archive did not contain the expected executable.'
  install -d -m 0755 "/opt/bun-v${BUN_VERSION}/bin"
  install -m 0755 "$TMP_DIR/bun/bun-linux-x64-baseline/bun" "/opt/bun-v${BUN_VERSION}/bin/bun"
fi
ln -sfn "/opt/bun-v${BUN_VERSION}/bin/bun" /usr/local/bin/bun
"/usr/local/bin/bun" --version | grep -qx "${BUN_VERSION}" || die 'Installed Bun version did not match the pinned release.'

# Validate a staged release before replacing the live application files.
STAGING_ROOT="$TMP_DIR/app"
install -d -m 0755 "$STAGING_ROOT"
tar --exclude='.env' --exclude='data' --exclude='node_modules' --exclude='.git' --exclude='dist' --exclude='release-out' -cf - . | tar -xf - -C "$STAGING_ROOT"
"$PORTAL_NODE" --check "$STAGING_ROOT/src/server.mjs"
"$PORTAL_NODE" --check "$STAGING_ROOT/scripts/mail-host-config.mjs"
while IFS= read -r -d '' ui_module; do
  "$PORTAL_NODE" --check "$ui_module"
done < <(find "$STAGING_ROOT/public/ui" -type f -name '*.js' -print0)
if [[ "$PORTAL_NODE_MAJOR" == '20' ]]; then
  [[ -f "$STAGING_ROOT/package-lock.json" ]] || die 'Node 20 requires the committed package-lock.json for its SQLite adapter.'
  (cd "$STAGING_ROOT" && PATH="$(dirname "$PORTAL_NODE"):$PATH" "$PORTAL_NPM" ci --omit=dev --no-audit --no-fund)
  (cd "$STAGING_ROOT" && "$PORTAL_NODE" -e "import('./scripts/sqlite.mjs').then(({DatabaseSync}) => new DatabaseSync(':memory:').close())") || die 'Node 20 SQLite adapter preflight failed.'
  chmod -R a+rX "$STAGING_ROOT/node_modules"
fi

rm -rf -- "$APP_ROOT"
mv "$STAGING_ROOT" "$APP_ROOT"
chown -R root:root "$APP_ROOT"
# The service runs as dashboardportal, so this root must be traversable even
# when the updater extracted its staging directory with a restrictive umask.
chmod 0755 "$APP_ROOT"
chmod -R go-w "$APP_ROOT"
install -d -m 0750 -o root -g root "$HELPER_ROOT"
install -m 0750 -o root -g root "$APP_ROOT/scripts/hostmgr-deploy-helper.mjs" "$HELPER_SCRIPT"
install -m 0644 -o root -g root "$APP_ROOT/scripts/sqlite.mjs" "$HELPER_ROOT/sqlite.mjs"
install -m 0644 -o root -g root "$APP_ROOT/scripts/node-versions.mjs" "$HELPER_ROOT/node-versions.mjs"
install -m 0644 -o root -g root "$APP_ROOT/scripts/node-package-manager.mjs" "$HELPER_ROOT/node-package-manager.mjs"
install -m 0644 -o root -g root "$APP_ROOT/scripts/maintenance-lock.mjs" "$HELPER_ROOT/maintenance-lock.mjs"
install -m 0750 -o root -g root "$APP_ROOT/scripts/worker-health.mjs" "$HELPER_ROOT/worker-health.mjs"
install -m 0750 -o root -g root "$APP_ROOT/scripts/worker-activation.mjs" "$HELPER_ROOT/worker-activation.mjs"
if [[ "$PORTAL_NODE_MAJOR" == '20' ]]; then ln -sfn "$APP_ROOT/node_modules" "$HELPER_ROOT/node_modules"; fi
install -m 0750 -o root -g root "$APP_ROOT/scripts/python-project.mjs" "$HELPER_ROOT/python-project.mjs"
install -m 0750 -o root -g root "$APP_ROOT/scripts/php-project.mjs" "$HELPER_ROOT/php-project.mjs"
install -m 0750 -o root -g root "$APP_ROOT/scripts/project-service-user.mjs" "$HELPER_ROOT/project-service-user.mjs"
install -m 0750 -o root -g root "$APP_ROOT/scripts/mail-host-config.mjs" "$HELPER_ROOT/mail-host-config.mjs"
install -m 0750 -o root -g root "$APP_ROOT/scripts/nginx-edge.mjs" "$HELPER_ROOT/nginx-edge.mjs"
install -m 0644 -o root -g root "$APP_ROOT/scripts/domain-dns.mjs" "$HELPER_ROOT/domain-dns.mjs"
install -m 0644 -o root -g root "$APP_ROOT/scripts/nginx-realip.mjs" "$HELPER_ROOT/nginx-realip.mjs"
install -m 0750 -o root -g root "$APP_ROOT/scripts/password-config.mjs" "$PASSWORD_SCRIPT"
install -m 0750 -o root -g root "$APP_ROOT/scripts/strckro-update.mjs" "$UPDATE_SCRIPT"
install -m 0644 -o root -g root "$APP_ROOT/scripts/software-update.mjs" "$UPDATE_LIBRARY"
install -d -m 0755 -o root -g root "$CLI_INFO_ROOT"
install -m 0644 -o root -g root "$APP_ROOT/scripts/cli-info.mjs" "$CLI_INFO_SCRIPT"
install -m 0644 -o root -g root "$APP_ROOT/scripts/node-versions.mjs" "$CLI_INFO_ROOT/node-versions.mjs"
install -m 0644 -o root -g root "$APP_ROOT/scripts/node-package-manager.mjs" "$CLI_INFO_ROOT/node-package-manager.mjs"
cat > "$UPDATE_COMMAND" <<EOF
#!/usr/bin/env bash
case "\${1:-}" in
  ''|-h|--help|-v|--version|--versions) exec ${PORTAL_NODE} ${CLI_INFO_SCRIPT} "\$@" ;;
  update|configure-update|--reset-pwd)
    if [[ "\${2:-}" == '-h' || "\${2:-}" == '--help' ]]; then exec ${PORTAL_NODE} ${CLI_INFO_SCRIPT} "\$@"; fi ;;
esac
if [[ "\${1:-}" == '--reset-pwd' ]]; then
  shift
  exec ${PORTAL_NODE} ${PASSWORD_SCRIPT} --reset-pwd "\$@"
fi
exec ${PORTAL_NODE} ${UPDATE_SCRIPT} "\$@"
EOF
chown root:root "$UPDATE_COMMAND"
chmod 0755 "$UPDATE_COMMAND"
# Remove what the old name left behind: the command and its update script.
rm -f -- "$LEGACY_UPDATE_COMMAND" "$HELPER_ROOT/dashboard-portal-update.mjs"

install -d -m 0700 -o "$APP_USER" -g "$APP_USER" "$DATA_ROOT" "$DATA_ROOT/projects"
install -d -m 0750 -o root -g "$APP_USER" "$CONFIG_ROOT"
install -d -m 0750 -o root -g root /etc/hostmgr /etc/hostmgr/projects
# Services need only traverse these parents to reach their own project or the
# ACME webroot.  Do not grant directory listing to unrelated local users.
install -d -m 0711 -o root -g root /var/lib/hostmgr /srv/hostmgr /srv/hostmgr/projects
install -d -m 0755 -o root -g root /var/lib/hostmgr/acme
if [[ ! -f "$CONFIG_ROOT/dashboard-portal.env" ]]; then
  read -r -s -p 'Choose the Strckro owner password (at least 12 characters): ' ADMIN_PASSWORD; echo
  [[ ${#ADMIN_PASSWORD} -ge 12 ]] || die 'Password must be at least 12 characters.'
  [[ "$ADMIN_PASSWORD" != *$'\n'* && "$ADMIN_PASSWORD" != *$'\r'* ]] || die 'Password must not contain a line break.'
  SECRET_KEY="$(/usr/local/bin/node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")"
  ADMIN_PASSWORD_B64="$(printf %s "$ADMIN_PASSWORD" | base64 -w 0)"
  cat > "$CONFIG_ROOT/dashboard-portal.env" <<EOF
HOSTMGR_ADMIN_PASSWORD_B64=${ADMIN_PASSWORD_B64}
HOSTMGR_SECRET_KEY=${SECRET_KEY}
HOSTMGR_MODE=host
HOSTMGR_DATABASE_PATH=${DATA_ROOT}/state.sqlite
HOSTMGR_PROJECT_ROOT=${DATA_ROOT}/projects
HOSTMGR_BIND_ADDRESS=127.0.0.1
HOSTMGR_SECURE_COOKIE=true
HOSTMGR_ACME_EMAIL=${EMAIL}
HOSTMGR_PORTAL_DOMAIN=${DOMAIN}
HOSTMGR_DEPLOY_HELPER_SOCKET=${HELPER_SOCKET}
PORT=${PORT}
EOF
  unset ADMIN_PASSWORD ADMIN_PASSWORD_B64 SECRET_KEY
fi
set_config_value HOSTMGR_ACME_EMAIL "$EMAIL" "$CONFIG_ROOT/dashboard-portal.env"
set_config_value HOSTMGR_PORTAL_DOMAIN "$DOMAIN" "$CONFIG_ROOT/dashboard-portal.env"
set_config_value HOSTMGR_DEPLOY_HELPER_SOCKET "$HELPER_SOCKET" "$CONFIG_ROOT/dashboard-portal.env"
set_config_value HOSTMGR_DATABASE_PATH "$DATA_ROOT/state.sqlite" "$CONFIG_ROOT/dashboard-portal.env"
set_config_value HOSTMGR_NODE_MAJOR "$PORTAL_NODE_MAJOR" "$CONFIG_ROOT/dashboard-portal.env"
# The portal believes the visitor address Nginx forwards only together with this
# secret. Keep an existing one across updates; replace a missing or weak one.
if ! grep -qE '^HOSTMGR_PROXY_TOKEN=[A-Za-z0-9_-]{32,128}$' "$CONFIG_ROOT/dashboard-portal.env"; then
  set_config_value HOSTMGR_PROXY_TOKEN "$(/usr/local/bin/node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")" "$CONFIG_ROOT/dashboard-portal.env"
fi
PROXY_TOKEN="$(sed -n 's/^HOSTMGR_PROXY_TOKEN=//p' "$CONFIG_ROOT/dashboard-portal.env")"
[[ "$PROXY_TOKEN" =~ ^[A-Za-z0-9_-]{32,128}$ ]] || die 'The proxy token could not be created.'
# A normal installation is enrolled in the signed stable channel immediately.
# Preserve an existing custom feed so an intentional self-hosted release setup
# does not get silently replaced during a later Portal update.
if ! grep -q '^HOSTMGR_UPDATE_MANIFEST_URL=' "$CONFIG_ROOT/dashboard-portal.env"; then
  install -m 0644 -o root -g root "$APP_ROOT/$UPDATE_PUBLIC_KEY_SOURCE" "$UPDATE_PUBLIC_KEY_FILE"
  set_config_value HOSTMGR_UPDATE_MANIFEST_URL "$DEFAULT_UPDATE_MANIFEST_URL" "$CONFIG_ROOT/dashboard-portal.env"
  set_config_value HOSTMGR_UPDATE_PUBLIC_KEY_PATH "$UPDATE_PUBLIC_KEY_FILE" "$CONFIG_ROOT/dashboard-portal.env"
  set_config_value HOSTMGR_UPDATE_CHANNEL "$DEFAULT_UPDATE_CHANNEL" "$CONFIG_ROOT/dashboard-portal.env"
elif ! grep -q '^HOSTMGR_UPDATE_CHANNEL=' "$CONFIG_ROOT/dashboard-portal.env"; then
  set_config_value HOSTMGR_UPDATE_CHANNEL "$DEFAULT_UPDATE_CHANNEL" "$CONFIG_ROOT/dashboard-portal.env"
fi
chown root:"$APP_USER" "$CONFIG_ROOT/dashboard-portal.env"
chmod 0640 "$CONFIG_ROOT/dashboard-portal.env"

cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=Strckro
After=network-online.target
After=systemd-tmpfiles-setup.service
Wants=network-online.target
Wants=hostmgr-deploy-helper.service
After=hostmgr-deploy-helper.service

[Service]
Type=simple
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${APP_ROOT}
EnvironmentFile=${CONFIG_ROOT}/dashboard-portal.env
ExecStart=${PORTAL_NODE} ${APP_ROOT}/src/server.mjs
Restart=on-failure
RestartSec=5
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectHome=true
ProtectControlGroups=true
ProtectKernelModules=true
ProtectKernelTunables=true
LockPersonality=true
RestrictSUIDSGID=true
SystemCallArchitectures=native
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6 AF_NETLINK
ReadWritePaths=${DATA_ROOT}

[Install]
WantedBy=multi-user.target
EOF
chown root:root "$SERVICE_FILE"
chmod 0644 "$SERVICE_FILE"
[[ -s "$SERVICE_FILE" ]] || die 'Strckro systemd unit could not be created.'

cat > "$HELPER_SERVICE_FILE" <<EOF
[Unit]
Description=Strckro privileged deployment helper
After=network-online.target nginx.service
After=systemd-tmpfiles-setup.service
Wants=network-online.target

[Service]
Type=simple
User=root
Group=root
RuntimeDirectory=dashboard-portal
RuntimeDirectoryMode=0755
UMask=0007
ExecStart=${PORTAL_NODE} ${HELPER_SCRIPT} --socket ${HELPER_SOCKET}
Restart=on-failure
RestartSec=2
NoNewPrivileges=true
# Retain the capability needed to drop Python child processes to project uid/gid.
AmbientCapabilities=CAP_SETUID CAP_SETGID
PrivateTmp=true
ProtectHome=true
# shadow-utils performs lock and atomic-rename operations across /etc. On
# Ubuntu, ProtectSystem=full breaks those operations even with ReadWritePaths
# exceptions. The helper remains root-owned and reachable only through its
# bounded Unix-socket operation allowlist; do not re-enable ProtectSystem here.
ProtectSystem=false
ProtectControlGroups=true
ProtectKernelModules=true
ProtectKernelTunables=true
LockPersonality=true
RestrictSUIDSGID=true
SystemCallArchitectures=native
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6 AF_NETLINK
[Install]
WantedBy=multi-user.target
EOF
chown root:root "$HELPER_SERVICE_FILE"
chmod 0644 "$HELPER_SERVICE_FILE"
[[ -s "$HELPER_SERVICE_FILE" ]] || die 'Deployment helper systemd unit could not be created.'

# The secret lives in its own root-only file; the site file below is world-readable.
install -d -m 0755 -o root -g root "$(dirname "$NGINX_PROXY_SNIPPET")"
printf 'proxy_set_header X-Strckro-Proxy-Token "%s";\n' "$PROXY_TOKEN" > "$NGINX_PROXY_SNIPPET"
chown root:root "$NGINX_PROXY_SNIPPET"
chmod 0600 "$NGINX_PROXY_SNIPPET"
unset PROXY_TOKEN

cat > "$NGINX_SITE" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};
    server_tokens off;
    client_max_body_size 64k;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "no-referrer" always;
    location / {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        include ${NGINX_PROXY_SNIPPET};
        limit_req zone=strckro_requests burst=200 nodelay;
        limit_req_status 429;
        # Refusals log at error level by default, so a flood would fill the disk with its own evidence.
        limit_req_log_level warn;
        proxy_set_header Connection "";
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
    }
}
EOF
chown root:root "$NGINX_SITE"
chmod 0644 "$NGINX_SITE"
ln -sfn "$NGINX_SITE" "$NGINX_ENABLED"
cat > /etc/nginx/sites-available/hostmgr-unmatched.conf <<'EOF'
# Managed by Dashboard Portal. Do not edit.
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;
    return 404;
}

server {
    listen 443 ssl default_server;
    listen [::]:443 ssl default_server;
    server_name _;
    ssl_reject_handshake on;
}
EOF
chown root:root /etc/nginx/sites-available/hostmgr-unmatched.conf
chmod 0644 /etc/nginx/sites-available/hostmgr-unmatched.conf
# The Ubuntu package ships this exact catch-all as a default server. Keep a
# Portal-managed reject catch-all instead, but never remove a custom site.
if [[ -L "$NGINX_DEFAULT_ENABLED" && "$(readlink -f "$NGINX_DEFAULT_ENABLED")" == '/etc/nginx/sites-available/default' ]]; then
  rm "$NGINX_DEFAULT_ENABLED"
fi
ln -sfn /etc/nginx/sites-available/hostmgr-unmatched.conf /etc/nginx/sites-enabled/hostmgr-unmatched.conf
# Let Nginx see the visitor instead of Cloudflare.
install_realip_conf() {
  # Render to a temporary file so a failed render never leaves a half-written file where Nginx will read it.
  "$PORTAL_NODE" "$HELPER_ROOT/nginx-realip.mjs" > "$TMP_DIR/realip.conf"
  [[ -s "$TMP_DIR/realip.conf" ]] || die 'The Nginx real-IP configuration could not be rendered.'
  install -d -m 0755 -o root -g root "$(dirname "$NGINX_REALIP_CONF")"
  install -m 0644 -o root -g root "$TMP_DIR/realip.conf" "$NGINX_REALIP_CONF"
}

# `nginx -t`, with one allowance. real_ip_header and real_ip_recursive are accepted once per
# context, so a host that already sets either at http level, in nginx.conf, conf.d, sites-enabled or
# anything they include, makes Strckro's own real-IP file a duplicate: nginx refuses the whole
# configuration, the update rolls back, and it would do so again on every update. Only Nginx
# can say which file conflicts (a real_ip_header inside another site's own server block does
# not), so ask it. If the only complaint is such a duplicate, drop Strckro's real-IP file, keep the
# host's own setting, say so, and test again; the Portal's limits then count whatever address
# that configuration reports. Any other failure stays a failure.
nginx_test() {
  local output
  if output="$(nginx -t 2>&1)"; then return 0; fi
  if [[ -f "$NGINX_REALIP_CONF" && "$output" == *'real_ip_'*'directive is duplicate'* ]]; then
    rm -f -- "$NGINX_REALIP_CONF"
    echo "WARNING: Nginx already has a real_ip_header or real_ip_recursive of its own (${output%%$'\n'*}). Strckro's real-IP file was not installed and the host's setting stays, so the Portal's limits count whatever address it reports." >&2
    nginx -t
    return
  fi
  printf '%s\n' "$output" >&2
  return 1
}
install_realip_conf
# One request budget per visitor (the real address, once the file above is in place): 40
# requests a second sustained with room for a burst of 200, far above a person using the
# dashboard or the CLI and far below what a flood needs. Over the budget answers 429 from Nginx
# without ever reaching the portal. The zone is named here and used by `limit_req` in the site.
cat > "$TMP_DIR/limits.conf" <<'EOF'
# Managed by Strckro. Do not edit; it is rewritten on every install and update.
# One IPv6 subscriber holds a whole /64 and can use a new address for every request, so an IPv6
# visitor is counted as its /64 (the first 8 of the 16 bytes of the address); an IPv4 visitor
# (4 bytes) is counted by address.
map $binary_remote_addr $strckro_visitor {
    "~(?s)^(?<network>.{8}).{8}$"  $network;
    default                         $binary_remote_addr;
}
limit_req_zone $strckro_visitor zone=strckro_requests:10m rate=40r/s;
EOF
install -m 0644 -o root -g root "$TMP_DIR/limits.conf" "$NGINX_LIMITS_CONF"
nginx_test
systemctl daemon-reload
# `enable --now` leaves an already-active service on its old Node modules.
# Enable for boot, then explicitly restart so a successful in-place update is
# actually running the staged release before the updater reports success.
systemctl enable hostmgr-deploy-helper.service
systemctl restart hostmgr-deploy-helper.service
systemctl enable dashboard-portal.service
systemctl restart dashboard-portal.service
for _ in {1..10}; do
  curl --fail --silent --show-error "http://127.0.0.1:${PORT}/api/health" >/dev/null && break
  sleep 1
done
curl --fail --silent --show-error "http://127.0.0.1:${PORT}/api/health" >/dev/null || die 'Strckro did not pass its loopback health check.'
systemctl reload nginx

certbot --nginx --non-interactive --agree-tos --email "$EMAIL" -d "$DOMAIN" --redirect --hsts
curl --fail --silent --show-error --max-time 15 "https://${DOMAIN}/api/health" >/dev/null || die 'HTTPS health check failed after certificate issuance.'

# Only now, with the new release serving over HTTPS, is it safe to drop runtimes it replaced.
prune_node_runtimes || echo 'WARNING: old Node.js runtimes could not be reviewed for removal.' >&2

ROLLBACK_ARMED=false
cleanup
trap - EXIT ERR INT TERM
echo "Installed securely at https://${DOMAIN}"
echo "Configuration: ${CONFIG_ROOT}/dashboard-portal.env (root:${APP_USER}, 0640)"
echo "Rollback snapshots: ${BACKUP_ROOT}"
echo "Next: sudo strckro --help  (update, configure-update, --reset-pwd)"
