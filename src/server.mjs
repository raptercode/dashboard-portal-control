import { createServer } from 'node:http';
import { chmod, cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { StateStore, TOOLS, SUPPORTED_NODE_MAJOR, SecretVault, appendAudit, validateDomain, validateEnvironmentContent, validateGitBranchRequest, validateGitIdentity, validateHttpsCredential, validatePasswordChange, validateProjectDomains, validateProjectSync, validateTool, InputError } from './core.mjs';
import { checkDomainDns } from './dns-check.mjs';
import { activateRelease, appendReleaseEvent, beginDeployment, beginRollback, createRelease, failRelease, initialDeployment, markReleaseHealthy, markReleasePendingActivation, projectIdentity, validateNativeProject, validatePackageScripts } from './native-project.mjs';
import { callHostHelper } from './helper-client.mjs';
import { softwareUpdateStatus, updateConfiguration } from '../scripts/software-update.mjs';
import { passwordFromEnvironment } from '../scripts/password-config.mjs';
import { createRenderer } from './render.mjs';
import { matchUiRoute } from './ui-routes.mjs';
import { METRIC_INTERVAL_MS, METRIC_RANGE_DAYS, METRIC_RETENTION_DAYS, collectHostMetrics, publicCurrentMetrics, publicMetricSample, validateMetricRangeDays } from './metrics.mjs';
import { hashPassword, publicOwner, validateOwnerBootstrap, validateOwnerLogin, verifyPassword } from './auth.mjs';
import { DATABASE_PROVIDERS, probeDatabaseConnection, publicDatabaseConnection, validateDatabaseConnectionInput } from './db-connectors.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const publicDir = join(here, '..', 'public');
const uiDir = join(publicDir, 'ui');
const viewsDir = join(here, '..', 'views');
const renderView = createRenderer(viewsDir);
const contentTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8' };
const pageTitles = {
  overview: 'ภาพรวม',
  setup: 'การตั้งค่า',
  projects: 'โปรเจค',
  credentials: 'Credentials',
  databases: 'Databases',
  activity: 'กิจกรรม',
  settings: 'การตั้งค่าระบบ',
  'projects-new': 'สร้างโปรเจค',
  'projects-new-repository': 'สร้างโปรเจค',
  'projects-new-review': 'สร้างโปรเจค',
  'project-logs': 'Logs'
};
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const HOST_TOOL_COMMANDS = {
  nginx: [['/usr/sbin/nginx', ['-v']]],
  certbot: [['/usr/bin/certbot', ['--version']]],
  git: [['/usr/bin/git', ['--version']]],
  docker: [['/usr/bin/docker', ['--version']], ['/usr/bin/docker', ['compose', 'version']]]
};

export async function createApplication(options = {}) {
  const mode = options.mode ?? process.env.HOSTMGR_MODE ?? 'demo';
  const explicitPassword = options.password;
  let legacyPassword = explicitPassword ?? passwordFromEnvironment(process.env) ?? null;
  if (legacyPassword != null && legacyPassword.length < 12) throw new Error('HOSTMGR_ADMIN_PASSWORD must be at least 12 characters.');
  const secureCookie = options.secureCookie ?? process.env.HOSTMGR_SECURE_COOKIE === 'true';
  const vaultKey = options.secretKey ?? process.env.HOSTMGR_SECRET_KEY;
  const vault = vaultKey ? new SecretVault(vaultKey) : null;
  const sandboxClone = options.sandboxClone ?? process.env.HOSTMGR_SANDBOX_CLONE !== 'false';
  const uiDemo = mode === 'demo' && !sandboxClone;
  const projectRoot = options.projectRoot ?? process.env.HOSTMGR_PROJECT_ROOT ?? (mode === 'demo' ? join(here, '..', 'data', 'projects') : '/var/lib/hostmgr/projects');
  const toolProbe = options.toolProbe ?? probeHostTools;
  const softwareUpdateConfig = updateConfiguration(options.updateConfig ?? process.env);
  const softwareUpdateFetcher = options.updateFetcher ?? fetch;
  const softwareVersion = options.softwareVersion ?? await installedSoftwareVersion();
  const domainDnsCheck = options.domainDnsCheck ?? checkDomainDns;
  const branchFetcher = options.branchFetcher ?? listRemoteBranches;
  const store = new StateStore(options.dataPath ?? process.env.HOSTMGR_DATABASE_PATH ?? process.env.HOSTMGR_DATA_PATH ?? join(here, '..', 'data', 'state.sqlite'));
  if (!['demo', 'host'].includes(mode)) throw new Error('HOSTMGR_MODE must be demo or host.');
  await store.load();
  if (!store.snapshot().owner && explicitPassword) {
    const seeded = hashPassword(explicitPassword);
    await store.update((state) => {
      state.owner = {
        email: options.ownerEmail ?? 'owner@local.test',
        password: seeded,
        createdAt: new Date().toISOString()
      };
    });
  }
  const sessions = new Map((store.snapshot().sessions ?? [])
    .filter((session) => validStoredSession(session))
    .map((session) => [session.idHash, { csrf: session.csrf, expiresAt: session.expiresAt }]));
  const loginAttempts = new Map();
  let deploymentQueueDraining = false;
  const metricsIntervalMs = options.metricsIntervalMs ?? METRIC_INTERVAL_MS;
  const metricsEnabled = options.metricsEnabled !== false;
  let metricsTimer = null;

  async function captureMetricSample() {
    const sample = await collectHostMetrics();
    store.recordMetricSample(sample);
    store.pruneMetricSamples(Date.now() - METRIC_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    return sample;
  }

  if (metricsEnabled) {
    captureMetricSample().catch(() => {});
    metricsTimer = setInterval(() => { captureMetricSample().catch(() => {}); }, metricsIntervalMs);
    if (typeof metricsTimer.unref === 'function') metricsTimer.unref();
  }

  async function newSession() {
    const id = randomBytes(32).toString('base64url');
    const csrf = randomBytes(32).toString('base64url');
    const idHash = sessionIdHash(id);
    const expiresAt = Date.now() + SESSION_TTL_SECONDS * 1000;
    sessions.set(idHash, { csrf, expiresAt });
    await store.update((state) => {
      state.sessions = (state.sessions ?? []).filter((session) => validStoredSession(session));
      state.sessions.push({ idHash, csrf, expiresAt });
    });
    return { id, csrf };
  }

  function getSession(request) {
    const cookie = request.headers.cookie ?? '';
    const id = cookie.split(';').map((entry) => entry.trim()).find((entry) => entry.startsWith('hostmgr_session='))?.slice('hostmgr_session='.length);
    const idHash = id && sessionIdHash(id);
    const session = idHash && sessions.get(idHash);
    if (!session || session.expiresAt < Date.now()) {
      if (idHash) sessions.delete(idHash);
      return null;
    }
    return { id, idHash, ...session };
  }

  function requireSession(request, response, csrf = false) {
    const session = getSession(request);
    if (!session) {
      sendJson(response, 401, { error: 'Authentication required.' });
      return null;
    }
    if (csrf && !constantEqual(request.headers['x-csrf-token'], session.csrf)) {
      sendJson(response, 403, { error: 'Invalid CSRF token.' });
      return null;
    }
    return session;
  }

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://hostmgr.local');
      if (request.method === 'GET' && !url.pathname.startsWith('/api/') && url.searchParams.has('password')) {
        url.searchParams.delete('password');
        response.writeHead(303, { Location: `${url.pathname}${url.search}${url.hash}`, 'Cache-Control': 'no-store' });
        return response.end();
      }
      if (request.method === 'GET' && url.pathname === '/api/health') return sendJson(response, 200, { status: 'ok', mode, node: process.version });
      if (request.method === 'GET' && url.pathname === '/api/session') {
        const session = getSession(request);
        const owner = store.snapshot().owner;
        return sendJson(response, 200, {
          authenticated: Boolean(session),
          csrfToken: session?.csrf ?? null,
          mode,
          bootstrapRequired: !owner,
          bootstrapRequiresInstallerPassword: !owner && Boolean(legacyPassword),
          owner: publicOwner(owner)
        });
      }
      if (request.method === 'POST' && url.pathname === '/api/bootstrap') return await handleBootstrap(request, response);
      if (request.method === 'POST' && url.pathname === '/api/login') return await handleLogin(request, response);
      if (request.method === 'POST' && url.pathname === '/api/settings/password') return await handlePasswordChange(request, response);
      if (request.method === 'POST' && url.pathname === '/api/logout') {
        const session = requireSession(request, response, true);
        if (!session) return;
        sessions.delete(session.idHash);
        await store.update((state) => { state.sessions = (state.sessions ?? []).filter((entry) => entry.idHash !== session.idHash); });
        response.setHeader('Set-Cookie', expiredCookie(secureCookie));
        return sendJson(response, 200, { ok: true });
      }
      if (request.method === 'GET' && url.pathname === '/api/doctor') {
        if (!requireSession(request, response)) return;
        return sendJson(response, 200, await doctorReport(store.snapshot(), mode, toolProbe));
      }
      if (request.method === 'GET' && url.pathname === '/api/metrics') {
        if (!requireSession(request, response)) return;
        return await handleMetrics(request, response, url);
      }
      if (request.method === 'GET' && url.pathname === '/api/audit') {
        if (!requireSession(request, response)) return;
        return sendJson(response, 200, { events: store.snapshot().audit });
      }
      if (request.method === 'GET' && url.pathname === '/api/software-update') {
        if (!requireSession(request, response)) return;
        return sendJson(response, 200, await softwareUpdateStatus({ config: softwareUpdateConfig, currentVersion: softwareVersion, fetcher: softwareUpdateFetcher }));
      }
      if (request.method === 'GET' && url.pathname === '/api/git-config') {
        if (!requireSession(request, response)) return;
        return sendJson(response, 200, store.snapshot().git);
      }
      if (request.method === 'POST' && url.pathname === '/api/git-config') return await handleGitConfig(request, response);
      if (request.method === 'GET' && url.pathname === '/api/projects') {
        if (!requireSession(request, response)) return;
        return sendJson(response, 200, { projects: store.snapshot().projects.map(publicProject) });
      }
      if (request.method === 'POST' && url.pathname === '/api/git/branches') return await handleGitBranches(request, response);
      if (request.method === 'POST' && url.pathname === '/api/projects/sync') return await handleProjectSync(request, response);
      const jobMatch = url.pathname.match(/^\/api\/jobs\/([a-f0-9-]{36})$/i);
      if (request.method === 'GET' && jobMatch) return await handleJobStatus(request, response, jobMatch[1]);
      const deleteMatch = url.pathname.match(/^\/api\/projects\/([a-z][a-z0-9-]{0,62})$/);
      if (request.method === 'DELETE' && deleteMatch) return await handleProjectDelete(request, response, deleteMatch[1]);
      const deployMatch = url.pathname.match(/^\/api\/projects\/([a-z][a-z0-9-]{0,62})\/deploy$/);
      if (request.method === 'POST' && deployMatch) return await handleProjectDeploy(request, response, deployMatch[1]);
      const rollbackMatch = url.pathname.match(/^\/api\/projects\/([a-z][a-z0-9-]{0,62})\/rollback$/);
      if (request.method === 'POST' && rollbackMatch) return await handleProjectRollback(request, response, rollbackMatch[1]);
      const envMatch = url.pathname.match(/^\/api\/projects\/([a-z][a-z0-9-]{0,62})\/environment$/);
      if (request.method === 'POST' && envMatch) return await handleProjectEnvironment(request, response, envMatch[1]);
      const domainsCheckMatch = url.pathname.match(/^\/api\/projects\/([a-z][a-z0-9-]{0,62})\/domains\/check$/);
      if (request.method === 'POST' && domainsCheckMatch) return await handleProjectDomainCheck(request, response, domainsCheckMatch[1]);
      const domainsMatch = url.pathname.match(/^\/api\/projects\/([a-z][a-z0-9-]{0,62})\/domains$/);
      if (request.method === 'POST' && domainsMatch) return await handleProjectDomains(request, response, domainsMatch[1]);
      const logsMatch = url.pathname.match(/^\/api\/projects\/([a-z][a-z0-9-]{0,62})\/logs$/);
      if (request.method === 'GET' && logsMatch) return await handleProjectLogs(request, response, logsMatch[1]);
      if (request.method === 'GET' && url.pathname === '/api/credentials') {
        if (!requireSession(request, response)) return;
        return sendJson(response, 200, { credentials: store.snapshot().credentials.map(publicCredential), vaultReady: Boolean(vault) });
      }
      if (request.method === 'POST' && url.pathname === '/api/credentials') return await handleCredential(request, response);
      if (request.method === 'GET' && url.pathname === '/api/databases') {
        if (!requireSession(request, response)) return;
        return sendJson(response, 200, {
          providers: Object.values(DATABASE_PROVIDERS),
          connections: store.snapshot().databaseConnections.map(publicDatabaseConnection),
          vaultReady: Boolean(vault)
        });
      }
      if (request.method === 'POST' && url.pathname === '/api/databases') return await handleDatabaseCreate(request, response);
      const databaseCheckMatch = url.pathname.match(/^\/api\/databases\/([a-f0-9-]{36})\/check$/i);
      if (request.method === 'POST' && databaseCheckMatch) return await handleDatabaseCheck(request, response, databaseCheckMatch[1]);
      const databaseDeleteMatch = url.pathname.match(/^\/api\/databases\/([a-f0-9-]{36})$/i);
      if (request.method === 'DELETE' && databaseDeleteMatch) return await handleDatabaseDelete(request, response, databaseDeleteMatch[1]);
      const toolMatch = url.pathname.match(/^\/api\/tools\/(nginx|certbot|git|docker)\/install$/);
      if (request.method === 'POST' && toolMatch) return await handleInstall(request, response, toolMatch[1]);
      if (url.pathname.startsWith('/api/')) return sendJson(response, 404, { error: 'API endpoint not found.' });
      return await serveStatic(url.pathname, response);
    } catch (error) {
      return sendCaughtError(response, error);
    }
  });

  async function handleMetrics(request, response, url) {
    const rangeDays = validateMetricRangeDays(url.searchParams.get('range') ?? '1');
    const current = await collectHostMetrics();
    const since = Date.now() - rangeDays * 24 * 60 * 60 * 1000;
    const samples = store.listMetricSamples(since).map(publicMetricSample);
    const currentPublic = publicMetricSample(current);
    const lastAt = samples.length ? Date.parse(samples[samples.length - 1].at) : 0;
    if (!samples.length || Date.now() - lastAt > 10_000) samples.push(currentPublic);
    return sendJson(response, 200, {
      rangeDays,
      ranges: METRIC_RANGE_DAYS,
      intervalMinutes: Math.round(METRIC_INTERVAL_MS / 60000),
      retentionDays: METRIC_RETENTION_DAYS,
      updatedAt: new Date().toISOString(),
      current: publicCurrentMetrics(current),
      samples
    });
  }

  async function handleBootstrap(request, response) {
    if (store.snapshot().owner) throw new InputError('Owner account already exists.');
    const requireCurrentPassword = Boolean(legacyPassword);
    const bootstrap = validateOwnerBootstrap(await readJson(request), { requireCurrentPassword });
    if (requireCurrentPassword && !constantEqual(bootstrap.currentPassword, legacyPassword)) {
      await store.update((state) => appendAudit(state, { action: 'auth.bootstrap_failed', outcome: 'denied', actor: 'anonymous', detail: 'Invalid installer password' }));
      return sendJson(response, 401, { error: 'Invalid installer password.' });
    }
    const password = hashPassword(bootstrap.password);
    await store.update((state) => {
      state.owner = { email: bootstrap.email, password, createdAt: new Date().toISOString() };
      appendAudit(state, { action: 'auth.bootstrap', outcome: 'success', actor: 'owner', target: bootstrap.email, detail: 'Owner account created' });
    });
    legacyPassword = bootstrap.password;
    if (mode === 'host') {
      const socketPath = process.env.HOSTMGR_DEPLOY_HELPER_SOCKET;
      if (socketPath) {
        const result = await callHostHelper(socketPath, { operation: 'set-admin-password', password: bootstrap.password });
        if (!result.ok) throw new InputError('Owner was created, but the host password file could not be updated.');
      }
    }
    const session = await newSession();
    response.setHeader('Set-Cookie', sessionCookie(session.id, secureCookie));
    return sendJson(response, 200, { ok: true, csrfToken: session.csrf, mode, owner: publicOwner(store.snapshot().owner) });
  }

  async function handleLogin(request, response) {
    const ip = request.socket.remoteAddress ?? 'unknown';
    const attempt = loginAttempts.get(ip) ?? { count: 0, resetAt: Date.now() + 15 * 60 * 1000 };
    if (attempt.resetAt < Date.now()) loginAttempts.delete(ip);
    if (attempt.count >= 5 && attempt.resetAt >= Date.now()) return sendJson(response, 429, { error: 'Too many login attempts. Try again later.' });
    if (!store.snapshot().owner) return sendJson(response, 409, { error: 'Owner bootstrap is required.', bootstrapRequired: true });
    const body = validateOwnerLogin(await readJson(request));
    const owner = store.snapshot().owner;
    if (body.email !== owner.email || !verifyPassword(body.password, owner.password)) {
      loginAttempts.set(ip, { count: attempt.count + 1, resetAt: attempt.resetAt });
      await store.update((state) => appendAudit(state, { action: 'auth.login_failed', outcome: 'denied', actor: 'anonymous', detail: 'Invalid credentials' }));
      return sendJson(response, 401, { error: 'Invalid credentials.' });
    }
    loginAttempts.delete(ip);
    const session = await newSession();
    response.setHeader('Set-Cookie', sessionCookie(session.id, secureCookie));
    await store.update((state) => appendAudit(state, { action: 'auth.login', outcome: 'success', actor: 'owner', target: owner.email, detail: 'Owner session created' }));
    return sendJson(response, 200, { ok: true, csrfToken: session.csrf, mode, owner: publicOwner(owner) });
  }

  async function handlePasswordChange(request, response) {
    if (!requireSession(request, response, true)) return;
    const owner = store.snapshot().owner;
    if (!owner) throw new InputError('Owner account is not configured.');
    const change = validatePasswordChange(await readJson(request));
    if (!verifyPassword(change.currentPassword, owner.password)) throw new InputError('Current password is incorrect.');
    if (mode === 'host') {
      const socketPath = process.env.HOSTMGR_DEPLOY_HELPER_SOCKET;
      if (!socketPath) throw new InputError('Password management is not configured. Re-run the Dashboard Portal installer.');
      const result = await callHostHelper(socketPath, { operation: 'set-admin-password', password: change.newPassword });
      if (!result.ok) throw new InputError('Password could not be updated.');
    }
    const password = hashPassword(change.newPassword);
    legacyPassword = change.newPassword;
    sessions.clear();
    await store.update((state) => {
      state.owner = { ...state.owner, password, updatedAt: new Date().toISOString() };
      state.sessions = [];
      appendAudit(state, { action: 'auth.password_changed', outcome: 'success', actor: 'owner', detail: 'Owner password changed; existing sessions were invalidated' });
    });
    const renewed = await newSession();
    response.setHeader('Set-Cookie', sessionCookie(renewed.id, secureCookie));
    return sendJson(response, 200, { ok: true, csrfToken: renewed.csrf });
  }

  async function handleDatabaseCreate(request, response) {
    if (!requireSession(request, response, true)) return;
    if (!vault) throw new InputError('Credential vault is not configured. Set HOSTMGR_SECRET_KEY before saving database connectors.');
    const input = validateDatabaseConnectionInput(await readJson(request));
    const created = {
      id: randomUUID(),
      name: input.name,
      provider: input.provider,
      host: input.host,
      port: input.port,
      database: input.database,
      username: input.username,
      tls: input.tls,
      encryptedSecret: input.password ? vault.encrypt(input.password) : null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastCheckedAt: null,
      lastStatus: null
    };
    await store.update((state) => {
      if (state.databaseConnections.some((item) => item.name === created.name)) throw new InputError('A database connection with this name already exists.');
      state.databaseConnections.push(created);
      appendAudit(state, { action: 'database.create', outcome: 'success', actor: 'owner', target: created.name, detail: `${created.provider} connector saved` });
    });
    return sendJson(response, 201, { ok: true, connection: publicDatabaseConnection(created) });
  }

  async function handleDatabaseCheck(request, response, id) {
    if (!requireSession(request, response, true)) return;
    const connection = store.snapshot().databaseConnections.find((item) => item.id === id);
    if (!connection) throw new NotFoundError('Database connection was not found.');
    const secret = connection.encryptedSecret && vault ? vault.decrypt(connection.encryptedSecret) : '';
    try {
      const result = await probeDatabaseConnection(connection, secret);
      await store.update((state) => {
        const target = state.databaseConnections.find((item) => item.id === id);
        if (!target) return;
        target.lastCheckedAt = new Date().toISOString();
        target.lastStatus = 'reachable';
      });
      return sendJson(response, 200, { ok: true, result });
    } catch (error) {
      await store.update((state) => {
        const target = state.databaseConnections.find((item) => item.id === id);
        if (!target) return;
        target.lastCheckedAt = new Date().toISOString();
        target.lastStatus = 'unreachable';
      });
      if (error instanceof InputError) throw error;
      throw new InputError(error.message || 'Database probe failed.');
    }
  }

  async function handleDatabaseDelete(request, response, id) {
    if (!requireSession(request, response, true)) return;
    await store.update((state) => {
      const target = state.databaseConnections.find((item) => item.id === id);
      if (!target) throw new NotFoundError('Database connection was not found.');
      state.databaseConnections = state.databaseConnections.filter((item) => item.id !== id);
      appendAudit(state, { action: 'database.delete', outcome: 'success', actor: 'owner', target: target.name, detail: 'Database connector removed' });
    });
    return sendJson(response, 200, { ok: true });
  }

  async function handleInstall(request, response, tool) {
    const session = requireSession(request, response, true);
    if (!session) return;
    validateTool(tool);
    const body = await readJson(request);
    if (body.confirm !== true) throw new InputError('Explicit confirmation is required.');
    const result = mode === 'demo' ? demoInstall(tool) : await hostInstall(tool);
    await store.update((state) => {
      const item = state.tools[tool];
      item.status = 'Installed';
      item.version = result.version;
      item.simulated = mode === 'demo';
      item.updatedAt = new Date().toISOString();
      appendAudit(state, { action: 'tool.install', outcome: 'success', actor: 'owner', target: tool, detail: result.detail });
    });
    return sendJson(response, 200, { ok: true, tool: store.snapshot().tools[tool], result });
  }

  async function handleGitConfig(request, response) {
    if (!requireSession(request, response, true)) return;
    const identity = validateGitIdentity(await readJson(request));
    await store.update((state) => {
      state.git.identity = identity;
      appendAudit(state, { action: 'git.configure_identity', outcome: 'success', actor: 'owner', target: identity.email, detail: 'Git author identity configured' });
    });
    return sendJson(response, 200, { ok: true, identity });
  }

  async function handleProjectSync(request, response) {
    if (!requireSession(request, response, true)) return;
    const body = await readJson(request);
    const project = validateProjectSync(body);
    const state = store.snapshot();
    const gitTool = mode === 'host' ? (await toolProbe([state.tools.git]))[0] : state.tools.git;
    if (gitTool.status !== 'Installed') throw new InputError('Install Git before syncing a project.');
    if (!state.git.identity) throw new InputError('Configure Git identity before syncing a project.');
    if (project.credentialId && !state.credentials.some((credential) => credential.id === project.credentialId)) throw new InputError('Selected credential was not found.');
    const credential = project.credentialId ? state.credentials.find((item) => item.id === project.credentialId) : null;
    const sync = (mode === 'demo' && sandboxClone) || mode === 'host'
      ? await cloneInSandbox(project, credential, vault, projectRoot)
      : { status: uiDemo ? 'synced' : 'queued', at: new Date().toISOString(), detail: uiDemo ? 'Simulated repository sync for local UI demo.' : 'Project sync queued for the host deployment service.' };
    const syncFailed = sync.status === 'failed';
    await store.update((next) => {
      const index = next.projects.findIndex((item) => item.slug === project.slug);
      const stored = index >= 0 ? next.projects[index] : null;
      // Sync configuration changes must not erase a release history or the
      // encrypted environment already associated with this project.
      const record = syncFailed && stored
        ? { ...stored, sync }
        : { ...stored, ...project, sync, deployment: stored?.deployment ?? initialDeployment() };
      if (index >= 0) next.projects[index] = record;
      else next.projects.push(record);
      appendAudit(next, { action: 'project.sync_configure', outcome: syncFailed ? 'failure' : 'success', actor: 'owner', target: project.slug, detail: syncFailed ? 'Repository sync failed without changing an active release' : `${project.protocol.toUpperCase()} project sync configured` });
    });
    const saved = publicProject(store.snapshot().projects.find((item) => item.slug === project.slug));
    return sendJson(response, syncFailed ? 422 : 200, { ok: !syncFailed, project: saved, error: syncFailed ? sync.detail : undefined });
  }

  async function handleGitBranches(request, response) {
    if (!requireSession(request, response, true)) return;
    const query = validateGitBranchRequest(await readJson(request));
    const state = store.snapshot();
    const gitTool = mode === 'host' ? (await toolProbe([state.tools.git]))[0] : state.tools.git;
    if (gitTool.status !== 'Installed') throw new InputError('Install Git before fetching branches.');
    if (query.credentialId && !state.credentials.some((credential) => credential.id === query.credentialId)) throw new InputError('Selected credential was not found.');
    const credential = query.credentialId ? state.credentials.find((item) => item.id === query.credentialId) : null;
    try {
      const branches = await branchFetcher({ repository: query.repository, credential, vault, scratchRoot: projectRoot });
      return sendJson(response, 200, { branches: normalizeBranches(branches) });
    } catch (error) {
      throw new InputError(`Could not fetch branches: ${safeGitBranchFailure(error)}`);
    }
  }

  async function handleProjectDelete(request, response, slug) {
    if (!requireSession(request, response, true)) return;
    const project = findProject(store.snapshot(), slug);
    if (store.snapshot().jobs.some((item) => item.projectSlug === slug && ['queued', 'running'].includes(item.status))) throw new InputError('Wait for the queued deployment to finish before deleting this project.');
    if (mode === 'host') {
      const socketPath = process.env.HOSTMGR_DEPLOY_HELPER_SOCKET;
      if (!socketPath) throw new InputError('Host project cleanup is not configured. Re-run the Dashboard Portal installer.');
      const result = await callHostHelper(socketPath, { operation: 'delete-project', slug });
      if (!result.ok) throw new InputError('Host project cleanup was rejected. The project was not deleted.');
    }
    await rm(projectWorkspace(project, projectRoot), { recursive: true, force: true });
    await store.update((state) => {
      findProject(state, slug);
      state.projects = state.projects.filter((item) => item.slug !== slug);
      appendAudit(state, { action: 'project.delete', outcome: 'success', actor: 'owner', target: slug, detail: 'Removed project configuration and its managed workspace.' });
    });
    return sendJson(response, 200, { ok: true });
  }

  async function handleProjectDeploy(request, response, slug) {
    if (!requireSession(request, response, true)) return;
    const project = store.snapshot().projects.find((item) => item.slug === slug);
    if (!project) throw new InputError('Project was not found.');
    if (project.sync?.status !== 'synced') throw new InputError('Sync the repository successfully before deploying.');
    if (!project.environment?.keys?.length) throw new InputError('Save at least one project environment variable before deploying.');
    if (!uiDemo && !project.domains?.hosts?.length) throw new InputError('Save at least one project domain before deploying.');
    const nativeProject = validateNativeProject({ ...project, environment: {} });
    if (uiDemo) {
      const release = createRelease(nativeProject, 'demo-simulated-revision');
      await store.update((state) => {
        const target = findProject(state, slug);
        let deployment = beginDeployment(target.deployment, release);
        deployment = markReleaseHealthy(deployment, release.id);
        target.deployment = activateRelease(deployment, release.id);
        appendAudit(state, { action: 'project.deploy', outcome: 'success', actor: 'owner', target: slug, detail: `Simulated activation of release ${release.id}` });
      });
      return sendJson(response, 200, { ok: true, activation: 'complete', project: publicProject(store.snapshot().projects.find((item) => item.slug === slug)) });
    }
    const release = createRelease(nativeProject, await projectRevision(project, projectRoot));
    const job = { id: randomUUID(), kind: 'deploy', projectSlug: slug, releaseId: release.id, status: 'queued', createdAt: new Date().toISOString(), startedAt: null, finishedAt: null, events: [{ at: new Date().toISOString(), status: 'queued', message: 'Deployment is queued.' }], failure: null };
    await store.update((state) => {
      const target = findProject(state, slug);
      if (state.jobs.some((item) => item.projectSlug === slug && ['queued', 'running'].includes(item.status))) throw new InputError('This project already has a queued or running deployment.');
      target.deployment = beginDeployment(target.deployment, release);
      state.jobs = [...state.jobs, job].slice(-100);
      appendAudit(state, { action: 'project.deploy', outcome: 'queued', actor: 'owner', target: slug, detail: `Queued candidate release ${release.id}` });
    });
    scheduleDeploymentQueue();
    return sendJson(response, 202, { ok: true, activation: 'queued', job: publicJob(job), project: publicProject(store.snapshot().projects.find((item) => item.slug === slug)) });
  }

  async function runDeploymentJob(jobId) {
    const job = store.snapshot().jobs.find((item) => item.id === jobId);
    if (!job || job.status !== 'queued') return;
    const project = store.snapshot().projects.find((item) => item.slug === job.projectSlug);
    if (!project) return markJobFailed(jobId, 'Project was removed before deployment started.');
    const release = project.deployment?.releases?.find((item) => item.id === job.releaseId);
    if (!release) return markJobFailed(jobId, 'Candidate release was not found.');
    const nativeProject = validateNativeProject({ ...project, environment: {} });
    await updateJob(jobId, (current) => {
      current.status = 'running';
      current.startedAt = new Date().toISOString();
      appendJobEvent(current, 'running', 'Candidate preparation started.');
    });
    const recordPhase = async (phase, status, detail) => {
      await store.update((state) => {
        const target = findProject(state, job.projectSlug);
        target.deployment = appendReleaseEvent(target.deployment, release.id, phase, status, detail);
        const targetJob = findJob(state, jobId);
        appendJobEvent(targetJob, status, detail, phase);
      });
    };
    try {
      await prepareNativeRelease(nativeProject, release, project, vault, projectRoot, recordPhase);
      await store.update((state) => {
        const target = findProject(state, job.projectSlug);
        target.deployment = markReleaseHealthy(target.deployment, release.id);
        target.deployment = appendReleaseEvent(target.deployment, release.id, 'candidate_health', nativeProject.healthCheckEnabled ? 'passed' : 'skipped', nativeProject.healthCheckEnabled ? 'Candidate health check passed.' : 'Candidate health check was skipped by project configuration.');
      });
      const helperSocket = process.env.HOSTMGR_DEPLOY_HELPER_SOCKET;
      if (!helperSocket) {
        await store.update((state) => {
          const target = findProject(state, job.projectSlug);
          target.deployment = markReleasePendingActivation(target.deployment, release.id);
          appendAudit(state, { action: 'project.deploy', outcome: 'pending_activation', actor: 'owner', target: job.projectSlug, detail: 'Candidate is healthy; a reviewed deployment helper is required to switch the systemd release.' });
        });
        return markJobSucceeded(jobId, 'Candidate is healthy and awaits reviewed host activation.');
      }
      await recordPhase('host_activation', 'started', 'Activating the verified candidate on the host.');
      await activateOnHost(helperSocket, job.projectSlug, release.id);
      await store.update((state) => {
        const target = findProject(state, job.projectSlug);
        target.deployment = activateRelease(target.deployment, release.id);
        target.deployment = appendReleaseEvent(target.deployment, release.id, 'host_activation', 'passed', 'Host service and domain activation completed.');
        if (target.domains?.hosts?.length) target.domains.syncedAt = new Date().toISOString();
        appendAudit(state, { action: 'project.deploy', outcome: 'success', actor: 'owner', target: job.projectSlug, detail: `Activated release ${release.id}` });
      });
      return markJobSucceeded(jobId, 'Deployment completed and the new release is active.');
    } catch (error) {
      const failure = safeDeploymentFailure(error);
      await store.update((state) => {
        const target = findProject(state, job.projectSlug);
        target.deployment = failRelease(target.deployment, release.id, failure);
        appendAudit(state, { action: 'project.deploy', outcome: 'failure', actor: 'owner', target: job.projectSlug, detail: `${failure} Active release was left unchanged.` });
      });
      return markJobFailed(jobId, failure);
    }
  }

  async function handleJobStatus(request, response, jobId) {
    if (!requireSession(request, response)) return;
    const job = store.snapshot().jobs.find((item) => item.id === jobId);
    if (!job) throw new NotFoundError('Deployment job was not found.');
    return sendJson(response, 200, { job: publicJob(job) });
  }

  function scheduleDeploymentQueue() {
    if (deploymentQueueDraining) return;
    deploymentQueueDraining = true;
    void drainDeploymentQueue().finally(() => {
      deploymentQueueDraining = false;
      if (store.snapshot().jobs.some((item) => item.status === 'queued')) scheduleDeploymentQueue();
    });
  }

  async function drainDeploymentQueue() {
    while (true) {
      const next = store.snapshot().jobs.find((item) => item.status === 'queued');
      if (!next) return;
      await runDeploymentJob(next.id);
    }
  }

  async function updateJob(jobId, mutate) {
    await store.update((state) => mutate(findJob(state, jobId)));
  }

  async function markJobSucceeded(jobId, message) {
    await updateJob(jobId, (job) => {
      job.status = 'succeeded';
      job.finishedAt = new Date().toISOString();
      appendJobEvent(job, 'passed', message);
    });
  }

  async function markJobFailed(jobId, message) {
    await updateJob(jobId, (job) => {
      job.status = 'failed';
      job.finishedAt = new Date().toISOString();
      job.failure = message.slice(0, 240);
      appendJobEvent(job, 'failed', job.failure);
    });
  }

  async function recoverDeploymentQueue() {
    await store.update((state) => {
      for (const job of state.jobs.filter((item) => item.status === 'running')) {
        job.status = 'interrupted';
        job.finishedAt = new Date().toISOString();
        job.failure = 'Portal restarted while this deployment was running. The active release was left unchanged.';
        appendJobEvent(job, 'failed', job.failure);
        const project = state.projects.find((item) => item.slug === job.projectSlug);
        const release = project?.deployment?.releases?.find((item) => item.id === job.releaseId);
        if (project && release && ['candidate', 'healthy'].includes(release.status)) project.deployment = failRelease(project.deployment, release.id, job.failure);
      }
    });
    scheduleDeploymentQueue();
  }

  async function handleProjectRollback(request, response, slug) {
    if (!requireSession(request, response, true)) return;
    const body = await readJson(request);
    const requestedReleaseId = typeof body.releaseId === 'string' ? body.releaseId : null;
    if (requestedReleaseId && !/^[a-f0-9-]{36}$/i.test(requestedReleaseId)) throw new InputError('Release selection is invalid.');
    let rollback;
    await store.update((state) => {
      const target = findProject(state, slug);
      rollback = beginRollback(target.deployment, requestedReleaseId);
      target.deployment = rollback.deployment;
      appendAudit(state, { action: 'project.rollback', outcome: 'started', actor: 'owner', target: slug, detail: `Requested rollback to ${rollback.release.id}` });
    });
    const helperSocket = process.env.HOSTMGR_DEPLOY_HELPER_SOCKET;
    if (!helperSocket && uiDemo) {
      await store.update((state) => {
        const target = findProject(state, slug);
        target.deployment = activateRelease(target.deployment, rollback.release.id, 'rollback');
        appendAudit(state, { action: 'project.rollback', outcome: 'success', actor: 'owner', target: slug, detail: `Simulated rollback to ${rollback.release.id}` });
      });
      return sendJson(response, 200, { ok: true, activation: 'complete', project: publicProject(store.snapshot().projects.find((item) => item.slug === slug)) });
    }
    if (!helperSocket) {
      await store.update((state) => {
        const target = findProject(state, slug);
        target.deployment = markReleasePendingActivation(target.deployment, rollback.release.id, 'rollback');
        appendAudit(state, { action: 'project.rollback', outcome: 'pending_activation', actor: 'owner', target: slug, detail: 'Rollback target is ready; a reviewed deployment helper is required to switch the systemd release.' });
      });
      return sendJson(response, 202, { ok: true, activation: 'pending', project: publicProject(store.snapshot().projects.find((item) => item.slug === slug)) });
    }
    try {
      await activateOnHost(helperSocket, slug, rollback.release.id);
      await store.update((state) => {
        const target = findProject(state, slug);
        target.deployment = activateRelease(target.deployment, rollback.release.id, 'rollback');
        if (target.domains?.hosts?.length) target.domains.syncedAt = new Date().toISOString();
        appendAudit(state, { action: 'project.rollback', outcome: 'success', actor: 'owner', target: slug, detail: `Activated rollback release ${rollback.release.id}` });
      });
      return sendJson(response, 200, { ok: true, activation: 'complete', project: publicProject(store.snapshot().projects.find((item) => item.slug === slug)) });
    } catch {
      await store.update((state) => {
        const target = findProject(state, slug);
        target.deployment = failRelease(target.deployment, rollback.release.id, 'Rollback activation failed.');
        appendAudit(state, { action: 'project.rollback', outcome: 'failure', actor: 'owner', target: slug, detail: 'Rollback activation failed; active release was left unchanged.' });
      });
      return sendJson(response, 422, { ok: false, error: 'Rollback activation failed. The active release was left unchanged.', project: publicProject(store.snapshot().projects.find((item) => item.slug === slug)) });
    }
  }

  async function handleCredential(request, response) {
    if (!requireSession(request, response, true)) return;
    if (!vault) throw new InputError('Credential vault is not configured. Set HOSTMGR_SECRET_KEY before saving a token.');
    const credential = validateHttpsCredential(await readJson(request));
    const created = { id: randomUUID(), name: credential.name, type: 'https_token', createdAt: new Date().toISOString(), encryptedToken: vault.encrypt(credential.token) };
    await store.update((state) => {
      if (state.credentials.some((item) => item.name === created.name)) throw new InputError('A credential with this name already exists.');
      state.credentials.push(created);
      appendAudit(state, { action: 'credential.create', outcome: 'success', actor: 'owner', target: created.name, detail: 'HTTPS credential saved without exposing its token' });
    });
    return sendJson(response, 201, { ok: true, credential: publicCredential(created) });
  }

  async function handleProjectEnvironment(request, response, slug) {
    if (!requireSession(request, response, true)) return;
    if (!vault) throw new InputError('Credential vault is not configured. Set HOSTMGR_SECRET_KEY before saving .env content.');
    const body = await readJson(request);
    const content = typeof body.content === 'string' && body.content.trim() ? body.content : 'NODE_ENV=production\n';
    const environment = validateEnvironmentContent(content);
    await store.update((state) => {
      const project = state.projects.find((item) => item.slug === slug);
      if (!project) throw new InputError('Project was not found.');
      project.environment = { keys: environment.keys, updatedAt: new Date().toISOString(), encryptedContent: vault.encrypt(environment.content) };
      appendAudit(state, { action: 'project.save_environment', outcome: 'success', actor: 'owner', target: slug, detail: `Saved .env metadata with ${environment.keys.length} keys` });
    });
    return sendJson(response, 200, { ok: true, project: publicProject(store.snapshot().projects.find((item) => item.slug === slug)) });
  }

  async function handleProjectDomainCheck(request, response, slug) {
    if (!requireSession(request, response, true)) return;
    let hostname = '';
    try {
      findProject(store.snapshot(), slug);
      hostname = validateDomain({ hostname: (await readJson(request)).hostname });
      const result = await domainDnsCheck(hostname);
      return sendJson(response, 200, normalizeDomainCheckResult(hostname, result));
    } catch (error) {
      if (error instanceof InputError || error instanceof NotFoundError) throw error;
      console.error('domain DNS check failed', { slug, hostname, err: error });
      return sendJson(response, 200, {
        hostname: hostname || 'unknown',
        resolved: [],
        expected: [],
        matched: false,
        status: 'error',
        detail: softDomainCheckDetail(error),
      });
    }
  }

  async function handleProjectDomains(request, response, slug) {
    if (!requireSession(request, response, true)) return;
    const hosts = validateProjectDomains((await readJson(request)).domains);
    let active = false;
    await store.update((state) => {
      const project = findProject(state, slug);
      project.domains = { hosts, updatedAt: new Date().toISOString(), syncedAt: null };
      active = project.deployment?.state === 'active' && Boolean(project.deployment.activeReleaseId);
      appendAudit(state, { action: 'project.save_domains', outcome: 'success', actor: 'owner', target: slug, detail: `Saved ${hosts.length} project domain name(s)` });
    });
    if (mode === 'host' && active) {
      const socketPath = process.env.HOSTMGR_DEPLOY_HELPER_SOCKET;
      if (!socketPath) throw new InputError('Domain saved, but the host deployment helper is not configured.');
      try {
        await syncDomainsOnHost(socketPath, slug);
      } catch {
        await store.update((state) => appendAudit(state, { action: 'project.sync_domains', outcome: 'failure', actor: 'owner', target: slug, detail: 'Domain saved but Nginx/TLS sync failed; previous managed configuration was retained.' }));
        throw new InputError('Domain was saved, but Nginx/TLS sync failed. Verify DNS points to this host and retry.');
      }
      await store.update((state) => {
        const project = findProject(state, slug);
        project.domains.syncedAt = new Date().toISOString();
        appendAudit(state, { action: 'project.sync_domains', outcome: 'success', actor: 'owner', target: slug, detail: `Synced Nginx and TLS for ${project.domains.hosts.length} domain name(s)` });
      });
    }
    return sendJson(response, 200, { ok: true, project: publicProject(store.snapshot().projects.find((item) => item.slug === slug)) });
  }

  async function handleProjectLogs(request, response, slug) {
    if (!requireSession(request, response)) return;
    const project = findProject(store.snapshot(), slug);
    const identity = projectIdentity(project.slug);
    if (mode !== 'host') {
      return sendJson(response, 200, { unit: identity.service, lines: demoProjectLogLines(project, identity), available: true, simulated: true });
    }
    const socketPath = process.env.HOSTMGR_DEPLOY_HELPER_SOCKET;
    if (!socketPath) {
      return sendJson(response, 200, { unit: identity.service, lines: [], available: false, notice: 'ยังไม่ได้เชื่อมต่อ deployment helper — อ่าน runtime log ไม่ได้', simulated: false });
    }
    try {
      const result = await callHostHelper(socketPath, { operation: 'read-project-log', slug: project.slug, lines: 150 });
      return sendJson(response, 200, { unit: identity.service, lines: Array.isArray(result.lines) ? result.lines : [], available: true, simulated: false });
    } catch {
      return sendJson(response, 200, { unit: identity.service, lines: [], available: false, notice: 'อ่าน runtime log จาก host ไม่สำเร็จ', simulated: false });
    }
  }

  async function hostInstall(tool) {
    const socketPath = process.env.HOSTMGR_DEPLOY_HELPER_SOCKET;
    if (!socketPath) throw new InputError('Host installer is not configured. Re-run the Dashboard Portal installer.');
    const result = await callHostHelper(socketPath, { operation: 'install-tool', tool });
    if (!result.ok) throw new InputError('Privileged helper rejected the operation.');
    return { version: result.version ?? 'Installed', detail: `Installed through allowlisted helper: ${tool}` };
  }

  await recoverDeploymentQueue();
  return {
    server,
    store,
    close: () => new Promise((resolve, reject) => {
      if (metricsTimer) {
        clearInterval(metricsTimer);
        metricsTimer = null;
      }
      server.close((error) => error ? reject(error) : resolve());
    })
  };
}

