#!/usr/local/bin/node
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { access, chmod, chown, copyFile, cp, lstat, mkdir, readFile, readdir, readlink, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { createDecipheriv } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { updateStoredPassword } from './password-config.mjs';
import { buildEdgeEvaluation, probeLoopbackHttp, publicEdgeResult, renderUnmatchedNginx } from './nginx-edge.mjs';
import { buildMailPortPlan, renderDkimTables, renderDovecotConfiguration, renderMap, renderOpenDkimConfiguration, renderPostfixMain, renderPostfixMaster } from './mail-host-config.mjs';

const MAX_REQUEST_BYTES = 16 * 1024;
const PROJECT_ROOT = '/var/lib/dashboard-portal/projects';
const STATE_DATABASE_PATH = '/var/lib/dashboard-portal/state.sqlite';
const RUNTIME_ROOT = '/srv/hostmgr/projects';
const ENVIRONMENT_ROOT = '/etc/hostmgr/projects';
const ACME_ROOT = '/var/lib/hostmgr/acme';
const DOCKER_CONFIG_ROOT = '/var/lib/hostmgr/docker-client';
const NGINX_AVAILABLE = '/etc/nginx/sites-available';
const NGINX_ENABLED = '/etc/nginx/sites-enabled';
const CONFIG_PATH = '/etc/dashboard-portal/dashboard-portal.env';
const NPM = '/usr/local/bin/npm';
const BUN = '/usr/local/bin/bun';
const DOCKER = '/usr/bin/docker';
const MAIL_ROOT = '/etc/hostmgr/mail';
const MAIL_INSTALL_MARKER = `${MAIL_ROOT}/.portal-installed`;
const MAIL_POSTFIX_ROOT = '/etc/postfix/hostmgr';
const MAIL_DOMAINS = `${MAIL_POSTFIX_ROOT}/domains`;
const MAIL_MAILBOXES = `${MAIL_POSTFIX_ROOT}/mailboxes`;
const MAIL_USERS = `${MAIL_ROOT}/users`;
const MAIL_SASL = `${MAIL_ROOT}/sasl_passwd`;
const MAIL_VMAIL_ROOT = '/var/vmail';
const MAIL_DKIM_ROOT = '/etc/opendkim/keys';
const MAIL_CERTIFICATE = '/etc/letsencrypt/live/hostmgr-mail';

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
  if (request.operation === 'remove-project-domains') return removeProjectDomains(request.slug);
  if (request.operation === 'delete-project') return deleteProject(request.slug);
  if (request.operation === 'set-admin-password') return setAdminPassword(request.password);
  if (request.operation === 'read-project-log') return readProjectLog(request.slug, request.lines);
  if (request.operation === 'project-runtime-status') return projectRuntimeStatus(request.slug);
  if (request.operation === 'inspect-project-edge') return inspectProjectEdge(request.slug);
  if (request.operation === 'mail-port-readiness') return mailPortReadiness();
  if (request.operation === 'configure-mail') return configureMail();
  if (request.operation === 'create-mailbox') return createMailbox(request.domain, request.localPart, request.password);
  if (request.operation === 'delete-mailbox') return deleteMailbox(request.domain, request.localPart);
  if (request.operation === 'remove-mail-domain') return removeMailDomain(request.domain, request.force === true);
  throw new HelperError('Unsupported helper operation.');
}

async function readProjectLog(slug, lines) {
  const project = await loadProject(slug);
  const identity = projectIdentity(slug);
  const count = Number.isInteger(lines) && lines > 0 && lines <= 200 ? lines : 150;
  if (project.runtime === 'docker-compose') {
    const current = await readlink(identity.current).catch(() => null);
    if (!current) return { lines: [] };
    const output = await runDockerCompose(project, current, ['logs', '--tail', String(count), '--no-color'], { failure: 'Could not read the project log.' }).catch(() => '');
    return { lines: output.split('\n').filter(Boolean).slice(-count).map((line) => line.slice(0, 1000)) };
  }
  const output = await run('/usr/bin/journalctl', ['-u', identity.service, '-n', String(count), '--no-pager', '-o', 'short-iso'], { failure: 'Could not read the project log.' }).catch(() => '');
  return { lines: output.split('\n').filter(Boolean).slice(-count).map((line) => line.slice(0, 1000)) };
}

