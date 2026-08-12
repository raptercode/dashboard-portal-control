export const pageRoutes = Object.freeze({
  overview: '/',
  setup: '/setup',
  projects: '/projects',
  credentials: '/credentials',
  databases: '/databases',
  activity: '/activity',
  settings: '/settings'
});

export const projectFlowRoutes = Object.freeze({
  createIdentity: '/projects/new',
  createRepository: '/projects/new/repository',
  createReview: '/projects/new/review'
});

const staticPages = new Map(Object.entries(pageRoutes).map(([page, path]) => [path, page]));

export function matchUiRoute(pathname) {
  if (staticPages.has(pathname)) {
    return { page: staticPages.get(pathname), view: staticPages.get(pathname), params: {} };
  }
  if (pathname === projectFlowRoutes.createIdentity) {
    return { page: 'projects', view: 'projects-new', params: { mode: 'create' } };
  }
  if (pathname === projectFlowRoutes.createRepository) {
    return { page: 'projects', view: 'projects-new-repository', params: { mode: 'create' } };
  }
  if (pathname === projectFlowRoutes.createReview) {
    return { page: 'projects', view: 'projects-new-review', params: { mode: 'create' } };
  }
  const editIdentity = pathname.match(/^\/projects\/([a-z][a-z0-9-]{0,62})\/edit$/);
  if (editIdentity) {
    return { page: 'projects', view: 'projects-new', params: { mode: 'edit', slug: editIdentity[1] } };
  }
  const editRepository = pathname.match(/^\/projects\/([a-z][a-z0-9-]{0,62})\/edit\/repository$/);
  if (editRepository) {
    return { page: 'projects', view: 'projects-new-repository', params: { mode: 'edit', slug: editRepository[1] } };
  }
  const editReview = pathname.match(/^\/projects\/([a-z][a-z0-9-]{0,62})\/edit\/review$/);
  if (editReview) {
    return { page: 'projects', view: 'projects-new-review', params: { mode: 'edit', slug: editReview[1] } };
  }
  const logs = pathname.match(/^\/projects\/([a-z][a-z0-9-]{0,62})\/logs$/);
  if (logs) {
    return { page: 'projects', view: 'project-logs', params: { slug: logs[1] } };
  }
  return null;
}

export function isDashboardPath(pathname) {
  return matchUiRoute(pathname) !== null;
}

export function pageForPathname(pathname) {
  return matchUiRoute(pathname)?.page ?? 'overview';
}

export function pathnameForPage(page) {
  return pageRoutes[page] ?? pageRoutes.overview;
}
