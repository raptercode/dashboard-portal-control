import test from 'node:test';
import assert from 'node:assert/strict';
import { start } from './support/server.mjs';

test('Settings direct and legacy URLs render only the requested category after a reload', async t => {
  const { app, base } = await start();
  t.after(() => app.close());
  const markers = { account: 'id="password-change-form"', updates: 'id="software-update"', monitor: 'id="monitor-token-form"' };
  for (const section of ['account', 'updates', 'monitor']) {
    const paths = [`/settings/${section}`, `/settings?section=${section}`, ...(section === 'account' ? ['/settings', '/settings?section=unknown'] : [])];
    for (const path of paths) {
      const response = await fetch(base + path);
      assert.equal(response.status, 200, path);
      assert.match(response.headers.get('content-type'), /text\/html/);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const html = await response.text();
      assert.ok(html.includes(`data-view="settings-${section}"`), path);
      assert.ok(html.includes(markers[section]), path);
      for (const [other, marker] of Object.entries(markers)) if (other !== section) assert.equal(html.includes(marker), false, `${path} must not render ${other} controls`);
      assert.equal(html.includes('correct-horse-battery-staple'), false);
    }
  }
  assert.equal((await fetch(base + '/settings/not-a-section')).status, 404);
  const injection = await fetch(base + '/settings?section=../../private');
  assert.equal(injection.status, 200);
  assert.ok((await injection.text()).includes('data-view="settings-account"'));
});