async function projectRuntimeStatus(slug) {
  const project = await loadProject(slug);
  const identity = projectIdentity(slug);
  if (project.runtime === 'docker-compose') {
    const current = await readlink(identity.current).catch(() => null);
    if (!current) return { state: 'down' };
    const running = await runDockerCompose(project, current, ['ps', '--status', 'running', '--services'], { failure: 'Could not read the project runtime status.' }).catch(() => '');
    const serviceIsRunning = running.split('\n').some((service) => service.trim() === project.composeService);
    if (!serviceIsRunning) return { state: 'down' };
  } else {
    const active = await run('/usr/bin/systemctl', ['is-active', '--quiet', identity.service], { failure: 'Could not read the project runtime status.' }).then(() => true).catch(() => false);
    if (!active) return { state: 'down' };
  }
  if (project.healthCheckEnabled !== false && !await healthCheck(project.port, project.healthCheckPath ?? '/')) return { state: 'down' };
  return { state: 'active' };
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
  const packages = { nginx: ['nginx'], certbot: ['certbot', 'python3-certbot-nginx'], git: ['git'], docker: ['docker.io', 'docker-compose-v2'], mail: ['postfix', 'dovecot-imapd', 'dovecot-lmtpd', 'opendkim', 'opendkim-tools'] };
  if (!Object.hasOwn(packages, tool)) throw new HelperError('Unsupported tool installation request.');
  if (tool === 'mail' && !await exists(MAIL_INSTALL_MARKER) && (await exists('/etc/postfix/main.cf') || await exists('/etc/dovecot'))) {
    throw new HelperError('Existing mail configuration was found. Portal will not take it over automatically.');
  }
  const env = tool === 'mail' ? { ...process.env, DEBIAN_FRONTEND: 'noninteractive' } : undefined;
  await run('/usr/bin/apt-get', ['update'], { timeout: 180_000, env });
  await run('/usr/bin/apt-get', ['install', '-y', '--no-install-recommends', ...packages[tool]], { timeout: 300_000, env });
  if (tool === 'mail') {
    await mkdir(MAIL_ROOT, { recursive: true, mode: 0o750 });
    await chmod(MAIL_ROOT, 0o750);
    await writeFile(MAIL_INSTALL_MARKER, 'Installed by Dashboard Portal. Managed mail configuration may replace package defaults.\n', { mode: 0o640 });
    await chmod(MAIL_INSTALL_MARKER, 0o640);
  }
  return { version: 'Installed' };
}

async function mailPortReadiness() {
  const unknown = (source, detail) => ({ scope: 'local-firewall', checkedAt: new Date().toISOString(), externalReachability: 'unverified', ports: [25, 587, 993].map((port) => ({ port, status: 'unknown', source, detail })) });
  if (!await exists('/usr/sbin/ufw')) return unknown('firewall-unmanaged', 'UFW is not installed; Portal will not expose this port automatically.');
  const output = await run('/usr/sbin/ufw', ['status'], { failure: 'Could not inspect the host firewall.' }).catch(() => null);
  if (!output) return unknown('ufw-unavailable', 'Could not read UFW policy.');
  if (/^Status:\s*inactive/im.test(output)) {
    return { scope: 'local-firewall', checkedAt: new Date().toISOString(), externalReachability: 'unverified', ports: [25, 587, 993].map((port) => ({ port, status: 'allowed', source: 'ufw-inactive', detail: 'UFW is inactive; provider/network firewall is still unverified.' })) };
  }
  if (!/^Status:\s*active/im.test(output)) return unknown('ufw-unknown', 'UFW did not report an active or inactive policy.');
  const ports = [25, 587, 993].map((port) => {
    const allowed = new RegExp(`^\\s*${port}(?:/tcp)?\\s+ALLOW\\s+`, 'im').test(output);
    const blocked = new RegExp(`^\\s*${port}(?:/tcp)?\\s+(?:DENY|REJECT)\\s+`, 'im').test(output);
    if (allowed) return { port, status: 'allowed', source: 'ufw', detail: 'Allowed by UFW; provider/network firewall is still unverified.' };
    if (blocked) return { port, status: 'blocked', source: 'ufw', detail: 'Blocked by UFW.' };
    return { port, status: 'blocked', source: 'ufw-default', detail: 'No matching UFW allow rule was found.' };
  });
  return { scope: 'local-firewall', checkedAt: new Date().toISOString(), externalReachability: 'unverified', ports };
}

async function configureMail() {
  await assertMailInstallation();
  const mail = await readManagedMailState();
  let plan = validatedMailPlan(mail);
  const vmail = await ensureVmailAccount();
  let certificate = null;
  let certificateNotice = null;
  if (plan.needsPublicCertificate) {
    try { certificate = await issueMailCertificate(mail.hostname); }
    catch {
      plan = { ...plan, inbound: { smtp: false, submission: false, imaps: false }, needsPublicCertificate: false, disabledPorts: [25, 587, 993] };
      certificateNotice = 'Mail services remain loopback-only because a public TLS certificate could not be issued.';
    }
  }
  await mkdir(MAIL_ROOT, { recursive: true, mode: 0o750 });
  await mkdir(MAIL_POSTFIX_ROOT, { recursive: true, mode: 0o755 });
  await mkdir(MAIL_VMAIL_ROOT, { recursive: true, mode: 0o750 });
  await chown(MAIL_VMAIL_ROOT, vmail.uid, vmail.gid);
  await chmod(MAIL_VMAIL_ROOT, 0o750);
  await writeMailMaps(mail);
  await writeDkimMaterial(mail);
  await writeRelayCredentials(mail);
  await writeFile('/etc/postfix/main.cf', renderPostfixMain({ hostname: mail.hostname, domains: mail.domains.map((item) => item.domain), outboundMode: mail.outboundMode, relay: mail.relay, plan, certificate, vmail }), { mode: 0o644 });
  await writeFile('/etc/postfix/master.cf', renderPostfixMaster(plan), { mode: 0o644 });
  await writeFile('/etc/dovecot/conf.d/99-hostmgr-mail.conf', renderDovecotConfiguration({ plan, certificate, vmail }), { mode: 0o640 });
  await writeFile('/etc/opendkim.conf', renderOpenDkimConfiguration(), { mode: 0o644 });
  await run('/usr/sbin/postfix', ['check'], { failure: 'Postfix configuration validation failed.' });
  await run('/usr/bin/systemctl', ['enable', '--now', 'opendkim', 'dovecot', 'postfix'], { failure: 'Mail services could not be enabled.' });
  return { inbound: plan.inbound, externalReachability: plan.externalReachability, notice: certificateNotice };
}

