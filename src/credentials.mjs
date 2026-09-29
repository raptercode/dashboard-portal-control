import { randomUUID } from 'node:crypto';
import { canAccess, visibleOrganizations } from './access.mjs';
import { AccessError } from './access-api.mjs';
import { InputError, appendAudit, validateHttpsCredential } from './core.mjs';

const permissions = ['credentials.use', 'credentials.create', 'credentials.update', 'credentials.delete'];
const scopeId = (value) => value?.organizationId || null;
const hidden = () => { throw new AccessError('Credential or organization was not found.', 404); };
const denied = () => { throw new AccessError(); };
const isMaster = (state, user) => state.users?.some((item) => item.id === user?.id && item.status === 'active' && item.role === 'master');
const wantsDefault = (body) => [true, 'on'].includes(body.default) || [true, 'on'].includes(body.defaultCredential);

function requireScope(state, user, organizationId, permission) {
  if (!organizationId) { if (!isMaster(state, user)) denied(); return; }
  if (!visibleOrganizations(state, user).some((org) => org.id === organizationId)) hidden();
  if (permission ? !canAccess(state, user, organizationId, permission) : !permissions.some((id) => canAccess(state, user, organizationId, id))) denied();
}

export function authorizeCredentialRequest(state, user, path, method, body = {}) {
  if (path === '/credentials' && method === 'GET') {
    if (body.organizationId) requireScope(state, user, body.organizationId);
    return { organizationId: body.organizationId || undefined };
  }
  if (path === '/credentials' && method === 'POST') {
    requireScope(state, user, scopeId(body), 'credentials.create');
    if (wantsDefault(body)) requireScope(state, user, scopeId(body), 'credentials.update');
    return { organizationId: scopeId(body) };
  }
  if (path === '/credentials/default' && method === 'POST') {
    requireScope(state, user, scopeId(body), 'credentials.update');
    if (body.credentialId) {
      const credential = state.credentials?.find((item) => item.id === body.credentialId);
      if (!credential || scopeId(credential) !== scopeId(body)) hidden();
    }
    return { organizationId: scopeId(body) };
  }
  const match = path.match(/^\/credentials\/([a-f0-9-]{36})$/i);
  if (match && ['PATCH', 'DELETE'].includes(method)) {
    const credential = state.credentials?.find((item) => item.id === match[1]);
    if (!credential || (!scopeId(credential) && !isMaster(state, user))) hidden();
    requireScope(state, user, scopeId(credential), method === 'PATCH' ? 'credentials.update' : 'credentials.delete');
    if (Object.hasOwn(body, 'organizationId') && scopeId(body) !== scopeId(credential)) throw new InputError('Credential organization cannot be changed. Create a new credential in the target organization.');
    return { organizationId: scopeId(credential) };
  }
  denied();
}

export function assertCredentialUse(state, user, credentialId, organizationId) {
  if (!credentialId) return;
  const credential = state.credentials?.find((item) => item.id === credentialId);
  // Do not expose existence of a credential belonging to another scope.
  if (!credential || (scopeId(credential) && scopeId(credential) !== organizationId)) denied();
  if (!isMaster(state, user)) {
    if (!scopeId(credential) || !canAccess(state, user, organizationId, 'credentials.use')) denied();
  }
}

function defaultId(state, organizationId) {
  return organizationId ? state.organizations.find((org) => org.id === organizationId)?.defaultCredentialId ?? null : state.git?.defaultCredentialId ?? null;
}

function setDefault(state, organizationId, credentialId) {
  const owner = organizationId ? state.organizations.find((org) => org.id === organizationId) : state.git;
  if (!owner) hidden();
  owner.defaultCredentialId = credentialId;
}

export function publicCredential(state, credential) {
  return { id: credential.id, name: credential.name, host: credential.host, type: credential.type, organizationId: scopeId(credential), createdAt: credential.createdAt, updatedAt: credential.updatedAt ?? null, isDefault: defaultId(state, scopeId(credential)) === credential.id };
}

export function listCredentials(state, user, organizationId) {
  const master = isMaster(state, user);
  const credentials = state.credentials.filter((item) => (organizationId === undefined || scopeId(item) === (organizationId || null)) && (master || (scopeId(item) && permissions.some((permission) => canAccess(state, user, item.organizationId, permission)))));
  return { credentials: credentials.map((item) => publicCredential(state, item)), defaultCredentialId: organizationId ? defaultId(state, organizationId) : master ? defaultId(state, null) : null };
}

