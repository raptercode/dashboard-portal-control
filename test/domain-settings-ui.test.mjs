import test from 'node:test';
import assert from 'node:assert/strict';
import { createDomainSettings } from '../public/ui/project-domains.js';

class Node {
  constructor(tag = '', text = '') { this.tag = tag; this.textContent = text; this.children = []; this.listeners = {}; this.value = ''; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(type, handler) { this.listeners[type] = handler; }
  setAttribute(name, value) { this[name] = value; }
}
const flush = () => new Promise(resolve => setImmediate(resolve));
const project = (slug = 'app', hosts = []) => ({ name: slug, slug, domains: { hosts, activeHosts: [] }, deployment: { activeReleaseId: 'release' } });

function fixture(api) {
  const nodes = new Map();
  const $ = id => { if (!nodes.has(id)) nodes.set(id, new Node()); return nodes.get(id); };
  const errors = [];
  const changes = [];
  const controller = createDomainSettings({
    $, api, element: (tag, _class, text) => new Node(tag, text), statusChip: text => new Node('span', text),
    showDialog() {}, clearDialogError() {}, showError: error => errors.push(error.message), toast() {},
    confirmAction: async () => true, refreshCards: async () => {}, onProjectChanged: value => changes.push(value), copyText: async () => {}
  });
  controller.bind();
  const submit = () => $('#domain-form').listeners.submit({ preventDefault() {} });
  return { controller, $, errors, changes, submit };
}

const statusResponse = path => path.endsWith('/domains/check')
  ? { status: 'proxied', resolved: ['104.21.51.31'], expected: ['192.0.2.1'], proxy: { detected: true, provider: 'Cloudflare' } }
  : { passed: true, status: 'ok', tls: { status: 'valid', expiresAt: '2027-01-01T00:00:00.000Z' } };

test('Add submits immediately without a DNS prerequisite and shows records after saving', async () => {
  const calls = [];
  const ui = fixture(async (path, options) => {
    calls.push({ path, ...options });
    if (path.endsWith('/domains')) return { project: project('app', options.body.domains), domainSync: { status: 'pending', detail: 'ตั้ง DNS แล้วกด Verify' } };
    return statusResponse(path);
  });
  ui.controller.open(project());
  ui.$('#domain-hostname').value = 'NEW.EXAMPLE.TEST';
  await ui.submit();
  assert.deepEqual(calls[0].body, { domains: ['new.example.test'], sync: false });
  assert.equal(calls[0].path, '/api/projects/app/domains');
  assert.equal(ui.$('#domain-hostname').value, '');
  assert.equal(ui.$('#domain-list').children.length, 1);
  assert.equal(ui.errors.length, 0);
});

test('failed Add retains input and displays the error instead of dropping the draft', async () => {
  const ui = fixture(async () => { throw new Error('Enter a valid DNS hostname.'); });
  ui.controller.open(project());
  ui.$('#domain-hostname').value = 'invalid host';
  await ui.submit();
  assert.equal(ui.$('#domain-hostname').value, 'invalid host');
  assert.equal(ui.$('#domain-submit').disabled, false);
  assert.match(ui.errors[0], /hostname/);
  assert.equal(ui.changes.length, 0);
});

test('an in-flight Add blocks duplicate submits and cannot overwrite a reopened dialog', async () => {
  let finish;
  let calls = 0;
  const ui = fixture(async () => { calls++; return new Promise(resolve => { finish = resolve; }); });
  ui.controller.open(project());
  ui.$('#domain-hostname').value = 'first.example.test';
  const pending = ui.submit();
  assert.equal(ui.$('#domain-submit').disabled, true);
  await ui.submit();
  assert.equal(calls, 1);
  ui.controller.close();
  ui.controller.open(project('second'));
  ui.$('#domain-hostname').value = 'second.example.test';
  finish({ project: project('app', ['first.example.test']), domainSync: { status: 'pending' } });
  await pending;
  assert.equal(ui.$('#domain-hostname').value, 'second.example.test');
  assert.equal(ui.$('#domain-list').children.length, 0);
  assert.equal(ui.changes[0].slug, 'app');
});

test('Refresh only checks DNS and per-domain edge status; Verify is an explicit mutation', async () => {
  const calls = [];
  const ui = fixture(async (path, options) => {
    calls.push({ path, ...options });
    if (path.endsWith('/domains/verify')) return { project: project('app', ['app.example.test']), domainSync: { status: 'synced' } };
    return statusResponse(path);
  });
  ui.controller.open(project('app', ['app.example.test']));
  await flush();
  assert.deepEqual(calls.map(call => call.path).sort(), ['/api/projects/app/domains/check', '/api/projects/app/edge/check']);
  assert.ok(calls.every(call => call.body.hostname === 'app.example.test'));
  await ui.$('#domain-verify-all').listeners.click();
  assert.ok(calls.some(call => call.path.endsWith('/domains/verify')));
  assert.equal(ui.errors.length, 0);
});

test('late DNS/edge results from a closed dialog never render into another project', async () => {
  const pending = [];
  const ui = fixture(path => new Promise(resolve => pending.push(() => resolve(statusResponse(path)))));
  ui.controller.open(project('first', ['first.example.test']));
  ui.controller.close();
  ui.controller.open(project('second'));
  for (const finish of pending) finish();
  await flush();
  assert.equal(ui.$('#domain-list').children.length, 0);
  assert.equal(ui.$('#domain-project-label').textContent, 'second · second');
});