async function installedSoftwareVersion() {
  const packageInfo = JSON.parse(await readFile(join(here, '..', 'package.json'), 'utf8'));
  if (typeof packageInfo.version !== 'string') throw new Error('package.json version is missing.');
  return packageInfo.version;
}

export async function cloneInSandbox(project, credential, vault, projectRoot) {
  if (project.protocol === 'ssh') return { status: 'needs_ssh_key', at: new Date().toISOString(), detail: 'Create and register the project deploy key before cloning with SSH.' };
  const workspace = projectWorkspace(project, projectRoot);
  const target = repositoryRoot(project, projectRoot);
  await mkdir(workspace, { recursive: true, mode: 0o750 });
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  let cleanup = async () => {};
  if (credential) {
    if (!vault) throw new InputError('Credential vault is not configured.');
    const tokenFile = join(workspace, `.git-token-${randomUUID()}`);
    const askPass = join(workspace, `.git-askpass-${randomUUID()}`);
    await writeFile(tokenFile, vault.decrypt(credential.encryptedToken), { mode: 0o600 });
    await writeFile(askPass, '#!/bin/sh\ncase "$1" in *Username*) printf %s x-access-token ;; *) cat "$HOSTMGR_GIT_TOKEN_FILE" ;; esac\n', { mode: 0o700 });
    await chmod(askPass, 0o700);
    env.GIT_ASKPASS = askPass;
    env.GIT_ASKPASS_REQUIRE = 'force';
    env.HOSTMGR_GIT_TOKEN_FILE = tokenFile;
    cleanup = async () => Promise.all([rm(tokenFile, { force: true }), rm(askPass, { force: true })]);
  }
  try {
    const exists = await stat(join(target, '.git')).then(() => true).catch(() => false);
    if (!exists) {
      // The target directory belongs exclusively to this project. A prior
      // interrupted clone can leave files without .git, which makes every
      // retry fail with "destination path already exists".
      const incompleteTarget = await stat(target).then(() => true).catch(() => false);
      if (incompleteTarget) await rm(target, { recursive: true, force: true });
      await run('git', ['clone', '--branch', project.branch, '--single-branch', project.repository, target], { env });
    }
    else {
      // The project's repository URL can change after the first sync (an
      // edit). Without repointing origin first, fetch/reset would silently
      // keep pulling the previously configured repository.
      await run('git', ['-C', target, 'remote', 'set-url', 'origin', project.repository], { env });
      await run('git', ['-C', target, 'fetch', '--prune', 'origin', project.branch], { env });
      await run('git', ['-C', target, 'checkout', '--force', project.branch], { env });
      await run('git', ['-C', target, 'reset', '--hard', `origin/${project.branch}`], { env });
    }
    return { status: 'synced', at: new Date().toISOString(), detail: 'Repository cloned or pulled in the sandbox.' };
  } catch (error) {
    return { status: 'failed', at: new Date().toISOString(), detail: `Repository sync failed: ${safeGitSyncFailure(error)}` };
  } finally { await cleanup(); }
}

