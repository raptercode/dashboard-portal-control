import { randomUUID } from 'node:crypto';

export const PERMISSIONS = Object.freeze([
  { id: 'project.view', label: 'ดูโปรเจกต์', group: 'project' },
  { id: 'project.create', label: 'สร้างโปรเจกต์', group: 'project' },
  { id: 'project.configure', label: 'ตั้งค่าโปรเจกต์', group: 'project' },
  { id: 'source.sync', label: 'ซิงก์ซอร์สโค้ด', group: 'source' },
  { id: 'credentials.use', label: 'ใช้ Credential เชื่อมต่อ Repository', group: 'credentials' },
  { id: 'credentials.create', label: 'เพิ่ม Credential', group: 'credentials' },
  { id: 'credentials.update', label: 'แก้ไข Credential และค่าเริ่มต้น', group: 'credentials' },
  { id: 'credentials.delete', label: 'ลบ Credential', group: 'credentials' },
  { id: 'deploy.start', label: 'Deploy', group: 'deploy' },
  { id: 'deploy.rollback', label: 'Rollback', group: 'deploy' },
  { id: 'logs.read', label: 'อ่าน Log', group: 'project' },
  { id: 'env.read', label: 'อ่าน Environment', group: 'environment' },
  { id: 'env.write', label: 'แก้ไข Environment', group: 'environment' },
  { id: 'domains.manage', label: 'จัดการโดเมน', group: 'project' },
  { id: 'webhooks.manage', label: 'จัดการ Webhook', group: 'project' },
  { id: 'audit.read', label: 'อ่านประวัติการทำงาน', group: 'project' }
].map(Object.freeze));
const permissionIds = PERMISSIONS.map(({ id }) => id);
export const PERMISSION_PRESETS = Object.freeze({
  viewer: Object.freeze(['project.view', 'logs.read', 'audit.read']),
  operator: Object.freeze(['project.view', 'source.sync', 'deploy.start', 'deploy.rollback', 'logs.read', 'audit.read']),
  maintainer: Object.freeze([...permissionIds])
});

// Call at load and explicit bootstrap/legacy fixture boundaries, never on each write.
export function migrateAccessState(state) {
  state.users ??= [];
  state.organizations ??= [];
  state.memberships ??= [];
  state.invitations ??= [];
  const now = state.createdAt || new Date().toISOString();
  if (state.owner?.email && !state.legacyOwnerId) {
    let owner = state.users.find((user) => user.email.toLowerCase() === state.owner.email.toLowerCase());
    if (!owner) {
      owner = { id: randomUUID(), email: state.owner.email, password: state.owner.password ?? null, role: 'master', status: 'active', authVersion: 1, createdAt: state.owner.createdAt || now };
      state.users.push(owner);
    }
    state.legacyOwnerId = owner.id;
    for (const session of state.sessions ?? []) {
      if (!session.userId) { session.userId = owner.id; session.authVersion = owner.authVersion; }
    }
  }
  const ensureOrganization = (name) => {
    let organization = state.organizations.find((item) => item.name === name);
    if (!organization) {
      organization = { id: randomUUID(), name, createdAt: now };
      state.organizations.push(organization);
    }
    return organization;
  };
  for (const project of state.projects ?? []) {
    if (!project.organizationId) project.organizationId = ensureOrganization(project.organization || 'Default').id;
    const organization = state.organizations.find((item) => item.id === project.organizationId);
    if (organization) project.organization = organization.name;
  }
  if (!state.organizations.length) ensureOrganization('Default');
  state.schemaVersion = Math.max(state.schemaVersion || 0, 4);
  return state;
}

export function publicUser(user) {
  if (!user) return null;
  return { id: user.id, email: user.email, role: user.role, status: user.status, createdAt: user.createdAt };
}

export function permissionsFor(state, user, organizationId) {
  const current = user?.id && state.users?.find((item) => item.id === user.id);
  if (!current || current.status !== 'active' || !state.organizations?.some((item) => item.id === organizationId)) return [];
  if (current.role === 'master') return [...permissionIds];
  if (current.role !== 'user') return [];
  const grants = new Set((state.memberships ?? []).filter((membership) => membership.userId === current.id && membership.organizationId === organizationId).flatMap((membership) => membership.permissions ?? []));
  return permissionIds.filter((permission) => grants.has(permission));
}

export function canAccess(state, user, organizationId, permission) {
  return permissionsFor(state, user, organizationId).includes(permission);
}

export function visibleOrganizations(state, user) {
  const current = user?.id && state.users?.find((item) => item.id === user.id);
  if (!current || current.status !== 'active') return [];
  return (state.organizations ?? []).filter((organization) => current.role === 'master' || (current.role === 'user' && state.memberships?.some((membership) => membership.userId === current.id && membership.organizationId === organization.id))).map((organization) => ({ id: organization.id, name: organization.name, createdAt: organization.createdAt, permissions: permissionsFor(state, current, organization.id) }));
}

export function resolveProjectOrganization(state, project) {
  if (!project) return null;
  if (project.organizationId) return state.organizations?.find((item) => item.id === project.organizationId) ?? null;
  // Compatibility for callers that explicitly seed legacy projects after load.
  return state.organizations?.find((item) => item.name === (project.organization || 'Default')) ?? null;
}
