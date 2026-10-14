import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { settingsSection, SETTINGS_SECTIONS } from '../public/ui/settings-navigation.js';
import { createRenderer } from '../src/render.mjs';
import { fileURLToPath } from 'node:url';

test('settings URLs choose a safe section and keep nonmaster accounts in password settings', () => {
  for (const section of ['account', 'updates', 'monitor']) {
    assert.equal(settingsSection(`?section=${section}`, true), section);
    assert.equal(settingsSection(`?section=${section}`, false), 'account');
    assert.equal(settingsSection('', true, `/settings/${section}`), section);
    assert.equal(settingsSection('', false, `/settings/${section}`), 'account');
  }
  for (const search of ['', '?section=unknown', '?section=__proto__', '?section=constructor']) assert.equal(settingsSection(search, true), 'account');
});

test('navigation removes empty grant groups and restores them when access changes on refresh', async () => {
  const app = await readFile(new URL('../public/ui/app.js', import.meta.url), 'utf8');
  const update = app.split('\n').find((line) => line.includes("$$('.nav-group').forEach"));
  assert.ok(update);
  const groups = [{ links: [{ hidden: true }, { hidden: true }] }, { links: [{ hidden: false }] }];
  const refreshVisibility = () => runInNewContext(update, { $$: (selector, group) => group ? group.links : groups });
  refreshVisibility();
  assert.deepEqual(groups.map((group) => group.hidden), [true, false]);
  groups[0].links[1].hidden = false;
  groups[1].links[0].hidden = true;
  refreshVisibility();
  assert.deepEqual(groups.map((group) => group.hidden), [false, true]);
});

test('separate settings templates emit only the selected task rather than hiding unrelated forms', async () => {
  const renderer = createRenderer(fileURLToPath(new URL('../views', import.meta.url)));
  for (const [view, included, excluded] of [
    ['settings-account', 'password-change-form', ['software-update', 'monitor-token-form']],
    ['settings-updates', 'software-update', ['password-change-form', 'monitor-token-form']],
    ['settings-monitor', 'monitor-token-form', ['password-change-form', 'software-update']]
  ]) {
    const html = await renderer.render(view, { page: 'settings', view });
    assert.ok(html.includes(`id="${included}"`));
    for (const id of excluded) assert.equal(html.includes(`id="${id}"`), false, `${view} must not emit ${id}`);
    for (const section of ['account', 'updates', 'monitor']) assert.ok(html.includes(`href="/settings/${section}"`));
  }
});

test('each settings route renders only its purpose and fetches monitor tokens only on the monitor page', async () => {
  const app = await readFile(new URL('../public/ui/app.js', import.meta.url), 'utf8');
  const source = app.match(/function renderSettings\(\) \{[^]*?\n\}/)[0];
  for (const [master, search, expected] of [[true, '', 'account'], [true, '?section=updates', 'updates'], [true, '?section=monitor', 'monitor'], [false, '?section=monitor', 'account']]) {
    const nodes = new Map();
    const links = ['account', 'updates', 'monitor'].map((section) => ({ dataset: { settingsLink: section }, setAttribute(key, value) { this[key] = value; }, removeAttribute(key) { delete this[key]; } }));
    let monitor = 0;
    let updates = 0;
    const render = runInNewContext(`${source}; renderSettings`, {
      settingsSection, SETTINGS_SECTIONS, location: { search }, isMaster: () => master,
      $: (selector) => { if (!nodes.has(selector)) nodes.set(selector, {}); return nodes.get(selector); },
      $$: () => links,
      document: {}, state: { mode: 'demo' }, showError: (error) => { throw error; },
      renderMonitorTokens: async () => { monitor++; }, renderSoftwareUpdate: () => { updates++; }
    });
    render();
    assert.equal(nodes.get('#settings-title').textContent, SETTINGS_SECTIONS[expected].title);
    assert.equal(links.filter((link) => link['aria-current'] === 'page')[0].dataset.settingsLink, expected);
    assert.equal(monitor, expected === 'monitor' ? 1 : 0);
    assert.equal(updates, expected === 'updates' ? 1 : 0);
  }
});