export function safeGitSyncFailure(error) {
  const message = String(error?.message ?? '');
  if (/could not resolve host|network is unreachable|connection timed out|failed to connect/i.test(message)) return 'network connection to the repository failed.';
  if (/remote branch .* not found|couldn.t find remote ref/i.test(message)) return 'the configured branch was not found.';
  if (/authentication failed|could not read username|terminal prompts disabled/i.test(message)) return 'repository authentication was rejected.';
  if (/permission denied|eacces/i.test(message)) return 'the project workspace is not writable.';
  if (/enoent|spawn git/i.test(message)) return 'the Git executable is unavailable to the service.';
  if (/destination path .* already exists|not an empty directory/i.test(message)) return 'an incomplete project workspace could not be reset.';
  if (/timed out/i.test(message)) return 'the Git operation timed out.';
  return 'Git exited without a classified error.';
}

async function listRemoteBranches({ repository, credential, vault, scratchRoot }) {
  const directory = join(scratchRoot, `.git-branches-${randomUUID()}`);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  let cleanup = async () => {};
  if (credential) {
    if (!vault) throw new InputError('Credential vault is not configured.');
    const tokenFile = join(directory, 'token');
    const askPass = join(directory, 'askpass');
    await writeFile(tokenFile, vault.decrypt(credential.encryptedToken), { mode: 0o600 });
    await writeFile(askPass, '#!/bin/sh\ncase "$1" in *Username*) printf %s x-access-token ;; *) cat "$HOSTMGR_GIT_TOKEN_FILE" ;; esac\n', { mode: 0o700 });
    await chmod(askPass, 0o700);
    env.GIT_ASKPASS = askPass;
    env.GIT_ASKPASS_REQUIRE = 'force';
    env.HOSTMGR_GIT_TOKEN_FILE = tokenFile;
    cleanup = async () => Promise.all([rm(tokenFile, { force: true }), rm(askPass, { force: true })]);
  }
  try {
    const output = await run('git', ['ls-remote', '--heads', repository], { env, timeout: 30_000 });
    return output.split('\n').map((line) => line.split('\t')[1]?.replace(/^refs\/heads\//, '')).filter(Boolean);
  } finally {
    await cleanup();
    await rm(directory, { recursive: true, force: true });
  }
}

function safeGitBranchFailure(error) {
  const message = String(error?.message ?? '');
  if (/could not resolve host|network is unreachable|connection timed out|failed to connect/i.test(message)) return 'network connection to the repository failed.';
  if (/authentication failed|could not read username|terminal prompts disabled/i.test(message)) return 'repository authentication was rejected.';
  if (/permission denied|eacces/i.test(message)) return 'repository access was denied.';
  if (/enoent|spawn git/i.test(message)) return 'the Git executable is unavailable to the service.';
  if (/timed out/i.test(message)) return 'the Git operation timed out.';
  return 'Git could not read the remote branch list.';
}

function normalizeBranches(branches) {
  if (!Array.isArray(branches)) throw new InputError('Git returned an invalid branch list.');
  return [...new Set(branches.filter((branch) => typeof branch === 'string' && /^[A-Za-z0-9._/-]{1,100}$/.test(branch) && !branch.startsWith('-')))].sort((left, right) => left.localeCompare(right));
}

async function prepareNativeRelease(project, release, storedProject, vault, projectRoot, reportPhase = async () => {}) {
  const source = repositoryDirectory(project, projectRoot);
  const destination = join(projectRoot, project.slug, 'releases', release.id);
  const packagePath = join(source, 'package.json');
  const sourceExists = await stat(source).then((item) => item.isDirectory()).catch(() => false);
  if (!sourceExists) throw new InputError('The synced repository is missing. Sync it again before deploying.');
  let packageJson;
  try { packageJson = JSON.parse(await readFile(packagePath, 'utf8')); } catch { throw new InputError('The synced repository has no valid package.json.'); }
  validatePackageScripts(packageJson, project);
  const hasLockfile = await stat(join(source, 'package-lock.json')).then((item) => item.isFile()).catch(() => false);
  try {
    await reportPhase('source_copy', 'started', 'Copying the synced repository into an isolated candidate release.');
    await mkdir(join(projectRoot, project.slug, 'releases'), { recursive: true, mode: 0o750 });
    await copyCandidateSource(source, destination);
    await reportPhase('source_copy', 'passed', 'Candidate source was prepared.');
    if (storedProject.environment?.encryptedContent) {
      if (!vault) throw new InputError('Credential vault is not configured.');
      await writeFile(join(destination, '.env'), vault.decrypt(storedProject.environment.encryptedContent), { mode: 0o600 });
    }
    await runCandidateNpm(['--version'], {}, 'The host Node runtime is missing npm. Re-run the Dashboard Portal installer.');
    await installCandidateDependencies({
      hasLockfile,
      runNpm: (args, options) => run(npmExecutable(), args, options),
      options: { cwd: destination, timeout: 300_000 },
      reportPhase
    });
    if (project.buildScript) {
      await reportPhase('build', 'started', `Running npm script "${project.buildScript}".`);
      await runCandidateNpm(['run', project.buildScript], { cwd: destination, timeout: 300_000 }, `Candidate build script "${project.buildScript}" failed.`);
      await reportPhase('build', 'passed', `Build script "${project.buildScript}" passed.`);
    } else {
      await reportPhase('build', 'skipped', 'No build script is configured for this project.');
    }
    await healthCheckCandidate(destination, project, storedProject, vault, reportPhase);
  } catch (error) {
    await rm(destination, { recursive: true, force: true });
    throw error;
  }
}

// fs.cp() accepts numeric copy-file flags for `mode`; passing the string
// "preserve" fails on Node.js 24 before a candidate can be built.
export async function copyCandidateSource(source, destination) {
  await cp(source, destination, {
    recursive: true,
    filter: (path) => !['.git', 'node_modules'].includes(basename(path))
  });
}

async function healthCheckCandidate(cwd, project, storedProject, vault, reportPhase = async () => {}) {
  if (!project.healthCheckEnabled) {
    await reportPhase('candidate_health', 'skipped', 'Candidate health check is disabled for this project.');
    return;
  }
  await reportPhase('candidate_health', 'started', `Starting the candidate and checking ${project.healthCheckPath}.`);
  const environment = { ...process.env, PORT: String(project.candidatePort), HOST: '127.0.0.1', HOSTMGR_CANDIDATE: 'true' };
  if (storedProject.environment?.encryptedContent) Object.assign(environment, parseEnvironment(vault?.decrypt(storedProject.environment.encryptedContent) ?? ''));
  const candidate = spawn(npmExecutable(), ['run', project.startScript], { cwd, env: environment, shell: false, detached: process.platform !== 'win32', stdio: ['ignore', 'ignore', 'ignore'] });
  let exited = false;
  let startupError = false;
  candidate.once('error', () => { startupError = true; exited = true; });
  candidate.once('exit', () => { exited = true; });
  try {
    const deadline = Date.now() + project.healthCheckTimeoutMs;
    while (Date.now() < deadline && !exited) {
      if (await requestHealth(project.candidatePort, project.healthCheckPath)) return;
      await delay(250);
    }
    if (startupError) throw new DeploymentFailure('The host Node runtime could not start npm. Re-run the Dashboard Portal installer.');
    if (exited) throw new DeploymentFailure(`Candidate start script "${project.startScript}" exited before the health check passed.`);
    throw new DeploymentFailure('Candidate health check did not pass before its timeout.');
  } finally {
    if (!exited) stopCandidate(candidate, 'SIGTERM');
    // Do not leave a candidate listening on its temporary port if a project
    // ignores SIGTERM during a failed health check.
    setTimeout(() => { if (!exited) stopCandidate(candidate, 'SIGKILL'); }, 2_000).unref();
  }
}

function stopCandidate(candidate, signal) {
  try {
    if (process.platform !== 'win32' && candidate.pid) process.kill(-candidate.pid, signal);
    else candidate.kill(signal);
  } catch {}
}

async function runCandidateNpm(args, options, failure) {
  try {
    return await run(npmExecutable(), args, options);
  } catch {
    throw new DeploymentFailure(failure);
  }
}

/**
 * Install dependencies for an isolated candidate without modifying the synced
 * Git checkout. A healthy lockfile uses npm ci; an absent or stale lockfile
 * falls back to npm install only inside this candidate, so a future sync is
 * still wholly determined by the selected branch.
 */
export async function installCandidateDependencies({ hasLockfile, runNpm, options, reportPhase = async () => {} }) {
  if (!hasLockfile) {
    await reportPhase('dependencies', 'started', 'No package-lock.json was found. Installing dependencies with npm install for this candidate.');
    return installUnlockedCandidateDependencies(runNpm, options, reportPhase);
  }

  await reportPhase('dependencies', 'started', 'Installing locked npm dependencies with npm ci.');
  try {
    await runNpm(['ci'], options);
    await reportPhase('dependencies', 'passed', 'Locked npm dependencies installed.');
    return 'locked';
  } catch (error) {
    if (!isNpmLockfileFailure(error)) throw new DeploymentFailure('Candidate dependency installation failed. Check package-lock.json and package dependencies.');
    await reportPhase('dependencies', 'started', 'package-lock.json is incompatible with package.json. Retrying npm install for this candidate.');
    return installUnlockedCandidateDependencies(runNpm, options, reportPhase);
  }
}

async function installUnlockedCandidateDependencies(runNpm, options, reportPhase) {
  try {
    await runNpm(['install'], options);
    await reportPhase('dependencies', 'passed', 'Dependencies installed with npm install for this candidate; the synced Git checkout was not changed.');
    return 'unlocked';
  } catch {
    throw new DeploymentFailure('Candidate dependency installation failed. Check package.json and package dependencies.');
  }
}

function isNpmLockfileFailure(error) {
  const message = String(error?.message ?? '');
  return /npm(?: error)? code EUSAGE|package-lock\.json|package lock|missing: .* from lock file/i.test(message);
}

function npmExecutable() {
  return process.env.HOSTMGR_NPM_PATH || '/usr/local/bin/npm';
}

async function requestHealth(port, path) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(1_000), redirect: 'manual' });
    return response.status >= 200 && response.status < 400;
  } catch { return false; }
}

