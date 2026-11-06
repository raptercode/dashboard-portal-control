import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { InputError, appendAudit, validateProjectSync } from './core.mjs';
import { isDeepStrictEqual } from 'node:util';
import { AccessError } from './access-api.mjs';
import { canAccess, resolveProjectOrganization, visibleOrganizations } from './access.mjs';

export const CLI_SCOPES = Object.freeze([
  'project.view', 'project.create', 'project.configure', 'source.sync',
  'deploy.start', 'deploy.rollback', 'domains.manage', 'env.read', 'env.write', 'logs.read', 'credentials.use'
]);
const DEFAULT_SCOPES = CLI_SCOPES.filter(scope => scope !== 'env.read');
const hash = value => createHash('sha256').update(value).digest('hex');
const active = (token, now) => token && !token.revokedAt && Date.parse(token.expiresAt) > now;
export const publicCliToken = ({ tokenHash, authVersion, ...token }) => token;

export function cliIdentity(state, value, now = Date.now()) {
  if (typeof value !== 'string' || !/^dp_[A-Za-z0-9_-]{43}$/.test(value)) return null;
  const token = state.cliTokens?.find(item => item.tokenHash === hash(value));
  const user = token && state.users.find(item => item.id === token.userId);
  if (!active(token, now) || !user || user.status !== 'active' || user.authVersion !== token.authVersion) return null;
  return { user, cliTokenId: token.id };
}

// An explicit allow-list keeps a Master's bearer credential away from host,
// account, credential administration, and token issuance endpoints.
export function authorizeCliRequest(state, id, path, method, body = {}, now = Date.now()) {
  const token = state.cliTokens?.find(item => item.id === id);
  const user = token && state.users.find(item => item.id === token.userId);
  if (!active(token, now) || !user || user.status !== 'active' || user.authVersion !== token.authVersion) throw new AccessError('CLI token expired or revoked.', 401);
  const need = (...scopes) => { if (scopes.some(scope => !token.scopes.includes(scope))) throw new AccessError('CLI token scope does not allow this action.'); };
  if (method === 'GET' && path === '/api/access') return token;
  if (method === 'GET' && ['/api/projects', '/api/deployments'].includes(path)) { need('project.view'); return token; }
  let slug;
  if (method === 'POST' && path === '/api/projects/sync') {
    slug = body.slug;
    if (token.projectSlug && slug !== token.projectSlug) throw new AccessError('Project not found.', 404);
    const existing = state.projects.find(item => item.slug === slug);
    need(existing ? 'source.sync' : 'project.create');
    if (existing) {
      const organization = resolveProjectOrganization(state, existing);
      const incoming = validateProjectSync({ ...body, organization: organization?.name });
      const stored = validateProjectSync({ ...existing, organization: organization?.name, domains: existing.domains?.hosts });
      const canonical = value => Object.fromEntries(Object.entries(value).filter(([key]) => !['domains', 'organization'].includes(key)));
      const effective = { ...canonical(stored), ...canonical(incoming) };
      if (incoming.port === null) effective.port = stored.port;
      const organizationChanged = (body.organizationId && body.organizationId !== organization?.id) || (body.organization && body.organization.trim() !== organization?.name);
      if (!isDeepStrictEqual(effective, canonical(stored)) || organizationChanged) need('project.configure');
      if (incoming.domains && !isDeepStrictEqual(incoming.domains.hosts, existing.domains?.hosts ?? [])) need('project.configure', 'domains.manage');
    } else if (body.domains?.length) need('domains.manage');
    if (body.credentialId && (!existing || body.credentialId !== existing.credentialId || body.repository !== existing.repository)) need('credentials.use');
  } else {
    const job = path.match(/^\/api\/jobs\/([^/]+)$/);
    const match = path.match(/^\/api\/projects\/([a-z][a-z0-9-]{0,62})\/(.+)$/);
    if (job && method === 'GET') {
      slug = state.jobs.find(item => item.id === job[1])?.projectSlug;
      need('logs.read');
      if (!slug) throw new AccessError('Job not found.', 404);
    } else if (match) {
      slug = match[1];
      const scope = {
        'POST deploy': 'deploy.start', 'POST restart': 'deploy.start', 'POST rollback': 'deploy.rollback',
        'GET deploy-configuration': 'project.view', 'GET logs': 'logs.read',
        'GET environment': 'env.read', 'POST environment': 'env.write', 'PATCH environment': 'env.write',
        'GET environment/metadata': 'env.metadata',
        'POST domains': 'domains.manage', 'POST domains/check': 'domains.manage',
        'POST domains/verify': 'domains.manage', 'POST edge/check': 'domains.manage'
      }[`${method} ${match[2]}`];
      if (!scope) throw new AccessError('Endpoint is unavailable to CLI tokens.');
      if (scope === 'env.metadata') {
        if (!token.scopes.some(item => ['env.read', 'env.write'].includes(item))) throw new AccessError('CLI token scope does not allow this action.');
      } else need(scope);
    } else throw new AccessError('Endpoint is unavailable to CLI tokens.');
  }
  if (token.projectSlug && slug !== token.projectSlug) throw new AccessError('Project not found.', 404);
  return token;
}

