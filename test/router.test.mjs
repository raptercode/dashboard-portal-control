import test from 'node:test';
import assert from 'node:assert/strict';
import { pageForPathname, pageRoutes, pathnameForPage } from '../public/router.js';

test('dashboard page routes are stable and fall back to the overview page', () => {
  assert.equal(pageRoutes.projects, '/projects');
  assert.equal(pageForPathname('/settings'), 'settings');
  assert.equal(pageForPathname('/not-found'), 'overview');
  assert.equal(pathnameForPage('credentials'), '/credentials');
  assert.equal(pathnameForPage('not-a-page'), '/');
});