function parseEnvironment(content) {
  const environment = {};
  for (const line of content.replace(/\r\n/g, '\n').split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator > 0) environment[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return environment;
}

async function projectRevision(project, projectRoot) {
  try { return await run('git', ['-C', repositoryRoot(project, projectRoot), 'rev-parse', 'HEAD']); }
  catch { return null; }
}

function projectWorkspace(project, projectRoot) {
  return join(projectRoot, project.slug);
}

function repositoryRoot(project, projectRoot) {
  return join(projectWorkspace(project, projectRoot), 'repository');
}

function repositoryDirectory(project, projectRoot) {
  return join(repositoryRoot(project, projectRoot), ...(project.directory ?? '/').split('/').filter(Boolean));
}

async function activateOnHost(socketPath, slug, releaseId) {
  const result = await callHostHelper(socketPath, { operation: 'activate-project', slug, releaseId });
  if (!result.ok) throw new DeploymentFailure(result.error || 'Deployment helper rejected the activation.');
}

async function syncDomainsOnHost(socketPath, slug) {
  const result = await callHostHelper(socketPath, { operation: 'sync-project-domains', slug });
  if (!result.ok) throw new Error('Deployment helper rejected the domain sync.');
}

function findProject(state, slug) {
  const project = state.projects.find((item) => item.slug === slug);
  if (!project) throw new NotFoundError('Project was not found.');
  return project;
}

function normalizeDomainCheckResult(hostname, result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return {
      hostname,
      resolved: [],
      expected: [],
      matched: false,
      status: 'error',
      detail: 'DNS check failed. Verify network/DNS settings and try again.',
    };
  }
  const status = ['ok', 'mismatch', 'unresolved', 'error'].includes(result.status) ? result.status : 'error';
  const resolved = Array.isArray(result.resolved) ? result.resolved.filter((item) => typeof item === 'string') : [];
  const expected = Array.isArray(result.expected) ? result.expected.filter((item) => typeof item === 'string') : [];
  return {
    hostname: typeof result.hostname === 'string' && result.hostname ? result.hostname : hostname,
    resolved,
    expected,
    matched: Boolean(result.matched),
    status,
    ...(status === 'error' ? { detail: typeof result.detail === 'string' && result.detail ? result.detail.slice(0, 240) : 'DNS check failed. Verify network/DNS settings and try again.' } : {}),
  };
}

