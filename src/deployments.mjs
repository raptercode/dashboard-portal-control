import { canAccess, resolveProjectOrganization } from './access.mjs';
import { AccessError } from './access-api.mjs';

// A metadata-only projection shared by the dashboard and CLI. Runtime output,
// job messages, failure logs and environment values stay on their scoped APIs.
export function deploymentFeed(state, user, { projectSlug, tokenProjectSlug } = {}) {
  const current = state.users.find(item => item.id === user?.id);
  if (!current || current.status !== 'active') throw new AccessError();
  const projects = state.projects.filter(project => {
    if (tokenProjectSlug && project.slug !== tokenProjectSlug) return false;
    if (projectSlug && project.slug !== projectSlug) return false;
    return current.role === 'master' || canAccess(state, current, resolveProjectOrganization(state, project)?.id, 'project.view');
  });
  if (projectSlug && !projects.length) throw new AccessError('Project not found.', 404);
  const visible = new Map(projects.map(project => [project.slug, project]));
  const jobs = state.jobs.filter(job => visible.has(job.projectSlug));
  const rows = jobs.map(job => {
    const project = visible.get(job.projectSlug);
    const release = project.deployment?.releases?.find(item => item.id === job.releaseId);
    return {
      id: job.id, kind: job.kind, projectSlug: project.slug, projectName: project.name,
      runtime: project.runtime, branch: project.branch || 'main', releaseId: job.releaseId,
      revision: release?.revision || null, status: job.status,
      createdAt: job.createdAt, startedAt: job.startedAt || null, finishedAt: job.finishedAt || null,
      phase: job.events?.at(-1)?.phase || null,
      current: Boolean(job.releaseId && project.deployment?.activeReleaseId === job.releaseId)
    };
  });
  for (const project of projects) {
    for (const release of project.deployment?.releases || []) {
      if (jobs.some(job => job.projectSlug === project.slug && job.releaseId === release.id)) continue;
      rows.push({
        id: release.id, kind: 'release', projectSlug: project.slug, projectName: project.name,
        runtime: project.runtime, branch: project.branch || 'main', releaseId: release.id,
        revision: release.revision || null,
        status: release.status === 'failed' ? 'failed' : ['active', 'healthy', 'superseded'].includes(release.status) ? 'succeeded' : 'running',
        createdAt: release.createdAt, startedAt: release.createdAt,
        finishedAt: release.activatedAt || null, phase: null,
        current: project.deployment?.activeReleaseId === release.id
      });
    }
  }
  rows.sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
  return {
    deployments: rows.slice(0, 100),
    summary: {
      total: rows.length, active: rows.filter(row => ['queued', 'running'].includes(row.status)).length,
      succeeded: rows.filter(row => row.status === 'succeeded').length,
      failed: rows.filter(row => row.status === 'failed').length
    },
    projects: projects.map(({ slug, name }) => ({ slug, name })),
    updatedAt: new Date().toISOString()
  };
}
