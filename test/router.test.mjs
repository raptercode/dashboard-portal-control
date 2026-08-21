import test from 'node:test';
import assert from 'node:assert/strict';
import { matchUiRoute, pageForPathname, pageRoutes, pathnameForPage, projectFlowRoutes } from '../src/ui-routes.mjs';

test('dashboard page routes are stable and fall back to the overview page', () => {
  assert.equal(pageRoutes.projects, '/projects');
  assert.equal(pageForPathname('/settings'), 'settings');
  assert.equal(pageForPathname('/not-found'), 'overview');
  assert.equal(pathnameForPage('credentials'), '/credentials');
  assert.equal(pathnameForPage('not-a-page'), '/');
});

test('project create and edit flows use dedicated multipage routes', () => {
  assert.equal(projectFlowRoutes.createIdentity, '/projects/new');
  assert.deepEqual(matchUiRoute('/projects/new'), { page: 'projects', view: 'projects-new', params: { mode: 'create' } });
  assert.deepEqual(matchUiRoute('/projects/new/repository'), { page: 'projects', view: 'projects-new-repository', params: { mode: 'create' } });
  assert.deepEqual(matchUiRoute('/projects/new/review'), { page: 'projects', view: 'projects-new-review', params: { mode: 'create' } });
  assert.deepEqual(matchUiRoute('/projects/demo-app/edit'), { page: 'projects', view: 'projects-new', params: { mode: 'edit', slug: 'demo-app' } });
  assert.equal(matchUiRoute('/projects/Demo/edit'), null);
  assert.equal(pageForPathname('/projects/new'), 'projects');
});

test('project logs use a dedicated per-project route', () => {
  assert.deepEqual(matchUiRoute('/projects/demo-app/logs'), { page: 'projects', view: 'project-logs', params: { slug: 'demo-app' } });
  assert.equal(matchUiRoute('/projects/Demo/logs'), null);
});

test('Mail and its setup wizard keep explicit reloadable routes', () => {
  assert.equal(pageRoutes.mail, '/mail');
  assert.deepEqual(matchUiRoute('/mail'), { page: 'mail', view: 'mail', params: {} });
  assert.deepEqual(matchUiRoute('/mail/setup'), { page: 'mail', view: 'mail-setup', params: {} });
});