function softDomainCheckDetail(error) {
  const code = typeof error?.code === 'string' ? error.code : '';
  if (code === 'ETIMEOUT' || code === 'ABORT_ERR') return 'DNS check timed out. Try again in a moment.';
  if (code) return `DNS check failed (${code}). Verify network/DNS settings and try again.`;
  return 'DNS check failed. Verify network/DNS settings and try again.';
}

function sendCaughtError(response, error) {
  if (response.headersSent) {
    console.error(error);
    return;
  }
  if (error instanceof InputError) return sendJson(response, 400, { error: error.message });
  if (error instanceof NotFoundError) return sendJson(response, 404, { error: error.message });
  if (error instanceof DeploymentFailure) return sendJson(response, 422, { error: error.message });
  console.error(error);
  return sendJson(response, 500, { error: publicInternalError(error) });
}

function publicInternalError(error) {
  if (!(error instanceof Error)) return 'Internal server error.';
  const message = String(error.message || '').trim();
  if (!message || message.length > 240) return 'Internal server error.';
  if (/ENOENT|EACCES|EPERM|ECONNREFUSED|ECONNRESET|Cannot read|is not (a )?function|Unexpected token|at process\.|node:internal/i.test(message)) {
    return 'Internal server error.';
  }
  return message;
}

