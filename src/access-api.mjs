import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PERMISSIONS, PERMISSION_PRESETS, publicUser, visibleOrganizations } from './access.mjs';
import { hashPassword, validateEmail, validateStrongPassword } from './auth.mjs';
import { InputError, appendAudit } from './core.mjs';

export class AccessError extends Error {
  constructor(message = 'Permission denied.', status = 403) { super(message); this.status = status; }
}
const digest = (token) => createHash('sha256').update(token).digest('hex');
const safeInvitation = ({ tokenHash, ...invitation }) => invitation;
function membershipsInput(state, values = []) {
  if (!Array.isArray(values)) throw new InputError('Memberships must be an array.');
  const seen = new Set();
  return values.map((entry) => {
    if (!entry || !state.organizations.some((org) => org.id === entry.organizationId) || seen.has(entry.organizationId)) throw new InputError('Invalid or duplicate organization.');
    seen.add(entry.organizationId);
    if (!Array.isArray(entry.permissions) || entry.permissions.some((id) => !PERMISSIONS.some((permission) => permission.id === id))) throw new InputError('Unknown permission.');
    return { organizationId: entry.organizationId, permissions: [...new Set(entry.permissions)] };
  });
}
function roleInput(role) {
  if (!['master', 'user'].includes(role)) throw new InputError('Role must be master or user.');
  return role;
}
function organizationName(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 80) throw new InputError('Organization name must be 1–80 characters.');
  return value.trim();
}

function assertCurrentMaster(state, user) {
  const current = user?.id && state.users.find((item) => item.id === user.id);
  if (!current || current.status !== 'active' || current.role !== 'master' || current.authVersion !== user.authVersion) throw new AccessError();
}

