import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('installer systemd and Nginx heredocs contain no command substitutions', async () => {
  const script = await readFile(new URL('../dashboard-portal.sh', import.meta.url), 'utf8');
  const heredocs = [...script.matchAll(/<<EOF\r?\n([\s\S]*?)\r?\nEOF/g)].map((match) => match[1]);
  assert.equal(heredocs.length, 5);
  for (const body of heredocs) {
    assert.equal(body.includes('`'), false, 'unquoted heredocs must not execute backticks');
    assert.equal(body.includes('$('), false, 'unquoted heredocs must not execute command substitutions');
  }
});

test('installer allows AF_NETLINK so host NIC enumeration works under systemd', async () => {
  const script = await readFile(new URL('../dashboard-portal.sh', import.meta.url), 'utf8');
  const matches = [...script.matchAll(/RestrictAddressFamilies=([^\n]+)/g)].map((match) => match[1].trim());
  assert.equal(matches.length, 2);
  for (const value of matches) {
    assert.match(value, /\bAF_NETLINK\b/);
    assert.match(value, /\bAF_INET\b/);
    assert.match(value, /\bAF_UNIX\b/);
  }
});

test('installer keeps the deployed application root traversable by the service user', async () => {
  const script = await readFile(new URL('../dashboard-portal.sh', import.meta.url), 'utf8');
  assert.match(script, /mv "\$STAGING_ROOT" "\$APP_ROOT"\r?\nchown -R root:root "\$APP_ROOT"\r?\n#.*\r?\n#.*\r?\nchmod 0755 "\$APP_ROOT"\r?\nchmod -R go-w "\$APP_ROOT"/);
});

test('privileged helper keeps shadow-utils and traversable managed roots compatible with systemd', async () => {
  const script = await readFile(new URL('../dashboard-portal.sh', import.meta.url), 'utf8');
  const helperUnit = script.match(/Description=Dashboard Portal privileged deployment helper[\s\S]*?\n\[Install\]/)?.[0] ?? '';
  assert.match(script, /ProtectSystem=false/);
  assert.doesNotMatch(helperUnit, /\nProtectSystem=full\r?\n/);
  assert.doesNotMatch(helperUnit, /\nReadWritePaths=/);
  assert.match(script, /install -d -m 0711 -o root -g root \/var\/lib\/hostmgr \/srv\/hostmgr \/srv\/hostmgr\/projects/);
  assert.match(script, /install -d -m 0755 -o root -g root \/var\/lib\/hostmgr\/acme/);
});

test('helper reports a safe and actionable TLS validation failure', async () => {
  const helper = await readFile(new URL('../scripts/hostmgr-deploy-helper.mjs', import.meta.url), 'utf8');
  assert.match(helper, /TLS certificate request failed\. Confirm the domain resolves to this host, port 80 is reachable, and any CDN proxy or HTTPS redirect is disabled during HTTP-01 validation\./);
  assert.match(helper, /child\.stderr\.resume\(\)/);
});

test('helper keeps Docker Compose project activation bounded to guarded policy checks', async () => {
  const helper = await readFile(new URL('../scripts/hostmgr-deploy-helper.mjs', import.meta.url), 'utf8');
  assert.match(helper, /request\.operation === 'remove-project-domains'/);
  assert.match(helper, /item\.privileged === true \|\| item\.network_mode === 'host' \|\| item\.pid === 'host' \|\| item\.ipc === 'host'/);
  assert.match(helper, /Docker Compose host bind mounts are not allowed/);
  assert.match(helper, /Docker Compose service must publish the configured project port/);
  assert.match(helper, /\['compose', '--project-name'/);
  assert.match(helper, /DOCKER_CONFIG: DOCKER_CONFIG_ROOT/);
  assert.match(helper, /ProtectHome=true intentionally makes \/root read-only/);
});

test('helper permits Bun projects and starts them through the fixed Bun executable', async () => {
  const helper = await readFile(new URL('../scripts/hostmgr-deploy-helper.mjs', import.meta.url), 'utf8');
  assert.match(helper, /const BUN = '\/usr\/local\/bin\/bun';/);
  assert.match(helper, /\['node', 'bun', 'docker-compose'\]/);
  assert.match(helper, /project\.runtime === 'bun' \? BUN : NPM/);
  assert.match(helper, /RuntimeDirectory=\$\{identity\.runtimeDirectory\}\/app/);
  assert.match(helper, /BindPaths=\$\{identity\.current\}:\$\{identity\.runtimeApplicationPath\}/);
  assert.match(helper, /WorkingDirectory=\$\{workingDirectory\}/);
});

test('helper trims dependencies only from historical releases outside the rollback window', async () => {
  const helper = await readFile(new URL('../scripts/hostmgr-deploy-helper.mjs', import.meta.url), 'utf8');
  assert.match(helper, /async function pruneHistoricalNodeModules/);
  assert.match(helper, /const keep = new Set\(\[activeReleaseId\]\)/);
  assert.match(helper, /join\(identity\.releases, entry\.name, 'node_modules'\)/);
  assert.match(helper, /keep\.has\(entry\.name\)/);
});

test('helper gives each project service account access to its release parent', async () => {
  const helper = await readFile(new URL('../scripts/hostmgr-deploy-helper.mjs', import.meta.url), 'utf8');
  assert.match(helper, /await mkdir\(identity\.releases, \{ recursive: true, mode: 0o750 \}\);/);
  assert.match(helper, /\['--no-dereference', `\$\{identity\.user\}:\$\{identity\.user\}`, identity\.releases\]/);
  assert.match(helper, /await chmod\(identity\.releases, 0o750\);/);
});

test('installer provisions the reset-password command and stores the initial password encoded', async () => {
  const script = await readFile(new URL('../dashboard-portal.sh', import.meta.url), 'utf8');
  assert.match(script, /PASSWORD_SCRIPT='\/usr\/local\/lib\/dashboard-portal\/password-config\.mjs'/);
  assert.match(script, /install -m 0750 -o root -g root "\$APP_ROOT\/scripts\/password-config\.mjs" "\$PASSWORD_SCRIPT"/);
  assert.match(script, /\[\[ "\\\$\{1:-\}" == '--reset-pwd' \]\]/);
  assert.match(script, /ADMIN_PASSWORD_B64="\$\(printf %s "\$ADMIN_PASSWORD" \| base64 -w 0\)"/);
  assert.match(script, /HOSTMGR_ADMIN_PASSWORD_B64=\$\{ADMIN_PASSWORD_B64\}/);
});

test('installer restarts active services so an update cannot retain old Node modules', async () => {
  const script = await readFile(new URL('../dashboard-portal.sh', import.meta.url), 'utf8');
  assert.match(script, /systemctl enable hostmgr-deploy-helper\.service\r?\nsystemctl restart hostmgr-deploy-helper\.service\r?\nsystemctl enable dashboard-portal\.service\r?\nsystemctl restart dashboard-portal\.service/);
  assert.doesNotMatch(script, /systemctl enable --now dashboard-portal\.service/);
});

test('installer configures the SQLite source of truth for a clean data cutover', async () => {
  const script = await readFile(new URL('../dashboard-portal.sh', import.meta.url), 'utf8');
  assert.match(script, /HOSTMGR_DATABASE_PATH=\$\{DATA_ROOT\}\/state\.sqlite/);
  assert.match(script, /set_config_value HOSTMGR_DATABASE_PATH "\$DATA_ROOT\/state\.sqlite"/);
});

test('installer provisions a checksum-verified Bun runtime for Bun projects', async () => {
  const script = await readFile(new URL('../dashboard-portal.sh', import.meta.url), 'utf8');
  assert.match(script, /BUN_VERSION='1\.3\.13'/);
  assert.match(script, /BUN_SHA256='9d8a24292a7068090205daac0a5a223f5f69736f5287e37bf88d3b4031edc750'/);
  assert.match(script, /bun-linux-x64-baseline\.zip/);
  assert.match(script, /\/usr\/local\/bin\/bun/);
  assert.match(script, /unzip git/);
});

test('installer enrolls new hosts in the signed stable update channel without a manual configure step', async () => {
  const script = await readFile(new URL('../dashboard-portal.sh', import.meta.url), 'utf8');
  assert.match(script, /UPDATE_PUBLIC_KEY_SOURCE='scripts\/dashboard-portal-update-public\.pem'/);
  assert.match(script, /DEFAULT_UPDATE_MANIFEST_URL='https:\/\/github\.com\/raptercode\/dashboard-portal-control\/releases\/latest\/download\/stable\.json'/);
  assert.match(script, /install -m 0644 -o root -g root "\$APP_ROOT\/\$UPDATE_PUBLIC_KEY_SOURCE" "\$UPDATE_PUBLIC_KEY_FILE"/);
  assert.match(script, /set_config_value HOSTMGR_UPDATE_CHANNEL "\$DEFAULT_UPDATE_CHANNEL"/);
  assert.match(script, /Preserve an existing custom feed/);
});