class NotFoundError extends Error {}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function publicCredential(credential) {
  const { encryptedToken, ...safe } = credential;
  return safe;
}

function publicProject(project) {
  if (!project) return project;
  const safe = structuredClone(project);
  if (safe.environment) delete safe.environment.encryptedContent;
  return safe;
}

function publicJob(job) {
  const safe = structuredClone(job);
  safe.events = (safe.events ?? []).map((event) => ({
    at: event.at,
    phase: event.phase ?? null,
    status: event.status,
    message: typeof event.message === 'string' ? event.message.slice(0, 240) : 'Deployment event recorded.'
  }));
  return safe;
}

function findJob(state, jobId) {
  const job = state.jobs.find((item) => item.id === jobId);
  if (!job) throw new NotFoundError('Deployment job was not found.');
  return job;
}

function appendJobEvent(job, status, message, phase = null) {
  job.events ??= [];
  job.events.push({ at: new Date().toISOString(), ...(phase ? { phase } : {}), status, message: String(message ?? 'Deployment event recorded.').slice(0, 240) });
  if (job.events.length > 80) job.events.splice(0, job.events.length - 80);
}

async function doctorReport(state, mode, toolProbe = probeHostTools) {
  const tools = mode === 'host' ? await toolProbe(Object.values(state.tools)) : Object.values(state.tools);
  const resources = await collectHostMetrics();
  return {
    generatedAt: new Date().toISOString(),
    mode,
    supportedNodeMajor: SUPPORTED_NODE_MAJOR,
    host: {
      hostname: os.hostname(),
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      memoryBytes: resources.memoryTotalBytes,
      memoryUsedBytes: resources.memoryUsedBytes,
      diskUsedBytes: resources.diskUsedBytes,
      diskTotalBytes: resources.diskTotalBytes,
      cpuPercent: resources.cpuPercent,
      uptimeSeconds: resources.uptimeSeconds
    },
    tools,
    warning: mode === 'demo' ? 'Sandbox mode: installer operations are simulated and do not change the Docker host.' : null
  };
}

