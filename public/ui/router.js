export const pageRoutes = Object.freeze({
  overview: '/',
  setup: '/setup',
  projects: '/projects',
  mail: '/mail',
  credentials: '/credentials',
  databases: '/databases',
  activity: '/activity',
  settings: '/settings'
});

const routePages = new Map(Object.entries(pageRoutes).map(([page, path]) => [path, page]));

export function pageForPathname(pathname) {
  if (routePages.has(pathname)) return routePages.get(pathname);
  if (pathname.startsWith('/projects/')) return 'projects';
  if (pathname.startsWith('/databases/')) return 'databases';
  if (pathname.startsWith('/mail/')) return 'mail';
  return 'overview';
}

export function pathnameForPage(page) {
  return pageRoutes[page] ?? pageRoutes.overview;
}
