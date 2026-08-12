export const pageRoutes = Object.freeze({
  overview: '/',
  setup: '/setup',
  projects: '/projects',
  credentials: '/credentials',
  databases: '/databases',
  activity: '/activity',
  settings: '/settings'
});

const routePages = new Map(Object.entries(pageRoutes).map(([page, path]) => [path, page]));

export function pageForPathname(pathname) {
  if (routePages.has(pathname)) return routePages.get(pathname);
  if (pathname.startsWith('/projects/')) return 'projects';
  return 'overview';
}

export function pathnameForPage(page) {
  return pageRoutes[page] ?? pageRoutes.overview;
}