/**
 * Host mode deliberately does not trust the persisted install state. Package
 * state can change outside this service, so every doctor refresh probes the
 * fixed executable paths used by the Ubuntu installer.
 */
export async function probeHostTools(storedTools, execute = probeExecutable) {
  return Promise.all(storedTools.map(async (tool) => {
    const commands = HOST_TOOL_COMMANDS[tool.id];
    if (!commands) return { ...tool, simulated: false, observedAt: new Date().toISOString() };
    const results = await Promise.all(commands.map(([command, args]) => execute(command, args)));
    const installed = results.every((result) => result.ok);
    return {
      ...tool,
      status: installed ? 'Installed' : 'Missing',
      version: installed ? results.map((result) => compactVersion(result.output)).filter(Boolean).join(' · ') || 'Installed' : null,
      simulated: false,
      observedAt: new Date().toISOString()
    };
  }));
}

function probeExecutable(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000 });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data) => { stdout += data; });
    child.stderr.on('data', (data) => { stderr += data; });
    child.once('error', () => resolve({ ok: false, output: '' }));
    child.once('close', (code) => resolve({ ok: code === 0, output: `${stdout}\n${stderr}` }));
  });
}

function compactVersion(output) {
  return String(output ?? '').replace(/\s+/g, ' ').trim().slice(0, 160);
}