function audit(state, credential, action) {
  appendAudit(state, { action: `credential.${action}`, outcome: 'success', actor: 'owner', organizationId: scopeId(credential), target: credential.id, detail: `HTTPS credential ${action}` });
}

export async function handleCredentialsApi({ request, response, url, store, user, vault, readJson, sendJson }) {
  if (!/^\/api\/credentials(?:\/|$)/.test(url.pathname)) return false;
  const path = url.pathname.replace(/^\/api/, '');
  if (!/^\/credentials(?:\/|$)/.test(path)) return false;
  const method = request.method;
  const body = method === 'GET' ? { organizationId: url.searchParams.get('organizationId') || undefined } : await readJson(request);
  authorizeCredentialRequest(store.snapshot(), user, path, method, body);
  if (method === 'GET') {
    sendJson(response, 200, { ...listCredentials(store.snapshot(), user, body.organizationId), vaultReady: Boolean(vault) });
    return true;
  }
  let createdId;
  let updatedId;
  await store.update((state) => {
    const { organizationId } = authorizeCredentialRequest(state, user, path, method, body);
    if (path === '/credentials' && method === 'POST') {
      if (!vault) throw new InputError('Credential vault is not configured. Set HOSTMGR_SECRET_KEY before saving a token.');
      const input = validateHttpsCredential(body);
      if (state.credentials.some((item) => scopeId(item) === (organizationId || null) && item.name === input.name)) throw new InputError('A credential with this name already exists in this scope.');
      const credential = { id: randomUUID(), organizationId: organizationId || null, name: input.name, host: input.host, type: 'https_token', createdAt: new Date().toISOString(), encryptedToken: vault.encrypt(input.token) };
      state.credentials.push(credential);
      createdId = credential.id;
      audit(state, credential, 'create');
      if (wantsDefault(body)) { setDefault(state, organizationId, credential.id); audit(state, credential, 'default_set'); }
    } else if (path === '/credentials/default' && method === 'POST') {
      if (body.credentialId != null && typeof body.credentialId !== 'string') throw new InputError('Credential selection is invalid.');
      const credentialId = body.credentialId || null;
      setDefault(state, organizationId, credentialId);
      audit(state, { id: credentialId, organizationId }, credentialId ? 'default_set' : 'default_clear');
    } else {
      const credential = state.credentials.find((item) => item.id === path.split('/')[2]);
      const inUse = state.projects.some((project) => project.credentialId === credential.id);
      if (method === 'DELETE') {
        if (inUse) throw new InputError('This credential is still selected by a project. Change that project to another credential first.');
        state.credentials = state.credentials.filter((item) => item.id !== credential.id);
        if (defaultId(state, organizationId) === credential.id) setDefault(state, organizationId, null);
        audit(state, credential, 'delete');
      } else {
        const replaceToken = body.token !== undefined && body.token !== '';
        const input = validateHttpsCredential({ name: body.name ?? credential.name, host: body.host ?? credential.host, token: replaceToken ? body.token : 'unchanged' });
        if (state.credentials.some((item) => item.id !== credential.id && scopeId(item) === scopeId(credential) && item.name === input.name)) throw new InputError('A credential with this name already exists in this scope.');
        if (input.host !== credential.host && inUse) throw new InputError('Cannot change the host while a project uses this credential.');
        if (input.host !== credential.host && !replaceToken) throw new InputError('Provide a replacement token when changing the Git host.');
        if (replaceToken) {
          if (!vault) throw new InputError('Credential vault is not configured.');
          credential.encryptedToken = vault.encrypt(input.token);
        }
        credential.name = input.name;
        credential.host = input.host;
        credential.updatedAt = new Date().toISOString();
        updatedId = credential.id;
        audit(state, credential, replaceToken ? 'rotate' : 'update');
      }
    }
  });
  const state = store.snapshot();
  if (createdId || updatedId) sendJson(response, createdId ? 201 : 200, { ok: true, credential: publicCredential(state, state.credentials.find((item) => item.id === (createdId || updatedId))) });
  else if (path === '/credentials/default') sendJson(response, 200, { ok: true, ...listCredentials(state, user, scopeId(body)) });
  else sendJson(response, 200, { ok: true });
  return true;
}