async function createMailbox(domain, localPart, password) {
  await assertMailInstallation();
  const mail = await readManagedMailState();
  validatedMailPlan(mail);
  const safeDomain = validateMailDomain(domain);
  const safeLocalPart = validateMailLocalPart(localPart);
  if (!mail.domains.some((item) => item.domain === safeDomain)) throw new HelperError('Mail domain is not configured.');
  if (typeof password !== 'string' || password.length < 12 || password.length > 512 || /[\r\n\0]/.test(password)) throw new HelperError('Mailbox password is invalid.');
  const address = `${safeLocalPart}@${safeDomain}`;
  const users = await readTextOrEmpty(MAIL_USERS);
  if (users.split('\n').some((line) => line.startsWith(`${address}:`))) throw new HelperError('Mailbox already exists.');
  const vmail = await ensureVmailAccount();
  const hash = await run('/usr/bin/doveadm', ['pw', '-s', 'SHA512-CRYPT'], { input: `${password}\n`, failure: 'Mailbox password could not be secured.' });
  if (!/^\{SHA512-CRYPT\}/.test(hash)) throw new HelperError('Mailbox password could not be secured.');
  await writeFile(MAIL_USERS, `${users.replace(/\s*$/, '')}${users.trim() ? '\n' : ''}${address}:${hash}:${vmail.uid}:${vmail.gid}::${MAIL_VMAIL_ROOT}/${safeDomain}/${safeLocalPart}::\n`, { mode: 0o640 });
  await addMailboxMap(address);
  const home = join(MAIL_VMAIL_ROOT, safeDomain, safeLocalPart);
  await mkdir(join(home, 'Maildir'), { recursive: true, mode: 0o750 });
  await chown(home, vmail.uid, vmail.gid);
  await chown(join(home, 'Maildir'), vmail.uid, vmail.gid);
  await chmod(home, 0o750);
  await chmod(join(home, 'Maildir'), 0o750);
  await run('/usr/bin/systemctl', ['reload', 'dovecot', 'postfix'], { failure: 'Mailbox services could not be reloaded.' });
  return { address };
}

async function deleteMailbox(domain, localPart) {
  await assertMailInstallation();
  const address = `${validateMailLocalPart(localPart)}@${validateMailDomain(domain)}`;
  const users = await readTextOrEmpty(MAIL_USERS);
  const nextUsers = users.split('\n').filter((line) => line && !line.startsWith(`${address}:`));
  if (nextUsers.length === users.split('\n').filter(Boolean).length) throw new HelperError('Mailbox was not found.');
  await writeFile(MAIL_USERS, renderMap(nextUsers), { mode: 0o640 });
  const maps = (await readTextOrEmpty(MAIL_MAILBOXES)).split('\n').filter((line) => line && !line.startsWith(`${address} `));
  await writeFile(MAIL_MAILBOXES, renderMap(maps), { mode: 0o644 });
  await rebuildPostfixMap(MAIL_MAILBOXES, 0o644);
  await run('/usr/bin/systemctl', ['reload', 'dovecot', 'postfix'], { failure: 'Mailbox services could not be reloaded.' });
  return { address };
}

async function removeMailDomain(domain, force) {
  await assertMailInstallation();
  const safeDomain = validateMailDomain(domain);
  const mail = await readManagedMailState();
  const attached = mail.mailboxes.filter((item) => item.domain === safeDomain);
  if (attached.length && !force) throw new HelperError('Delete mailboxes before removing this domain.');
  const remaining = mail.domains.filter((item) => item.domain !== safeDomain);
  if (remaining.length === mail.domains.length) throw new HelperError('Mail domain was not found.');
  const nextMail = { ...mail, domains: remaining, mailboxes: mail.mailboxes.filter((item) => item.domain !== safeDomain) };
  await writeMailMaps(nextMail);
  const tables = renderDkimTables(remaining);
  await writeFile('/etc/opendkim/KeyTable', tables.keyTable, { mode: 0o644 });
  await writeFile('/etc/opendkim/SigningTable', tables.signingTable, { mode: 0o644 });
  await writeFile('/etc/opendkim/TrustedHosts', tables.trustedHosts, { mode: 0o644 });
  await rm(join(MAIL_DKIM_ROOT, safeDomain), { recursive: true, force: true });
  await run('/usr/bin/systemctl', ['reload', 'opendkim', 'postfix'], { failure: 'Mail services could not be reloaded.' });
  return { domain: safeDomain };
}

