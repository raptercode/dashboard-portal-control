#!/usr/local/bin/node
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { access, chmod, chown, copyFile, cp, lstat, mkdir, readFile, readlink, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { updateStoredPassword } from './password-config.mjs';

const MAX_REQUEST_BYTES = 16 * 1024;
const PROJECT_ROOT = '/var/lib/dashboard-portal/projects';
const STATE_DATABASE_PATH = '/var/lib/dashboard-portal/state.sqlite';
const RUNTIME_ROOT = '/srv/hostmgr/projects';
const ENVIRONMENT_ROOT = '/etc/hostmgr/projects';
const ACME_ROOT = '/var/lib/hostmgr/acme';
const NGINX_AVAILABLE = '/etc/nginx/sites-available';
const NGINX_ENABLED = '/etc/nginx/sites-enabled';
const CONFIG_PATH = '/etc/dashboard-portal/dashboard-portal.env';
const NPM = '/usr/local/bin/npm';

const args = parseArgs(process.argv.slice(2));
const socketPath = args.socket;
if (!socketPath) throw new Error('The helper socket path is required.');

await mkdir(basename(socketPath) === socketPath ? '.' : socketPath.slice(0, socketPath.lastIndexOf('/')), { recursive: true, mode: 0o750 });
await rm(socketPath, { force: true });
const server = createServer({ allowHalfOpen: true }, (socket) => handleSocket(socket));
server.listen(socketPath, async () => {
  const groupId = await lookupGroupId('dashboardportal');
  const socketDirectory = socketPath.slice(0, socketPath.lastIndexOf('/'));
  await chown(socketDirectory, 0, groupId);
  await chmod(socketDirectory, 0o750);
  await chown(socketPath, 0, groupId);
  await chmod(socketPath, 0o660);
});

function handleSocket(socket) {
  let body = '';
  let handled = false;
  socket.setEncoding('utf8');
  socket.on('error', () => {});
  socket.on('data', async (chunk) => {
    if (handled) return;
    body += chunk;
    if (Buffer.byteLength(body) > MAX_REQUEST_BYTES) return socket.destroy();
    const boundary = body.indexOf('\n');
    if (boundary < 0) return;
    handled = true;
    try {
      const request = JSON.parse(body.slice(0, boundary));
      const result = await dispatch(request);
      socket.end(`${JSON.stringify({ ok: true, ...result })}\n`);
    } catch (error) {
      // Error messages must stay static: do not return command output, paths
      // derived from a project, or secret-bearing application errors.
      socket.end(`${JSON.stringify({ ok: false, error: safeError(error) })}\n`);
    }
  });
}

async function dispatch(request) {
  if (!request || typeof request !== 'object') throw new HelperError('Invalid helper request.');
  if (request.operation === 'install-tool') return installTool(request.tool);
  if (request.operation === 'activate-project') return activateProject(request.slug, request.releaseId);
  if (request.operation === 'sync-project-domains') return syncProjectDomains(request.slug);
  if (request.operation === 'delete-project') return deleteProject(request.slug);
  if (request.operation === 'set-admin-password') return setAdminPassword(request.password);
  if (request.operation === 'read-project-log') return readProjectLog(request.slug, request.lines);
  throw new HelperError('Unsupported helper operation.');
}

async function readProjectLog(slug, lines) {
  const identity = projectIdentity(slug);
  const count = Number.isInteger(lines) && lines > 0 && lines <= 200 ? lines : 150;
  const output = await run('/usr/bin/journalctl', ['-u', identity.service, '-n', String(count), '--no-pager', '-o', 'short-iso'], { failure: 'Could not read the project log.' }).catch(() => '');
  return { lines: output.split('\n').filter(Boolean).slice(-count).map((line) => line.slice(0, 1000)) };
}

async function setAdminPassword(password) {
  try {
    await updateStoredPassword(password, CONFIG_PATH);
    return {};
  } catch {
    throw new HelperError('Dashboard password could not be updated.');
  }
}

async function installTool(tool) {
  const packages = { nginx: ['nginx'], certbot: ['certbot', 'python3-certbot-nginx'], git: ['git'], docker: ['docker.io', 'docker-compose-v2'] };
  if (!Object.hasOwn(packages, tool)) throw new HelperError('Unsupported tool installation request.');
  await run('/usr/bin/apt-get', ['update'], { timeout: 180_000 });
  await run('/usr/bin/apt-get', ['install', '-y', '--no-install-recommends', ...packages[tool]], { timeout: 300_000 });
  return { version: 'Installed' };
}

async function activateProject(slug, releaseId) {
  const project = await loadProject(slug);
  validateReleaseId(releaseId);
  const release = project.deployment?.releases?.find((item) => item.id === releaseId);
  if (!release || !['candidate', 'healthy'].includes(release.status)) throw new HelperError('The requested release is not eligible for activation.');
  let transaction;
  try {
    transaction = await prepareProjectRelease(project, releaseId);
  } catch (error) {
    throw helperFailure(error, 'Host preparation failed before the project service could be activated.');
  }
  try {
    await startAndCheckProject(project, transaction);
  } catch (error) {
    await transaction.rollback();
    throw helperFailure(error, 'The project service could not be started or did not pass its host health check.');
  }
  try {
    await applyDomains(project);
    return { releaseId, domains: project.domains.hosts };
  } catch (error) {
    await transaction.rollback();
    throw helperFailure(error, 'Domain or TLS activation failed; the previous active release was restored.');
  }
}

async function syncProjectDomains(slug) {
  const project = await loadProject(slug);
  if (!project.deployment?.activeReleaseId) throw new HelperError('No active release is available for domain sync.');
  await applyDomains(project);
  return { domains: project.domains.hosts };
}

async function deleteProject(slug) {
  await loadProjectForDeletion(slug);
  const identity = projectIdentity(slug);
  await run('/usr/bin/systemctl', ['disable', '--now', identity.service]).catch(() => {});
  await rm(identity.unitFile, { force: true });
  await run('/usr/bin/systemctl', ['daemon-reload']);
  await removeManagedNginx(slug);
  await rm(identity.environmentFile, { force: true });
  await rm(identity.root, { recursive: true, force: true });
  await run('/usr/sbin/userdel', [identity.user]).catch(() => {});
  await clearPasswordLock();
  return { slug };
}

async function loadProject(slug) {
  validateSlug(slug);
  const project = readProject(slug);
  if (!project) throw new HelperError('Project was not found.');
  validateProject(project);
  return project;
}

async function loadProjectForDeletion(slug) {
  validateSlug(slug);
  if (!readProject(slug)) throw new HelperError('Project was not found.');
}

function readProject(slug) {
  let database;
  try {
    database = new DatabaseSync(STATE_DATABASE_PATH, { readOnly: true });
    const row = database.prepare('SELECT payload FROM projects WHERE slug = ?').get(slug);
    return row ? JSON.parse(row.payload) : null;
  } catch {
    throw new HelperError('Dashboard database could not be read.');
  } finally { database?.close(); }
}

function validateProject(project) {
  validateSlug(project.slug);
  if (!Number.isInteger(project.port) || project.port < 1024 || project.port > 65535) throw new HelperError('Project port is invalid.');
  if (typeof project.startScript !== 'string' || !/^[a-zA-Z0-9:_-]{1,64}$/.test(project.startScript)) throw new HelperError('Project start script is invalid.');
  if (project.healthCheckEnabled !== false && !/^\/(?!\/)[^\s]*$/.test(project.healthCheckPath ?? '/')) throw new HelperError('Project health-check path is invalid.');
  if (!Array.isArray(project.domains?.hosts) || project.domains.hosts.length < 1 || project.domains.hosts.length > 10) throw new HelperError('Project has no valid domain configuration.');
  project.domains.hosts = [...new Set(project.domains.hosts.map(validateDomain))];
}

async function prepareProjectRelease(project, releaseId) {
  const identity = projectIdentity(project.slug);
  await ensureProjectUser(identity);
  await mkdir(identity.releases, { recursive: true, mode: 0o750 });
  await mkdir(ENVIRONMENT_ROOT, { recursive: true, mode: 0o750 });
  const source = join(PROJECT_ROOT, project.slug, 'releases', releaseId);
  await assertDirectory(source, 'Candidate release is unavailable.');
  const destination = join(identity.releases, releaseId);
  if (!(await exists(destination))) {
    const staging = join(identity.root, `.release-${releaseId}.staging`);
    await rm(staging, { recursive: true, force: true });
    await cp(source, staging, { recursive: true, dereference: false, filter: (entry) => basename(entry) !== '.git' });
    await run('/usr/bin/chown', ['-R', '--no-dereference', `${identity.user}:${identity.user}`, staging]);
    await rename(staging, destination);
  }
  const environmentSource = join(destination, '.env');
  if (!(await exists(environmentSource))) throw new HelperError('Candidate environment file is unavailable.');
  const environmentTemp = `${identity.environmentFile}.${releaseId}.tmp`;
  await copyFile(environmentSource, environmentTemp);
  await chown(environmentTemp, 0, identity.gid);
  await chmod(environmentTemp, 0o640);
  await rename(environmentTemp, identity.environmentFile);
  await writeFile(identity.unitFile, renderProjectUnit(project, identity), { mode: 0o644 });
  const previousTarget = await readlink(identity.current).catch(() => null);
  const nextLink = `${identity.current}.${releaseId}.next`;
  await rm(nextLink, { force: true });
  await symlink(destination, nextLink);
  await rename(nextLink, identity.current);
  return {
    identity,
    previousTarget,
    rollback: async () => {
      if (previousTarget) {
        const revert = `${identity.current}.rollback`;
        await rm(revert, { force: true });
        await symlink(previousTarget, revert);
        await rename(revert, identity.current);
        await run('/usr/bin/systemctl', ['daemon-reload']);
        await run('/usr/bin/systemctl', ['restart', identity.service]).catch(() => {});
      } else {
        await run('/usr/bin/systemctl', ['disable', '--now', identity.service]).catch(() => {});
        await rm(identity.current, { force: true });
      }
    }
  };
}

async function startAndCheckProject(project, transaction) {
  await run('/usr/bin/systemctl', ['daemon-reload']);
  await run('/usr/bin/systemctl', ['enable', '--now', transaction.identity.service], { failure: 'The project systemd service could not be enabled or started.' });
  if (project.healthCheckEnabled === false) return;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await healthCheck(project.port, project.healthCheckPath ?? '/')) return;
    await delay(250);
  }
  throw new HelperError('Project did not pass its host health check.');
}

