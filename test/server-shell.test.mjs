import test from 'node:test';
import assert from 'node:assert/strict';

import { start } from './support/server.mjs';

test('dashboard URLs reload their matching application shell', async (t) => {
  const { app, base } = await start();
  t.after(() => app.close());
  const pages = {
    '/': 'overview',
    '/setup': 'setup',
    '/projects': 'projects',
    '/credentials': 'credentials',
    '/databases': 'databases',
    '/activity': 'activity',
    '/members': 'members',
    '/invite': 'invite',
    '/settings': 'settings'
  };
  for (const [path, page] of Object.entries(pages)) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get('content-type'), /text\/html/);
    const html = await response.text();
    assert.match(html, new RegExp(`data-page="${page}"`));
    assert.match(html, /\/ui\/app\.js/);
  }
  for (const path of ['/projects/new', '/projects/new/repository', '/projects/new/review']) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 200, path);
    assert.match(await response.text(), /data-page="projects"/);
  }
  assert.equal((await fetch(`${base}/not-a-dashboard-page`)).status, 404);
  assert.equal((await fetch(`${base}/index.html`)).status, 404);
  assert.equal((await fetch(`${base}/app.js`)).status, 404);
});

test('UI assets support nested paths without exposing files outside public UI', async (t) => {
  const { app, base } = await start();
  t.after(() => app.close());

  const logo = await fetch(`${base}/ui/runtime-logos/nodejs.svg`);
  assert.equal(logo.status, 200);
  assert.match(logo.headers.get('content-type'), /image\/svg\+xml/);
  assert.match(await logo.text(), /<svg\b/);

  assert.equal((await fetch(`${base}/ui/..%2Fpackage.json`)).status, 404);
});