async function assertMailInstallation() {
  if (!await exists(MAIL_INSTALL_MARKER)) throw new HelperError('Install mail packages through Dashboard Portal before configuring mail.');
}

async function readManagedMailState() {
  let database;
  try {
    database = new DatabaseSync(STATE_DATABASE_PATH, { readOnly: true });
    const raw = database.prepare('SELECT value FROM portal_meta WHERE key = ?').get('mail')?.value;
    if (!raw) throw new HelperError('Mail configuration was not found.');
    const mail = JSON.parse(raw);
    validateMailState(mail);
    return mail;
  } catch (error) {
    if (error instanceof HelperError) throw error;
    throw new HelperError('Mail configuration could not be read.');
  } finally { database?.close(); }
}

function validateMailState(mail) {
  if (!mail || typeof mail !== 'object') throw new HelperError('Mail configuration is invalid.');
  mail.hostname = validateMailDomain(mail.hostname);
  if (!['direct', 'relay-587', 'relay-2525'].includes(mail.outboundMode)) throw new HelperError('Mail outbound mode is invalid.');
  if (!Array.isArray(mail.domains) || !mail.domains.length || mail.domains.length > 10) throw new HelperError('Mail domains are invalid.');
  mail.domains = mail.domains.map((entry) => {
    const domain = validateMailDomain(entry?.domain);
    const selector = entry?.dkim?.selectors?.find((item) => item?.state === 'active') ?? entry?.dkim?.selectors?.[0];
    if (!selector || !/^[a-z][a-z0-9-]{1,63}$/i.test(selector.selector) || !validEncryptedSecret(selector.encryptedPrivateKey)) throw new HelperError('Mail DKIM configuration is invalid.');
    if (entry?.dns?.mx?.status !== 'verified' || entry?.dns?.spf?.status !== 'verified' || entry?.dns?.dkim?.status !== 'verified' || entry?.dns?.dmarc?.status !== 'verified') throw new HelperError('Mail DNS records must be verified before host configuration.');
    return { ...entry, domain, dkim: { selectors: [selector] } };
  });
  if (mail.hostnameCheck?.status !== 'ok') throw new HelperError('Mail hostname DNS must resolve directly to this host.');
  if (mail.outboundMode === 'direct' && mail.ptr?.status !== 'verified') throw new HelperError('Direct mail requires a verified PTR record.');
  if (mail.outboundMode !== 'direct') {
    if (!mail.relay || typeof mail.relay.host !== 'string' || !/^[a-z0-9][a-z0-9.-]{0,251}[a-z0-9]$/i.test(mail.relay.host) || !Number.isInteger(mail.relay.port) || !validEncryptedSecret(mail.relay.encryptedSecret)) throw new HelperError('Mail relay configuration is invalid.');
  }
  mail.mailboxes = Array.isArray(mail.mailboxes) ? mail.mailboxes.map((item) => ({ ...item, domain: validateMailDomain(item?.domain), localPart: validateMailLocalPart(item?.localPart) })) : [];
}

function validatedMailPlan(mail) {
  try { return buildMailPortPlan({ outboundMode: mail.outboundMode, outbound: mail.readiness?.outbound, inbound: mail.readiness?.inbound }); }
  catch (error) { throw new HelperError(String(error?.message ?? 'Mail readiness check is required.')); }
}

function validateMailDomain(value) {
  const domain = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!/^(?=.{1,253}$)(?!-)(?:[a-z0-9-]{1,63}\.)+[a-z]{2,63}$/.test(domain)) throw new HelperError('Mail domain is invalid.');
  return domain;
}

