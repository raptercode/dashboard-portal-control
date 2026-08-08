#!/usr/bin/env bash
# Direct installer for one Ubuntu 24.04 or 25.04 host. It intentionally refuses an
# HTTP-only installation: this service has a login and must not expose it over
# cleartext traffic.
set -Eeuo pipefail
IFS=$'\n\t'
umask 077

DOMAIN=''
EMAIL=''
for arg in "$@"; do
  case "$arg" in
    --domain=*) DOMAIN="${arg#*=}" ;;
    --email=*) EMAIL="${arg#*=}" ;;
    *) echo 'Usage: sudo ./dashboard-portal.sh --domain=portal.example.com --email=admin@example.com' >&2; exit 64 ;;
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
UPDATE_SCRIPT='/usr/local/lib/dashboard-portal/dashboard-portal-update.mjs'
UPDATE_LIBRARY='/usr/local/lib/dashboard-portal/software-update.mjs'
UPDATE_COMMAND='/usr/local/sbin/dashboard-portal'
HELPER_SOCKET='/run/dashboard-portal/deploy-helper.sock'
NGINX_SITE='/etc/nginx/sites-available/dashboard-portal'
NGINX_ENABLED='/etc/nginx/sites-enabled/dashboard-portal'
PORT='3100'
NODE_VERSION='24.18.0'
NODE_SHA256='55aa7153f9d88f28d765fcdad5ae6945b5c0f98a36881703817e4c450fa76742'

TMP_DIR=''
BACKUP_DIR=''
ROLLBACK_ARMED=false
PREVIOUS_SERVICE_ACTIVE=false
PREVIOUS_SERVICE_ENABLED=false

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
  [[ -n "$TMP_DIR" && -d "$TMP_DIR" ]] && rm -rf -- "$TMP_DIR"
}

backup_item() {
  local label="$1" path="$2"
  if [[ -e "$path" || -L "$path" ]]; then
    mkdir -p "$BACKUP_DIR/$label"
    cp -a --no-dereference "$path" "$BACKUP_DIR/$label/original"
    : > "$BACKUP_DIR/$label/present"
  fi
}

restore_item() {
  local label="$1" path="$2"
  rm -rf -- "$path"
  if [[ -f "$BACKUP_DIR/$label/present" ]]; then
    cp -a --no-dereference "$BACKUP_DIR/$label/original" "$path"
  fi
}