async function applyDomains(project) {
  const site = join(NGINX_AVAILABLE, `hostmgr-${project.slug}.conf`);
  const enabled = join(NGINX_ENABLED, `hostmgr-${project.slug}.conf`);
  await assertDomainsAreAvailable(project.domains.hosts, site, enabled);
  const snapshot = await snapshotNginx(site, enabled);
  try {
    await mkdir(ACME_ROOT, { recursive: true, mode: 0o755 });
    await writeNginx(site, enabled, renderHttpSite(project, ACME_ROOT));
    await testAndReloadNginx();
    await issueCertificate(project);
    await writeNginx(site, enabled, renderTlsSite(project, ACME_ROOT, certificateName(project.slug)));
    await testAndReloadNginx();
  } catch (error) {
    await restoreNginx(site, enabled, snapshot);
    throw error;
  }
}

async function assertDomainsAreAvailable(hosts, site, enabled) {
  const configuration = await run('/usr/sbin/nginx', ['-T']);
  let file = null;
  for (const line of configuration.split('\n')) {
    const marker = line.match(/^# configuration file (.+):$/);
    if (marker) { file = marker[1]; continue; }
    const names = line.match(/^\s*server_name\s+([^;]+);/);
    if (!names || file === site || file === enabled) continue;
    const claimed = names[1].trim().split(/\s+/);
    if (claimed.some((name) => hosts.includes(name))) throw new HelperError('A requested domain is already owned by an external Nginx configuration.');
  }
}

async function issueCertificate(project) {
  const email = await acmeEmail();
  for (const host of project.domains.hosts) {
    const dns = await run('/usr/bin/getent', ['ahosts', host]).catch(() => '');
    if (!dns.trim()) throw new HelperError('A project domain does not resolve in DNS.');
  }
  const args = ['certonly', '--webroot', '--webroot-path', ACME_ROOT, '--non-interactive', '--agree-tos', '--email', email, '--keep-until-expiring', '--expand', '--cert-name', certificateName(project.slug)];
  for (const host of project.domains.hosts) args.push('-d', host);
  await run('/usr/bin/certbot', args, { timeout: 180_000 });
}

async function acmeEmail() {
  const content = await readFile(CONFIG_PATH, 'utf8').catch(() => '');
  const match = content.match(/^HOSTMGR_ACME_EMAIL=([^\r\n]+)$/m);
  if (!match || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(match[1])) throw new HelperError('The ACME email is not configured. Re-run the Dashboard Portal installer.');
  return match[1];
}

function renderHttpSite(project, acmeRoot) {
  const hosts = project.domains.hosts.join(' ');
  return `# Managed by Dashboard Portal. Do not edit.\nserver {\n    listen 80;\n    listen [::]:80;\n    server_name ${hosts};\n    location ^~ /.well-known/acme-challenge/ { root ${acmeRoot}; }\n    location / { return 308 https://$host$request_uri; }\n}\n`;
}

function renderTlsSite(project, acmeRoot, certificate) {
  const hosts = project.domains.hosts.join(' ');
  return `# Managed by Dashboard Portal. Do not edit.\nserver {\n    listen 80;\n    listen [::]:80;\n    server_name ${hosts};\n    location ^~ /.well-known/acme-challenge/ { root ${acmeRoot}; }\n    location / { return 308 https://$host$request_uri; }\n}\n\nserver {\n    listen 443 ssl;\n    listen [::]:443 ssl;\n    server_name ${hosts};\n    ssl_certificate /etc/letsencrypt/live/${certificate}/fullchain.pem;\n    ssl_certificate_key /etc/letsencrypt/live/${certificate}/privkey.pem;\n    add_header X-Content-Type-Options "nosniff" always;\n    add_header Referrer-Policy "no-referrer" always;\n    location / {\n        proxy_pass http://127.0.0.1:${project.port};\n        proxy_http_version 1.1;\n        proxy_set_header Host $host;\n        proxy_set_header X-Real-IP $remote_addr;\n        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n        proxy_set_header X-Forwarded-Proto $scheme;\n    }\n}\n`;
}

async function writeNginx(site, enabled, content) {
  const temp = `${site}.tmp`;
  await writeFile(temp, content, { mode: 0o644 });
  await rename(temp, site);
  await rm(enabled, { force: true });
  await symlink(site, enabled);
}

async function removeManagedNginx(slug) {
  const site = join(NGINX_AVAILABLE, `hostmgr-${slug}.conf`);
  const enabled = join(NGINX_ENABLED, `hostmgr-${slug}.conf`);
  const snapshot = await snapshotNginx(site, enabled);
  try {
    await rm(enabled, { force: true });
    await rm(site, { force: true });
    await testAndReloadNginx();
  } catch (error) {
    await restoreNginx(site, enabled, snapshot);
    throw error;
  }
}

async function snapshotNginx(site, enabled) {
  return { site: await readFile(site, 'utf8').catch(() => null), enabled: await readlink(enabled).catch(() => null) };
}

async function restoreNginx(site, enabled, snapshot) {
  if (snapshot.site === null) await rm(site, { force: true });
  else await writeFile(site, snapshot.site, { mode: 0o644 });
  await rm(enabled, { force: true });
  if (snapshot.enabled) await symlink(snapshot.enabled, enabled);
  await testAndReloadNginx().catch(() => {});
}

async function testAndReloadNginx() {
  await run('/usr/sbin/nginx', ['-t']);
  await run('/usr/bin/systemctl', ['reload', 'nginx']);
}

function projectIdentity(slug) {
  validateSlug(slug);
  const user = `hostmgr-${slug}`;
  const root = join(RUNTIME_ROOT, slug);
  return { user, root, releases: join(root, 'releases'), current: join(root, 'current'), service: `hostmgr-project-${slug}.service`, unitFile: join('/etc/systemd/system', `hostmgr-project-${slug}.service`), environmentFile: join(ENVIRONMENT_ROOT, `${slug}.env`), gid: null };
}

async function ensureProjectUser(identity) {
  const exists = await run('/usr/bin/id', ['-u', identity.user]).then(() => true).catch(() => false);
  if (!exists) {
    await run('/usr/sbin/useradd', ['--system', '--create-home', '--home-dir', identity.root, '--shell', '/usr/sbin/nologin', identity.user], { failure: 'The project service account could not be created.' });
    await clearPasswordLock();
  }
  identity.gid = await lookupUserGroupId(identity.user);
  await mkdir(identity.root, { recursive: true, mode: 0o750 });
  await run('/usr/bin/chown', ['-R', '--no-dereference', `${identity.user}:${identity.user}`, identity.root]);
}

async function clearPasswordLock() {
  // shadow-utils leaves this zero-byte lock behind under the helper's narrowed
  // systemd writable-path sandbox. It is created by the successful account
  // operation above, so clear only after that operation has returned.
  await rm('/etc/.pwd.lock', { force: true });
}

function renderProjectUnit(project, identity) {
  return `[Unit]\nDescription=Dashboard Portal project ${project.slug}\nAfter=network-online.target\nWants=network-online.target\n\n[Service]\nType=simple\nUser=${identity.user}\nGroup=${identity.user}\nWorkingDirectory=${identity.current}\nEnvironmentFile=${identity.environmentFile}\nEnvironment=PORT=${project.port}\nExecStart=${NPM} run ${project.startScript}\nRestart=on-failure\nRestartSec=5\nNoNewPrivileges=true\nPrivateTmp=true\nProtectHome=true\nProtectSystem=strict\nReadWritePaths=${identity.root}\n\n[Install]\nWantedBy=multi-user.target\n`;
}

function validateSlug(slug) {
  if (typeof slug !== 'string' || !/^[a-z][a-z0-9-]{0,62}$/.test(slug)) throw new HelperError('Project slug is invalid.');
}

function validateReleaseId(releaseId) {
  if (typeof releaseId !== 'string' || !/^[a-f0-9-]{36}$/i.test(releaseId)) throw new HelperError('Release id is invalid.');
}

function validateDomain(host) {
  if (typeof host !== 'string' || !/^(?=.{1,253}$)(?!-)(?:[a-z0-9-]{1,63}\.)+[a-z]{2,63}$/.test(host)) throw new HelperError('Project domain is invalid.');
  return host;
}

function certificateName(slug) { return `hostmgr-${slug}`; }
async function lookupUserGroupId(user) { return Number(await run('/usr/bin/id', ['-g', user])); }
async function lookupGroupId(group) {
  const fields = (await run('/usr/bin/getent', ['group', group])).split(':');
  if (!/^\d+$/.test(fields[2] ?? '')) throw new HelperError('Dashboard service group is invalid.');
  return Number(fields[2]);
}

async function assertDirectory(path, message) {
  const item = await lstat(path).catch(() => null);
  if (!item?.isDirectory()) throw new HelperError(message);
}

async function exists(path) { return access(path).then(() => true).catch(() => false); }
function delay(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
async function healthCheck(port, path) { try { const response = await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(1_000), redirect: 'manual' }); return response.status >= 200 && response.status < 400; } catch { return false; } }

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const { failure = 'A required host operation failed.', ...spawnOptions } = options;
    const child = spawn(command, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000, ...spawnOptions });
    let stdout = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.resume();
    child.once('error', () => reject(new HelperError('A required host operation could not start.')));
    child.once('close', (code) => code === 0 ? resolve(stdout.trim()) : reject(new HelperError(failure)));
  });
}

function helperFailure(error, fallback) {
  return error instanceof HelperError ? error : new HelperError(fallback);
}

function parseArgs(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 2) {
    if (values[index] !== '--socket' || typeof values[index + 1] !== 'string' || !values[index + 1].startsWith('/')) throw new Error('Invalid helper command line.');
    result.socket = values[index + 1];
  }
  return result;
}

function safeError(error) { return error instanceof HelperError ? error.message : 'Host helper operation failed.'; }
class HelperError extends Error {}