function validateMailLocalPart(value) {
  const localPart = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!/^[a-z0-9](?:[a-z0-9.!#$%&'*+/=?^_`{|}~-]{0,62}[a-z0-9])?$/.test(localPart) || localPart.includes('..')) throw new HelperError('Mailbox local part is invalid.');
  return localPart;
}

function validEncryptedSecret(value) {
  return value && typeof value === 'object' && value.algorithm === 'aes-256-gcm' && [value.iv, value.tag, value.ciphertext].every((item) => typeof item === 'string' && /^[A-Za-z0-9+/]+={0,2}$/.test(item));
}

async function ensureVmailAccount() {
  const groupExists = await run('/usr/bin/getent', ['group', 'vmail'], { failure: 'Could not inspect the mail account.' }).then(() => true).catch(() => false);
  if (!groupExists) await run('/usr/sbin/groupadd', ['--system', 'vmail'], { failure: 'Mail account could not be created.' });
  const userExists = await run('/usr/bin/getent', ['passwd', 'vmail'], { failure: 'Could not inspect the mail account.' }).then(() => true).catch(() => false);
  if (!userExists) await run('/usr/sbin/useradd', ['--system', '--gid', 'vmail', '--home-dir', MAIL_VMAIL_ROOT, '--shell', '/usr/sbin/nologin', 'vmail'], { failure: 'Mail account could not be created.' });
  return { uid: await lookupUserId('vmail'), gid: await lookupGroupId('vmail') };
}

async function writeMailMaps(mail) {
  await mkdir(MAIL_POSTFIX_ROOT, { recursive: true, mode: 0o755 });
  await chmod(MAIL_POSTFIX_ROOT, 0o755);
  await writeFile(MAIL_DOMAINS, renderMap(mail.domains.map((item) => `${item.domain} OK`)), { mode: 0o644 });
  await writeFile(MAIL_MAILBOXES, renderMap(mail.mailboxes.map((item) => `${item.localPart}@${item.domain} ${item.localPart}@${item.domain}`)), { mode: 0o644 });
  await writeFile(MAIL_USERS, await preserveUsersFor(mail.mailboxes), { mode: 0o640 });
  await rebuildPostfixMap(MAIL_DOMAINS, 0o644);
  await rebuildPostfixMap(MAIL_MAILBOXES, 0o644);
}

async function preserveUsersFor(mailboxes) {
  const allowed = new Set(mailboxes.map((item) => `${item.localPart}@${item.domain}`));
  return renderMap((await readTextOrEmpty(MAIL_USERS)).split('\n').filter((line) => line && allowed.has(line.split(':', 1)[0])));
}

async function addMailboxMap(address) {
  const maps = (await readTextOrEmpty(MAIL_MAILBOXES)).split('\n').filter(Boolean);
  maps.push(`${address} ${address}`);
  await writeFile(MAIL_MAILBOXES, renderMap(maps), { mode: 0o644 });
  await rebuildPostfixMap(MAIL_MAILBOXES, 0o644);
}

async function rebuildPostfixMap(path, mode = 0o644) {
  await run('/usr/sbin/postmap', [path], { failure: 'Postfix address map could not be rebuilt.' });
  await chmod(`${path}.db`, mode).catch(() => {});
}

async function writeDkimMaterial(mail) {
  const opendkimGid = await lookupGroupId('opendkim');
  const tables = renderDkimTables(mail.domains);
  await mkdir(MAIL_DKIM_ROOT, { recursive: true, mode: 0o750 });
  for (const domain of mail.domains) {
    const selector = domain.dkim.selectors[0];
    const directory = join(MAIL_DKIM_ROOT, domain.domain);
    const keyPath = join(directory, `${selector.selector}.private`);
    await mkdir(directory, { recursive: true, mode: 0o750 });
    await chown(directory, 0, opendkimGid);
    await chmod(directory, 0o750);
    await writeFile(keyPath, await decryptMailSecret(selector.encryptedPrivateKey), { mode: 0o600 });
    await chown(keyPath, 0, opendkimGid);
    await chmod(keyPath, 0o600);
  }
  await writeFile('/etc/opendkim/KeyTable', tables.keyTable, { mode: 0o644 });
  await writeFile('/etc/opendkim/SigningTable', tables.signingTable, { mode: 0o644 });
  await writeFile('/etc/opendkim/TrustedHosts', tables.trustedHosts, { mode: 0o644 });
}

async function writeRelayCredentials(mail) {
  if (mail.outboundMode === 'direct') {
    await rm(MAIL_SASL, { force: true });
    await rm(`${MAIL_SASL}.db`, { force: true });
    return;
  }
  const password = await decryptMailSecret(mail.relay.encryptedSecret);
  await writeFile(MAIL_SASL, `[${mail.relay.host}]:${mail.relay.port} ${mail.relay.username}:${password}\n`, { mode: 0o600 });
  await rebuildPostfixMap(MAIL_SASL, 0o600);
  await chmod(MAIL_SASL, 0o600);
  await chmod(`${MAIL_SASL}.db`, 0o600).catch(() => {});
}

async function decryptMailSecret(payload) {
  const config = await readFile(CONFIG_PATH, 'utf8').catch(() => '');
  const encodedKey = config.match(/^HOSTMGR_SECRET_KEY=([^\r\n]+)$/m)?.[1] ?? '';
  const key = Buffer.from(encodedKey, 'base64');
  if (key.length !== 32 || !validEncryptedSecret(payload)) throw new HelperError('Mail secret could not be read.');
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(payload.ciphertext, 'base64')), decipher.final()]).toString('utf8');
  } catch { throw new HelperError('Mail secret could not be read.'); }
}

