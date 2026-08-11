export const pageRoutes = Object.freeze({
  overview: '/',
  setup: '/setup',
  projects: '/projects',
  credentials: '/credentials',
  activity: '/activity',
  settings: '/settings'
});

const routePages = new Map(Object.entries(pageRoutes).map(([page, path]) => [path, page]));

export function pageForPathname(pathname) {
  return routePages.get(pathname) ?? 'overview';
}

export function pathnameForPage(page) {
  return pageRoutes[page] ?? pageRoutes.overview;
}