export function createCliAuth({ store, readJson, sendJson, now = Date.now }) {
  const attempts = new Map();
  function rate(request, kind, limit) {
    const time = now();
    for (const [key, item] of attempts) if (item.until <= time) attempts.delete(key);
    const key = `${kind}:${request.socket.remoteAddress}`;
    const record = attempts.get(key) ?? { count: 0, until: time + 15 * 60_000 };
    if (record.count >= limit || attempts.size > 10_000) throw new AccessError('Too many CLI login requests. Try again later.', 429);
    record.count++;
    attempts.set(key, record);
  }
  function settings(input) {
    const name = input.name ?? 'CLI';
    if (typeof name !== 'string' || !name.trim() || name.length > 80 || /[\x00-\x1f\x7f]/.test(name)) throw new InputError('Token name must be 1–80 printable characters.');
    const scopes = input.scopes ?? DEFAULT_SCOPES;
    if (!Array.isArray(scopes) || !scopes.length || scopes.some(scope => !CLI_SCOPES.includes(scope))) throw new InputError('Unknown CLI scope.');
    const days = input.expiresInDays ?? 30;
    if (!Number.isInteger(days) || days < 1 || days > 90) throw new InputError('Token lifetime must be 1–90 days.');
    const projectSlug = input.projectSlug || null;
    if (projectSlug && (typeof projectSlug !== 'string' || !/^[a-z][a-z0-9-]{0,62}$/.test(projectSlug))) throw new InputError('Invalid project slug.');
    return { name: name.trim(), scopes: [...new Set(scopes)], projectSlug, expiresInDays: days };
  }
  function assertGrants(state, user, spec) {
    const current = state.users.find(item => item.id === user?.id);
    if (!current || current.status !== 'active' || current.authVersion !== user.authVersion) throw new AccessError('Account permissions changed.', 401);
    const project = spec.projectSlug && state.projects.find(item => item.slug === spec.projectSlug);
    const org = project && resolveProjectOrganization(state, project);
    if (spec.projectSlug && (!org || !canAccess(state, current, org.id, 'project.view'))) throw new AccessError('Project not found.', 404);
    if (current.role !== 'master') {
      const orgs = org ? [org] : visibleOrganizations(state, current);
      if (spec.scopes.some(scope => !orgs.some(item => canAccess(state, current, item.id, scope)))) throw new AccessError('Requested token scopes exceed your permissions.');
    }
    return current;
  }
  function issue(state, user, spec) {
    const current = assertGrants(state, user, spec);
    if ((state.cliTokens ?? []).filter(item => item.userId === user.id && active(item, now())).length >= 50) throw new InputError('Revoke an existing CLI token before creating another.');
    const secret = `dp_${randomBytes(32).toString('base64url')}`;
    const token = { id: randomUUID(), name: spec.name, scopes: spec.scopes, projectSlug: spec.projectSlug, userId: current.id, authVersion: current.authVersion, tokenHash: hash(secret), createdAt: new Date(now()).toISOString(), expiresAt: new Date(now() + spec.expiresInDays * 86400_000).toISOString(), revokedAt: null };
    state.cliTokens ??= [];
    state.cliTokens.push(token);
    appendAudit(state, { action: 'cli.token_created', actor: current.id, outcome: 'success', target: token.id, detail: `CLI token: ${token.scopes.join(', ')}` });
    return { token: secret, credential: publicCliToken(token) };
  }
  return {
    async publicRequest(request, response, path) {
      if (request.method !== 'POST' || !['/api/cli/device/start', '/api/cli/device/poll'].includes(path)) return false;
      if (path.endsWith('/start')) {
        rate(request, 'start', 20);
        const spec = settings(await readJson(request));
        const deviceCode = randomBytes(32).toString('base64url');
        const userCode = randomBytes(5).toString('hex').toUpperCase();
        await store.update(state => {
          state.cliDevices = (state.cliDevices ?? []).filter(item => item.expiresAt > now() && !item.consumed);
          if (state.cliDevices.length >= 1000) throw new AccessError('Too many pending CLI logins.', 429);
          state.cliDevices.push({ ...spec, deviceHash: hash(deviceCode), userCode, expiresAt: now() + 600_000, nextPollAt: 0, status: 'pending' });
        });
        sendJson(response, 200, { deviceCode, userCode, verificationPath: `/settings/account?cli_code=${userCode}`, expiresIn: 600, interval: 2 });
      } else {
        const body = await readJson(request);
        if (typeof body.deviceCode !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.deviceCode)) throw new InputError('Invalid device code.');
        const digest = hash(body.deviceCode);
        let result;
        await store.update(state => {
          const device = state.cliDevices?.find(item => item.deviceHash === digest);
          if (!device || device.consumed || device.expiresAt <= now()) throw new AccessError('CLI login expired. Run login again.', 410);
          if (device.nextPollAt > now()) throw new AccessError('Poll interval is two seconds.', 429);
          device.nextPollAt = now() + 2000;
          if (device.status === 'denied') throw new AccessError('CLI login denied.', 403);
          result = { status: device.status, interval: 2 };
          if (device.status === 'approved') {
            const user = state.users.find(item => item.id === device.userId);
            if (!user || user.authVersion !== device.authVersion) throw new AccessError('Account permissions changed.', 401);
            result = { status: 'complete', ...issue(state, user, device) };
            device.consumed = true;
          }
        });
        sendJson(response, 200, result);
      }
      return true;
    },
    async authenticatedRequest({ request, response, path, user, cliTokenId }) {
      if (!path.startsWith('/api/cli/')) return false;
      if (cliTokenId) throw new AccessError('Use a browser session to manage CLI access.');
      if (path === '/api/cli/tokens' && request.method === 'GET') {
        sendJson(response, 200, { tokens: (store.snapshot().cliTokens ?? []).filter(item => item.userId === user.id).map(publicCliToken), scopes: CLI_SCOPES });
      } else if (path === '/api/cli/tokens' && request.method === 'POST') {
        const spec = settings(await readJson(request));
        let result;
        await store.update(state => { result = issue(state, user, spec); });
        sendJson(response, 201, result);
      } else if (/^\/api\/cli\/tokens\/[^/]+$/.test(path) && request.method === 'DELETE') {
        await store.update(state => {
          const token = state.cliTokens?.find(item => item.id === path.split('/').at(-1) && item.userId === user.id);
          if (!token) throw new AccessError('Token not found.', 404);
          token.revokedAt = new Date(now()).toISOString();
          appendAudit(state, { action: 'cli.token_revoked', actor: user.id, outcome: 'success', target: token.id });
        });
        sendJson(response, 200, { ok: true });
      } else {
        const match = path.match(/^\/api\/cli\/devices\/([A-F0-9]{10})$/);
        if (!match || !['GET', 'POST'].includes(request.method)) throw new AccessError('Not found.', 404);
        const find = state => {
          const item = state.cliDevices?.find(device => device.userCode === match[1] && !device.consumed && device.expiresAt > now());
          if (!item || item.status !== 'pending') throw new AccessError('CLI login expired or already handled.', 410);
          return item;
        };
        if (request.method === 'GET') {
          const { name, scopes, projectSlug, expiresInDays } = find(store.snapshot());
          sendJson(response, 200, { name, scopes, projectSlug, expiresInDays, userCode: match[1] });
        } else {
          const body = await readJson(request);
          if (typeof body.approve !== 'boolean') throw new InputError('Choose approve or deny.');
          await store.update(state => {
            const device = find(state);
            if (body.approve) assertGrants(state, user, device);
            device.status = body.approve ? 'approved' : 'denied';
            device.userId = user.id;
            device.authVersion = user.authVersion;
            appendAudit(state, { action: 'cli.device_' + device.status, actor: user.id, outcome: 'success', target: device.name });
          });
          sendJson(response, 200, { ok: true });
        }
      }
      return true;
    }
  };
}