async function issueMailCertificate(hostname) {
  await ensureUnmatchedNginx();
  const email = await acmeEmail();
  await run('/usr/bin/certbot', ['certonly', '--webroot', '--webroot-path', ACME_ROOT, '--non-interactive', '--agree-tos', '--email', email, '--keep-until-expiring', '--expand', '--cert-name', 'hostmgr-mail', '-d', hostname], {
    timeout: 180_000,
    failure: 'Mail TLS certificate request failed.'
  });
  return { fullchain: `${MAIL_CERTIFICATE}/fullchain.pem`, privateKey: `${MAIL_CERTIFICATE}/privkey.pem` };
}

async function readTextOrEmpty(path) { return readFile(path, 'utf8').catch(() => ''); }

async function activateProject(slug, releaseId) {
  const project = await loadProject(slug);
  validateReleaseId(releaseId);
  const release = project.deployment?.releases?.find((item) => item.id === releaseId);
  if (!release || !['candidate', 'healthy'].includes(release.status)) throw new HelperError('The requested release is not eligible for activation.');
  let transaction;
  try {
    transaction = project.runtime === 'docker-compose'
      ? await prepareDockerProjectRelease(project, releaseId)
      : await prepareProjectRelease(project, releaseId);
  } catch (error) {
    throw helperFailure(error, 'Host preparation failed before the project service could be activated.');
  }
  try {
    if (project.runtime === 'docker-compose') await startAndCheckDockerProject(project, transaction);
    else await startAndCheckProject(project, transaction);
  } catch (error) {
    await transaction.rollback();
    throw helperFailure(error, 'The project service could not be started or did not pass its host health check.');
  }
  try {
    await applyDomains(project);
    const cleanedNodeModules = project.runtime === 'docker-compose'
      ? 0
      : await pruneHistoricalNodeModules(transaction.identity, releaseId, transaction.previousTarget).catch(() => 0);
    return { releaseId, domains: project.domains.hosts, cleanedNodeModules };
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

async function removeProjectDomains(slug) {
  await loadProjectForDeletion(slug);
  await removeManagedNginx(slug);
  return { domains: [] };
}

async function deleteProject(slug) {
  const project = await loadProjectForDeletion(slug);
  const identity = projectIdentity(slug);
  if (project.runtime === 'docker-compose') {
    const current = await readlink(identity.current).catch(() => null);
    if (current) await runDockerCompose(project, current, ['down', '--remove-orphans']).catch(() => {});
  } else {
    await run('/usr/bin/systemctl', ['disable', '--now', identity.service]).catch(() => {});
    await rm(identity.unitFile, { force: true });
    await run('/usr/bin/systemctl', ['daemon-reload']);
  }
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
  const project = readProject(slug);
  if (!project) throw new HelperError('Project was not found.');
  return project;
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
  project.runtime ??= 'node';
  if (!['node', 'bun', 'docker-compose'].includes(project.runtime)) throw new HelperError('Project runtime is invalid.');
  if (['node', 'bun'].includes(project.runtime) && (typeof project.startScript !== 'string' || !/^[a-zA-Z0-9:_-]{1,64}$/.test(project.startScript))) throw new HelperError('Project start script is invalid.');
  if (project.runtime === 'docker-compose') {
    if (typeof project.composeFile !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,239}\.ya?ml$/i.test(project.composeFile) || project.composeFile.includes('..')) throw new HelperError('Docker Compose file is invalid.');
    if (typeof project.composeService !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/.test(project.composeService)) throw new HelperError('Docker Compose service is invalid.');
  }
  if (project.healthCheckEnabled !== false && !/^\/(?!\/)[^\s]*$/.test(project.healthCheckPath ?? '/')) throw new HelperError('Project health-check path is invalid.');
  if (!Array.isArray(project.domains?.hosts) || project.domains.hosts.length < 1 || project.domains.hosts.length > 10) throw new HelperError('Project has no valid domain configuration.');
  project.domains.hosts = [...new Set(project.domains.hosts.map(validateDomain))];
}

async function prepareProjectRelease(project, releaseId) {
  const identity = projectIdentity(project.slug);
  await ensureProjectUser(identity);
  await mkdir(identity.releases, { recursive: true, mode: 0o750 });
  // mkdir runs as the root-owned helper after ensureProjectUser has corrected
  // the project root. Ensure a newly-created releases parent remains
  // traversable by the project's systemd account as well.
  await run('/usr/bin/chown', ['--no-dereference', `${identity.user}:${identity.user}`, identity.releases]);
  await chmod(identity.releases, 0o750);
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

async function prepareDockerProjectRelease(project, releaseId) {
  const identity = projectIdentity(project.slug);
  await mkdir(identity.root, { recursive: true, mode: 0o750 });
  await mkdir(identity.releases, { recursive: true, mode: 0o750 });
  const source = join(PROJECT_ROOT, project.slug, 'releases', releaseId);
  await assertDirectory(source, 'Candidate release is unavailable.');
  const destination = join(identity.releases, releaseId);
  if (!(await exists(destination))) {
    const staging = join(identity.root, `.release-${releaseId}.staging`);
    await rm(staging, { recursive: true, force: true });
    await cp(source, staging, { recursive: true, dereference: false, filter: (entry) => basename(entry) !== '.git' });
    await rename(staging, destination);
  }
  const composePath = join(destination, project.composeFile);
  await assertComposeProject(project, composePath);
  const previousTarget = await readlink(identity.current).catch(() => null);
  const nextLink = `${identity.current}.${releaseId}.next`;
  await rm(nextLink, { force: true });
  await symlink(destination, nextLink);
  await rename(nextLink, identity.current);
  return {
    identity,
    previousTarget,
    releaseRoot: destination,
    rollback: async () => {
      await runDockerCompose(project, destination, ['down', '--remove-orphans']).catch(() => {});
      if (previousTarget) {
        const revert = `${identity.current}.rollback`;
        await rm(revert, { force: true });
        await symlink(previousTarget, revert);
        await rename(revert, identity.current);
        await runDockerCompose(project, previousTarget, ['up', '--detach', '--remove-orphans']).catch(() => {});
      } else await rm(identity.current, { force: true });
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

async function startAndCheckDockerProject(project, transaction) {
  await runDockerCompose(project, transaction.releaseRoot, ['up', '--build', '--detach', '--remove-orphans'], { timeout: 600_000, failure: 'Docker Compose could not build or start the project.' });
  if (project.healthCheckEnabled === false) return;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await healthCheck(project.port, project.healthCheckPath ?? '/')) return;
    await delay(250);
  }
  throw new HelperError('Docker Compose project did not pass its host health check.');
}

async function assertComposeProject(project, composePath) {
  const output = await run(DOCKER, ['compose', '--project-name', dockerProjectName(project.slug), '--file', composePath, 'config', '--format', 'json'], { timeout: 120_000, failure: 'Docker Compose configuration is invalid.' });
  let config;
  try { config = JSON.parse(output); } catch { throw new HelperError('Docker Compose configuration is invalid.'); }
  const service = config?.services?.[project.composeService];
  if (!service || typeof service !== 'object') throw new HelperError('The configured Docker Compose service was not found.');
  for (const item of Object.values(config.services ?? {})) {
    if (!item || typeof item !== 'object') continue;
    if (item.privileged === true || item.network_mode === 'host' || item.pid === 'host' || item.ipc === 'host') throw new HelperError('Docker Compose host/privileged isolation options are not allowed.');
    if (Array.isArray(item.volumes) && item.volumes.some(isHostBindMount)) throw new HelperError('Docker Compose host bind mounts are not allowed. Use named volumes instead.');
  }
  const exposesProjectPort = Array.isArray(service.ports) && service.ports.some((port) => composePortPublishes(port, project.port));
  if (!exposesProjectPort) throw new HelperError('Docker Compose service must publish the configured project port.');
}

function dockerProjectName(slug) { return `hostmgr-${slug}`; }
function isHostBindMount(volume) {
  if (typeof volume === 'string') return /^(?:\.?\.?(?:\/|\\)|\/|[A-Za-z]:[\\/])/.test(volume);
  return volume?.type === 'bind';
}
function composePortPublishes(port, expected) {
  if (typeof port === 'number') return port === expected;
  if (typeof port === 'string') return new RegExp(`(^|:)${expected}(?:\/tcp)?$`).test(port.replace(/^\d+\.\d+\.\d+\.\d+:/, ''));
  const published = Number(port?.published ?? port?.target);
  return published === expected;
}
async function runDockerCompose(project, releaseRoot, args, options = {}) {
  // ProtectHome=true intentionally makes /root read-only for this helper.
  // Docker Compose otherwise lazily creates /root/.docker before it contacts
  // the daemon, so use a root-only managed client directory instead.
  await mkdir(DOCKER_CONFIG_ROOT, { recursive: true, mode: 0o700 });
  await chmod(DOCKER_CONFIG_ROOT, 0o700);
  return run(DOCKER, ['compose', '--project-name', dockerProjectName(project.slug), '--file', join(releaseRoot, project.composeFile), ...args], {
    ...options,
    env: { ...process.env, DOCKER_CONFIG: DOCKER_CONFIG_ROOT }
  });
}

async function applyDomains(project) {
  await ensureUnmatchedNginx();
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
    await assertProjectEdge(project);
  } catch (error) {
    await restoreNginx(site, enabled, snapshot);
    throw error;
  }
}

async function ensureUnmatchedNginx() {
  const site = join(NGINX_AVAILABLE, 'hostmgr-unmatched.conf');
  const enabled = join(NGINX_ENABLED, 'hostmgr-unmatched.conf');
  await writeNginx(site, enabled, renderUnmatchedNginx());
}

async function inspectProjectEdge(slug) {
  return inspectLoadedProjectEdge(await loadProject(slug));
}

async function inspectLoadedProjectEdge(project) {
  const hosts = project.domains?.hosts ?? [];
  if (!hosts.length) throw new HelperError('No project domain is configured.');
  const site = join(NGINX_AVAILABLE, `hostmgr-${project.slug}.conf`);
  const enabled = join(NGINX_ENABLED, `hostmgr-${project.slug}.conf`);
  const siteExists = await exists(site);
  const enabledOk = await readlink(enabled).then((target) => target === site).catch(() => false);
  const dump = await run('/usr/sbin/nginx', ['-T']).catch(() => '');
  const httpProbe = await probeLoopbackHttp(hosts[0], { url: 'http://127.0.0.1/' });
  const upstreamPath = project.healthCheckPath ?? '/';
  const upstreamProbe = await probeLoopbackHttp(hosts[0], { url: `http://127.0.0.1:${project.port}${upstreamPath}` });
  return publicEdgeResult(buildEdgeEvaluation({
    siteExists,
    enabled: enabledOk,
    nginx: dump,
    hosts,
    port: project.port,
    httpProbe,
    upstreamProbe,
    sitePath: site,
    enabledPath: enabled
  }));
}

async function assertProjectEdge(project) {
  const result = await inspectLoadedProjectEdge(project);
  if (result.status === 'ok') return;
  if (result.status === 'default-site') throw new HelperError('Nginx still serves the default site for this domain after reload.');
  if (result.status === 'upstream-down') throw new HelperError('The project process is not answering on its port.');
  throw new HelperError('Nginx did not load the managed reverse proxy for this domain after reload.');
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
  await run('/usr/bin/certbot', args, {
    timeout: 180_000,
    failure: 'TLS certificate request failed. Confirm the domain resolves to this host, port 80 is reachable, and any CDN proxy or HTTPS redirect is disabled during HTTP-01 validation.'
  });
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
  const runtimeDirectory = `hostmgr-project-${slug}`;
  return { user, root, releases: join(root, 'releases'), current: join(root, 'current'), runtimeDirectory, runtimeApplicationPath: join('/run', runtimeDirectory, 'app'), service: `hostmgr-project-${slug}.service`, unitFile: join('/etc/systemd/system', `hostmgr-project-${slug}.service`), environmentFile: join(ENVIRONMENT_ROOT, `${slug}.env`), gid: null };
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
  // Some shadow-utils versions can leave this zero-byte file after a completed
  // account operation. Clear it only after this helper's account operation.
  await rm('/etc/.pwd.lock', { force: true });
}

function renderProjectUnit(project, identity) {
  const bunRuntime = project.runtime === 'bun';
  const workingDirectory = bunRuntime ? identity.runtimeApplicationPath : identity.current;
  const bunSandbox = bunRuntime ? `RuntimeDirectory=${identity.runtimeDirectory}/app\nRuntimeDirectoryMode=0750\nBindPaths=${identity.current}:${identity.runtimeApplicationPath}\n` : '';
  return `[Unit]\nDescription=Dashboard Portal project ${project.slug}\nAfter=network-online.target\nWants=network-online.target\n\n[Service]\nType=simple\nUser=${identity.user}\nGroup=${identity.user}\n${bunSandbox}WorkingDirectory=${workingDirectory}\nEnvironmentFile=${identity.environmentFile}\nEnvironment=PORT=${project.port}\nExecStart=${project.runtime === 'bun' ? BUN : NPM} run ${project.startScript}\nRestart=on-failure\nRestartSec=5\nNoNewPrivileges=true\nPrivateTmp=true\nProtectHome=true\nProtectSystem=strict\nReadWritePaths=${identity.root}\n\n[Install]\nWantedBy=multi-user.target\n`;
}

async function pruneHistoricalNodeModules(identity, activeReleaseId, previousTarget) {
  const keep = new Set([activeReleaseId]);
  const previousReleaseId = previousTarget ? basename(previousTarget) : null;
  if (/^[a-f0-9-]{36}$/i.test(previousReleaseId ?? '')) keep.add(previousReleaseId);
  const entries = await readdir(identity.releases, { withFileTypes: true });
  let cleaned = 0;
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[a-f0-9-]{36}$/i.test(entry.name) || keep.has(entry.name)) continue;
    const dependencies = join(identity.releases, entry.name, 'node_modules');
    if (await lstat(dependencies).catch(() => null)) {
      await rm(dependencies, { recursive: true, force: true, maxRetries: 2 });
      cleaned += 1;
    }
  }
  return cleaned;
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
async function lookupUserId(user) {
  const value = await run('/usr/bin/id', ['-u', user]);
  if (!/^\d+$/.test(value)) throw new HelperError('Mail service user is invalid.');
  return Number(value);
}
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
    const { failure = 'A required host operation failed.', input, ...spawnOptions } = options;
    const child = spawn(command, args, { shell: false, stdio: ['pipe', 'pipe', 'pipe'], timeout: 120_000, ...spawnOptions });
    let stdout = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.resume();
    child.stdin.on('error', () => {});
    child.stdin.end(typeof input === 'string' ? input : undefined);
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