rollback() {
  local code="$?"
  if [[ "$ROLLBACK_ARMED" == true ]]; then
    echo "Installation failed; restoring Dashboard Portal files from $BACKUP_DIR" >&2
    systemctl disable --now dashboard-portal.service >/dev/null 2>&1 || true
    systemctl disable --now hostmgr-deploy-helper.service >/dev/null 2>&1 || true
    restore_item service "$SERVICE_FILE"
    restore_item helper-service "$HELPER_SERVICE_FILE"
    restore_item helper-root "$HELPER_ROOT"
    restore_item update-command "$UPDATE_COMMAND"
    restore_item nginx-site "$NGINX_SITE"
    restore_item nginx-enabled "$NGINX_ENABLED"
    restore_item app-root "$APP_ROOT"
    restore_item config "$CONFIG_ROOT"
    restore_item data-root "$DATA_ROOT"
    systemctl daemon-reload >/dev/null 2>&1 || true
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
trap rollback ERR INT TERM

[[ $EUID -eq 0 ]] || die 'Run with sudo.'
[[ -n "$DOMAIN" && "$DOMAIN" =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$ ]] || die 'A lower-case FQDN is required in --domain.'
[[ -n "$EMAIL" && "$EMAIL" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]] || die 'A valid --email is required. HTTPS is mandatory for a public login.'
[[ -f package.json && -d src && -d public && -f scripts/hostmgr-deploy-helper.mjs && -f scripts/dashboard-portal-update.mjs && -f scripts/software-update.mjs ]] || die 'Run this script from an extracted dashboard-portal release directory.'
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
if systemctl is-active --quiet dashboard-portal.service; then PREVIOUS_SERVICE_ACTIVE=true; fi
if systemctl is-enabled --quiet dashboard-portal.service; then PREVIOUS_SERVICE_ENABLED=true; fi
backup_item service "$SERVICE_FILE"
backup_item helper-service "$HELPER_SERVICE_FILE"
backup_item helper-root "$HELPER_ROOT"
backup_item update-command "$UPDATE_COMMAND"
backup_item nginx-site "$NGINX_SITE"
backup_item nginx-enabled "$NGINX_ENABLED"
backup_item app-root "$APP_ROOT"
backup_item config "$CONFIG_ROOT"
backup_item data-root "$DATA_ROOT"
ROLLBACK_ARMED=true

export DEBIAN_FRONTEND=noninteractive
# apt drops signature verification to the unprivileged `_apt` user and needs a
# conventional sticky temporary directory. Do not allow a restrictive umask or
# prior deployment to leave `/tmp` inaccessible to package verification.
chmod 1777 /tmp
apt-get update
apt-get install -y --no-install-recommends nginx certbot python3-certbot-nginx curl ca-certificates xz-utils git

if ! id -u "$APP_USER" >/dev/null 2>&1; then
  useradd --system --create-home --home-dir "$DATA_ROOT" --shell /usr/sbin/nologin "$APP_USER"
fi

if [[ ! -x "/opt/node-v${NODE_VERSION}/bin/node" ]]; then
  node_archive="node-v${NODE_VERSION}-linux-x64.tar.xz"
  curl --fail --location --proto '=https' --tlsv1.2 --silent --show-error \
    "https://nodejs.org/dist/v${NODE_VERSION}/${node_archive}" -o "$TMP_DIR/$node_archive"
  printf '%s  %s\n' "$NODE_SHA256" "$TMP_DIR/$node_archive" | sha256sum --check --status || die 'Node.js archive checksum verification failed.'
  install -d -m 0755 "/opt/node-v${NODE_VERSION}"
  tar --extract --xz --file "$TMP_DIR/$node_archive" --directory "/opt/node-v${NODE_VERSION}" --strip-components=1 --no-same-owner
fi
# Keep the complete pinned Node distribution on PATH. A node-only symlink
# cannot execute the reproducible npm-based project deployment contract.
for node_tool in node npm npx corepack; do
  [[ -x "/opt/node-v${NODE_VERSION}/bin/${node_tool}" ]] || die "Pinned Node.js distribution is missing ${node_tool}."
  ln -sfn "/opt/node-v${NODE_VERSION}/bin/${node_tool}" "/usr/local/bin/${node_tool}"
done
"/usr/local/bin/node" --version | grep -qx "v${NODE_VERSION}" || die 'Installed Node.js version did not match the pinned release.'
"/usr/local/bin/npm" --version >/dev/null || die 'Installed Node.js npm runtime could not be executed.'

# Validate a staged release before replacing the live application files.
STAGING_ROOT="$TMP_DIR/app"
install -d -m 0755 "$STAGING_ROOT"
tar --exclude='.env' --exclude='data' --exclude='node_modules' --exclude='.git' --exclude='dist' -cf - . | tar -xf - -C "$STAGING_ROOT"
"/usr/local/bin/node" --check "$STAGING_ROOT/src/server.mjs"

rm -rf -- "$APP_ROOT"
mv "$STAGING_ROOT" "$APP_ROOT"
chown -R root:root "$APP_ROOT"
chmod -R go-w "$APP_ROOT"
install -d -m 0750 -o root -g root "$HELPER_ROOT"
install -m 0750 -o root -g root "$APP_ROOT/scripts/hostmgr-deploy-helper.mjs" "$HELPER_SCRIPT"
install -m 0750 -o root -g root "$APP_ROOT/scripts/dashboard-portal-update.mjs" "$UPDATE_SCRIPT"
install -m 0644 -o root -g root "$APP_ROOT/scripts/software-update.mjs" "$UPDATE_LIBRARY"
cat > "$UPDATE_COMMAND" <<EOF
#!/usr/bin/env bash
exec /usr/local/bin/node ${UPDATE_SCRIPT} "\$@"
EOF
chown root:root "$UPDATE_COMMAND"
chmod 0750 "$UPDATE_COMMAND"

install -d -m 0700 -o "$APP_USER" -g "$APP_USER" "$DATA_ROOT" "$DATA_ROOT/projects"
install -d -m 0750 -o root -g "$APP_USER" "$CONFIG_ROOT"
install -d -m 0750 -o root -g root /srv/hostmgr/projects /etc/hostmgr/projects
install -d -m 0755 -o root -g root /var/lib/hostmgr/acme
if [[ ! -f "$CONFIG_ROOT/dashboard-portal.env" ]]; then
  read -r -s -p 'Choose the Dashboard owner password (at least 12 characters): ' ADMIN_PASSWORD; echo
  [[ ${#ADMIN_PASSWORD} -ge 12 ]] || die 'Password must be at least 12 characters.'
  [[ "$ADMIN_PASSWORD" != *$'\n'* && "$ADMIN_PASSWORD" != *$'\r'* ]] || die 'Password must not contain a line break.'
  SECRET_KEY="$(/usr/local/bin/node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")"
  cat > "$CONFIG_ROOT/dashboard-portal.env" <<EOF
HOSTMGR_ADMIN_PASSWORD=${ADMIN_PASSWORD}
HOSTMGR_SECRET_KEY=${SECRET_KEY}
HOSTMGR_MODE=host
HOSTMGR_DATA_PATH=${DATA_ROOT}/state.json
HOSTMGR_PROJECT_ROOT=${DATA_ROOT}/projects
HOSTMGR_BIND_ADDRESS=127.0.0.1
HOSTMGR_SECURE_COOKIE=true
HOSTMGR_ACME_EMAIL=${EMAIL}
HOSTMGR_PORTAL_DOMAIN=${DOMAIN}
HOSTMGR_DEPLOY_HELPER_SOCKET=${HELPER_SOCKET}
PORT=${PORT}
EOF
  unset ADMIN_PASSWORD SECRET_KEY
fi
set_config_value HOSTMGR_ACME_EMAIL "$EMAIL" "$CONFIG_ROOT/dashboard-portal.env"
set_config_value HOSTMGR_PORTAL_DOMAIN "$DOMAIN" "$CONFIG_ROOT/dashboard-portal.env"
set_config_value HOSTMGR_DEPLOY_HELPER_SOCKET "$HELPER_SOCKET" "$CONFIG_ROOT/dashboard-portal.env"
chown root:"$APP_USER" "$CONFIG_ROOT/dashboard-portal.env"
chmod 0640 "$CONFIG_ROOT/dashboard-portal.env"

cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=Dashboard Portal
After=network-online.target
Wants=network-online.target
Wants=hostmgr-deploy-helper.service
After=hostmgr-deploy-helper.service

[Service]
Type=simple
User=${APP_USER}
Group=${APP_USER}
WorkingDirectory=${APP_ROOT}
EnvironmentFile=${CONFIG_ROOT}/dashboard-portal.env
ExecStart=/usr/local/bin/node ${APP_ROOT}/src/server.mjs
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
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
ReadWritePaths=${DATA_ROOT}

[Install]
WantedBy=multi-user.target
EOF
chown root:root "$SERVICE_FILE"
chmod 0644 "$SERVICE_FILE"
[[ -s "$SERVICE_FILE" ]] || die 'Dashboard Portal systemd unit could not be created.'

cat > "$HELPER_SERVICE_FILE" <<EOF
[Unit]
Description=Dashboard Portal privileged deployment helper
After=network-online.target nginx.service
Wants=network-online.target

[Service]
Type=simple
User=root
Group=root
RuntimeDirectory=dashboard-portal
RuntimeDirectoryMode=0755
UMask=0007
ExecStart=/usr/local/bin/node ${HELPER_SCRIPT} --socket ${HELPER_SOCKET}
Restart=on-failure
RestartSec=2
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
# The helper has a narrow Unix-socket protocol, but must be able to create the
# runtime socket and update only its explicitly owned paths. Strict mode prevents
# that runtime contract on some systemd versions.
ProtectSystem=full
ProtectControlGroups=true
ProtectKernelModules=true
ProtectKernelTunables=true
LockPersonality=true
RestrictSUIDSGID=true
SystemCallArchitectures=native
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6

[Install]
WantedBy=multi-user.target
EOF
chown root:root "$HELPER_SERVICE_FILE"
chmod 0644 "$HELPER_SERVICE_FILE"
[[ -s "$HELPER_SERVICE_FILE" ]] || die 'Deployment helper systemd unit could not be created.'

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
        proxy_set_header Connection "";
    }
}
EOF
chown root:root "$NGINX_SITE"
chmod 0644 "$NGINX_SITE"
ln -sfn "$NGINX_SITE" "$NGINX_ENABLED"
nginx -t
systemctl daemon-reload
systemctl enable --now hostmgr-deploy-helper.service
systemctl enable --now dashboard-portal.service
for _ in {1..10}; do
  curl --fail --silent --show-error "http://127.0.0.1:${PORT}/api/health" >/dev/null && break
  sleep 1
done
curl --fail --silent --show-error "http://127.0.0.1:${PORT}/api/health" >/dev/null || die 'Dashboard service did not pass its loopback health check.'
systemctl reload nginx

certbot --nginx --non-interactive --agree-tos --email "$EMAIL" -d "$DOMAIN" --redirect --hsts
curl --fail --silent --show-error --max-time 15 "https://${DOMAIN}/api/health" >/dev/null || die 'HTTPS health check failed after certificate issuance.'

ROLLBACK_ARMED=false
cleanup
trap - ERR INT TERM
echo "Installed securely at https://${DOMAIN}"
echo "Configuration: ${CONFIG_ROOT}/dashboard-portal.env (root:${APP_USER}, 0640)"
echo "Rollback snapshots: ${BACKUP_ROOT}"