class DeploymentFailure extends Error {}

function safeDeploymentFailure(error) {
  if (error instanceof DeploymentFailure || error instanceof InputError) return error.message.slice(0, 240);
  return 'Candidate build, health check, or activation failed.';
}

function demoInstall(tool) {
  return { version: 'sandbox-simulated', detail: `Validated allowlisted install request for ${TOOLS[tool].package}; no host package was changed.` };
}

function demoProjectLogLines(project, identity) {
  return [
    `# Sandbox mode: "${project.name}" ไม่ได้รันเป็น systemd service บนเครื่องนี้`,
    `# บนเครื่อง host จริง ส่วนนี้จะแสดงผลลัพธ์ล่าสุดของ: journalctl -u ${identity.service}`
  ];
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000, ...options });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data) => { stdout += data; });
    child.stderr.on('data', (data) => { stderr += data; });
    child.once('error', reject);
    child.once('close', (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(`Privileged helper failed (${code}): ${stderr.slice(0, 200)}`)));
  });
}

async function readJson(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 64 * 1024) throw new InputError('Request body is too large.');
  }
  try { return body ? JSON.parse(body) : {}; } catch { throw new InputError('Invalid JSON body.'); }
}

async function serveStatic(pathname, response) {
  const route = matchUiRoute(pathname);
  if (route) {
    const html = await renderView.render(route.view, {
      page: route.page,
      view: route.view,
      title: pageTitles[route.view] || pageTitles[route.page] || 'Dashboard Portal',
      flowMode: route.params.mode || '',
      editSlug: route.params.slug || ''
    });
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
    return response.end(html);
  }
  if (!pathname.startsWith('/ui/')) return sendJson(response, 404, { error: 'Not found.' });
  const filename = basename(normalize(pathname));
  if (!filename || filename !== basename(filename) || filename.includes('..')) return sendJson(response, 404, { error: 'Not found.' });
  try {
    const body = await readFile(join(uiDir, filename));
    const type = contentTypes[extname(filename)] ?? 'application/octet-stream';
    response.writeHead(200, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
    response.end(body);
  } catch (error) {
    if (error.code === 'ENOENT') return sendJson(response, 404, { error: 'Not found.' });
    throw error;
  }
}

function sendJson(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' });
  response.end(payload);
}

function constantEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function sessionIdHash(value) {
  return createHash('sha256').update(value).digest('base64url');
}

function validStoredSession(session) {
  return Boolean(session
    && typeof session.idHash === 'string' && /^[A-Za-z0-9_-]{43}$/.test(session.idHash)
    && typeof session.csrf === 'string' && /^[A-Za-z0-9_-]{43}$/.test(session.csrf)
    && Number.isFinite(session.expiresAt) && session.expiresAt > Date.now());
}

function sessionCookie(value, secure) {
  return `hostmgr_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_SECONDS}${secure ? '; Secure' : ''}`;
}

function expiredCookie(secure) {
  return `hostmgr_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure ? '; Secure' : ''}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = await createApplication();
  const port = Number(process.env.PORT ?? 3000);
  const bindAddress = process.env.HOSTMGR_BIND_ADDRESS ?? '0.0.0.0';
  const mode = process.env.HOSTMGR_MODE ?? 'demo';
  app.server.listen(port, bindAddress, () => {
    console.log(`Modern Host Manager listening on http://127.0.0.1:${port} (${mode})`);
  });
}