export async function handleAccessApi({ request, response, path, store, user, readJson, sendJson }) {
  const method = request.method;
  if (path === '/api/access' && method === 'GET') {
    const state = store.snapshot();
    sendJson(response, 200, { user: publicUser(user), organizations: visibleOrganizations(state, user), permissions: PERMISSIONS, presets: PERMISSION_PRESETS }); return true;
  }
  if (path === '/api/invitations/accept' && method === 'POST') {
    const body = await readJson(request);
    if (typeof body.token !== 'string' || body.token.length > 256) throw new InputError('Invalid invitation.');
    const tokenHash = digest(body.token);
    const candidate = store.snapshot().invitations.find((item) => item.tokenHash === tokenHash);
    if (!candidate || candidate.acceptedAt || candidate.revokedAt || !Number.isFinite(Date.parse(candidate.expiresAt)) || Date.parse(candidate.expiresAt) <= Date.now()) throw new AccessError('Invitation is invalid or expired.', 410);
    const password = validateStrongPassword(body.password);
    if (password !== (body.passwordConfirmation ?? body.confirmPassword)) throw new InputError('Passwords do not match.');
    const passwordHash = hashPassword(password);
    await store.update((state) => {
      const invitation = state.invitations.find((item) => item.tokenHash === tokenHash);
      if (!invitation || invitation.acceptedAt || invitation.revokedAt || !Number.isFinite(Date.parse(invitation.expiresAt)) || Date.parse(invitation.expiresAt) <= Date.now()) throw new AccessError('Invitation is invalid or expired.', 410);
      if (state.users.some((item) => item.email === invitation.email)) throw new InputError('Account already exists.');
      const created = { id: randomUUID(), email: invitation.email, password: passwordHash, role: invitation.role, status: 'active', authVersion: 1, createdAt: new Date().toISOString() };
      const memberships = membershipsInput(state, invitation.memberships);
      state.users.push(created);
      state.memberships.push(...memberships.map((membership) => ({ ...membership, userId: created.id })));
      invitation.acceptedAt = new Date().toISOString();
      appendAudit(state, { actor: created.id, actorUserId: created.id, action: 'member.invitation_accepted', outcome: 'success', target: created.id });
    });
    sendJson(response, 200, { ok: true }); return true;
  }
  if (!/^\/api\/(members|organizations|invitations)(\/|$)/.test(path)) return false;
  if (user?.role !== 'master') throw new AccessError();
  if (path === '/api/members' && method === 'GET') {
    const state = store.snapshot();
    sendJson(response, 200, { users: state.users.map(publicUser), organizations: state.organizations, memberships: state.memberships, invitations: state.invitations.map(safeInvitation) }); return true;
  }
  if (path === '/api/organizations' && method === 'POST') {
    const name = organizationName((await readJson(request)).name);
    const organization = { id: randomUUID(), name, createdAt: new Date().toISOString() };
    await store.update((state) => {
      assertCurrentMaster(state, user);
      if (state.organizations.some((item) => item.name.toLowerCase() === name.toLowerCase())) throw new InputError('Organization already exists.');
      state.organizations.push(organization);
      appendAudit(state, { actor: 'owner', action: 'organization.create', target: organization.id, organizationId: organization.id, outcome: 'success' });
    });
    sendJson(response, 201, { ok: true, organization }); return true;
  }
  const organizationMatch = path.match(/^\/api\/organizations\/([^/]+)$/);
  if (organizationMatch && method === 'PATCH') {
    const name = organizationName((await readJson(request)).name);
    await store.update((state) => {
      assertCurrentMaster(state, user);
      const organization = state.organizations.find((item) => item.id === organizationMatch[1]);
      if (!organization) throw new AccessError('Organization not found.', 404);
      if (state.organizations.some((item) => item.id !== organization.id && item.name.toLowerCase() === name.toLowerCase())) throw new InputError('Organization already exists.');
      organization.name = name;
      for (const project of state.projects.filter((item) => item.organizationId === organization.id)) project.organization = name;
      appendAudit(state, { actor: 'owner', action: 'organization.rename', target: organization.id, organizationId: organization.id, outcome: 'success' });
    });
    sendJson(response, 200, { ok: true }); return true;
  }
  if (path === '/api/invitations' && method === 'POST') {
    const body = await readJson(request);
    const token = randomBytes(32).toString('base64url');
    let invitation;
    await store.update((state) => {
      assertCurrentMaster(state, user);
      const email = validateEmail(body.email);
      if (state.users.some((item) => item.email === email)) throw new InputError('Account already exists.');
      const now = new Date().toISOString();
      for (const old of state.invitations.filter((item) => item.email === email && !item.acceptedAt && !item.revokedAt)) old.revokedAt = now;
      invitation = { id: randomUUID(), email, role: roleInput(body.role ?? 'user'), memberships: membershipsInput(state, body.memberships), tokenHash: digest(token), createdBy: user.id, createdAt: now, expiresAt: new Date(Date.now() + 48 * 3600 * 1000).toISOString(), acceptedAt: null, revokedAt: null };
      state.invitations.push(invitation);
      appendAudit(state, { actor: 'owner', action: 'member.invite', target: invitation.id, outcome: 'success' });
    });
    sendJson(response, 201, { ok: true, invitation: safeInvitation(invitation), token }); return true;
  }
  const invitationMatch = path.match(/^\/api\/invitations\/([^/]+)$/);
  if (invitationMatch && method === 'DELETE') {
    await store.update((state) => {
      assertCurrentMaster(state, user);
      const invitation = state.invitations.find((item) => item.id === invitationMatch[1]);
      if (!invitation) throw new AccessError('Invitation not found.', 404);
      invitation.revokedAt = new Date().toISOString();
      appendAudit(state, { actor: 'owner', action: 'member.invitation_revoked', target: invitation.id, outcome: 'success' });
    });
    sendJson(response, 200, { ok: true }); return true;
  }
  const memberMatch = path.match(/^\/api\/members\/([^/]+)$/);
  if (memberMatch && method === 'PATCH') {
    const body = await readJson(request);
    let updated;
    await store.update((state) => {
      assertCurrentMaster(state, user);
      const member = state.users.find((item) => item.id === memberMatch[1]);
      if (!member) throw new AccessError('Member not found.', 404);
      const role = body.role === undefined ? member.role : roleInput(body.role);
      const status = body.status ?? member.status;
      if (!['active', 'disabled'].includes(status)) throw new InputError('Invalid member status.');
      if (member.role === 'master' && member.status === 'active' && (role !== 'master' || status !== 'active') && !state.users.some((item) => item.id !== member.id && item.role === 'master' && item.status === 'active')) throw new InputError('The last active Master cannot be removed.');
      if (body.memberships !== undefined) {
        const memberships = membershipsInput(state, body.memberships);
        state.memberships = state.memberships.filter((item) => item.userId !== member.id);
        state.memberships.push(...memberships.map((item) => ({ ...item, userId: member.id })));
      }
      Object.assign(member, { role, status, authVersion: (member.authVersion || 1) + 1 });
      state.sessions = state.sessions.filter((item) => item.userId !== member.id);
      updated = publicUser(member);
      appendAudit(state, { actor: 'owner', action: 'member.update', target: member.id, outcome: 'success' });
    });
    sendJson(response, 200, { ok: true, user: updated }); return true;
  }
  return false;
}
