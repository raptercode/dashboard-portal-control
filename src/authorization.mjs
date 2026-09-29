import { isDeepStrictEqual } from 'node:util';
import { canAccess, resolveProjectOrganization } from './access.mjs';
import { AccessError } from './access-api.mjs';
import { validateProjectSync } from './core.mjs';

const denied = () => { throw new AccessError(); };
const hidden = () => { throw new AccessError('Not found.', 404); };

export function authorizeRequest({ state, user, path, method, body = {} }) {
  const current = user?.id && state.users?.find((item) => item.id === user.id);
  if (!current || current.status !== 'active') denied();
  const master = current.role === 'master';
  path = path.replace(/^\/api(?=\/)/, '');
  const has = (organizationId, permission) => canAccess(state, current, organizationId, permission);
  const requirePermission = (organizationId, permission) => { if (!has(organizationId, permission)) denied(); };
  const scopeProject = (slug) => {
    const project = state.projects?.find((item) => item.slug === slug);
    const organization = resolveProjectOrganization(state, project);
    if (!project || !organization || (!master && !has(organization.id, 'project.view'))) hidden();
    return { project, organization, organizationId: organization.id };
  };

  if (method === 'POST' && path === '/projects/sync') {
    const project = state.projects?.find((item) => item.slug === body.slug) ?? null;
    const existingOrganization = resolveProjectOrganization(state, project);
    let organization = body.organizationId
      ? state.organizations?.find((item) => item.id === body.organizationId)
      : existingOrganization ?? state.organizations?.find((item) => item.name === (body.organization?.trim() || 'Default'));
    if (body.organizationId && !organization) hidden();
    if (master) return { project, organization: organization ?? null, organizationId: organization?.id, organizationName: organization?.name ?? (body.organization?.trim() || 'Default') };
    if (project) {
      const scope = scopeProject(project.slug);
      organization = scope.organization;
      if ((body.organizationId && body.organizationId !== organization.id) || (body.organization && body.organization.trim() !== organization.name)) denied();
      requirePermission(organization.id, 'source.sync');
      // A bound credential cannot be sent to a replacement repository by a member.
      if ((body.credentialId || null) !== (project.credentialId || null)) denied();
      if ((body.sshKeyId || null) !== (project.sshKeyId || null)) denied();
      if (!project.sshKeyId && String(body.repository ?? '').startsWith('git@')) denied();
      if ((project.credentialId || project.sshKeyId) && body.repository !== project.repository) denied();
      const incoming = validateProjectSync({ ...body, organization: organization.name });
      const stored = validateProjectSync({ ...project, organization: organization.name, domains: project.domains?.hosts });
      const canonical = (value) => Object.fromEntries(Object.entries(value).filter(([key]) => !['domains', 'organization'].includes(key)));
      // Missing optional fields are retained by the sync merge; missing required/defaulted fields are not.
      const effective = { ...canonical(stored), ...canonical(incoming) };
      if (incoming.port === null) effective.port = stored.port;
      if (!isDeepStrictEqual(effective, canonical(stored))) requirePermission(organization.id, 'project.configure');
      if (incoming.domains && !isDeepStrictEqual(incoming.domains.hosts, project.domains?.hosts ?? [])) {
        requirePermission(organization.id, 'project.configure');
        requirePermission(organization.id, 'domains.manage');
      }
      return scope;
    }
    if (!body.organizationId || !organization) denied();
    requirePermission(organization.id, 'project.create');
    if (body.credentialId || body.sshKeyId || String(body.repository ?? '').startsWith('git@')) denied();
    if (body.domains?.length) requirePermission(organization.id, 'domains.manage');
    return { organizationId: organization.id, organization, project: null };
  }
  if (master) return {};
  if (current.role !== 'user') denied();
  if (method === 'GET' && ['/access', '/projects', '/audit', '/notification-hooks', '/monitor-tokens'].includes(path)) return {};
  if (method === 'POST' && ['/logout', '/settings/password'].includes(path)) return {};

  if (method === 'POST' && ['/git/branches', '/projects/runtime-detect'].includes(path)) {
    const organization = state.organizations?.find((item) => item.id === body.organizationId);
    if (!organization || body.credentialId || String(body.repository ?? '').startsWith('git@')) denied();
    if (!has(organization.id, 'project.create') && !has(organization.id, 'project.configure')) denied();
    return { organization, organizationId: organization.id };
  }
  const jobMatch = path.match(/^\/jobs\/([^/]+)$/);
  if (method === 'GET' && jobMatch) {
    const job = state.jobs?.find((item) => item.id === jobMatch[1]);
    if (!job) hidden();
    const scope = scopeProject(job.projectSlug);
    requirePermission(scope.organizationId, 'logs.read');
    return scope;
  }
  const integration = path.match(/^\/(monitor-tokens|notification-hooks)(?:\/([^/]+))?$/);
  if (integration && ((method === 'POST' && !integration[2]) || (method === 'DELETE' && integration[2]))) {
    const collection = integration[1] === 'monitor-tokens' ? state.monitorTokens : state.notificationHooks;
    const target = method === 'POST' ? body : collection?.find((item) => item.id === integration[2]);
    if (!target) hidden();
    if (!target.projectSlug) denied();
    const scope = scopeProject(target.projectSlug);
    requirePermission(scope.organizationId, 'webhooks.manage');
    if (integration[1] === 'monitor-tokens' && method === 'POST') requirePermission(scope.organizationId, 'logs.read');
    return scope;
  }
  const projectRoute = path.match(/^\/projects\/([^/]+)(?:\/(.+))?$/);
  if (projectRoute) {
    const scope = scopeProject(projectRoute[1]);
    const action = projectRoute[2];
    const permission = {
      'POST deploy': 'deploy.start', 'POST rollback': 'deploy.rollback',
      'GET deploy-configuration': 'project.view', 'GET environment': 'env.read',
      'POST environment': 'env.write', 'GET logs': 'logs.read',
      'POST domains': 'domains.manage', 'POST domains/check': 'domains.manage', 'POST edge/check': 'domains.manage'
    }[`${method} ${action}`];
    if (method === 'POST' && ['auto-sync', 'github-webhook', 'actions-hook'].includes(action)) {
      requirePermission(scope.organizationId, 'webhooks.manage');
      requirePermission(scope.organizationId, 'deploy.start');
      return scope;
    }
    if (!permission) denied();
    requirePermission(scope.organizationId, permission);
    return scope;
  }
  denied();
}
