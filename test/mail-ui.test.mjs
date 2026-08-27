import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from '../src/server.mjs';

test('Mail routes render a standalone shell while the Portal navigation opens them in a new tab', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'hostmgr-mail-ui-'));
  const app = await createApplication({
    dataPath: join(dir, 'state.json'),
    password: 'correct-horse-battery-staple',
    secretKey: Buffer.alloc(32, 7).toString('base64'),
    mode: 'demo',
    sandboxClone: false,
    metricsEnabled: false
  });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;

  const mail = await (await fetch(`${base}/mail`)).text();
  assert.match(mail, /<section id="dashboard-view" class="mail-app" hidden>/);
  assert.match(mail, /class="topbar mail-app-topbar"/);
  assert.match(mail, /id="mail-rows"/);
  assert.doesNotMatch(mail, /aria-label="Primary navigation"/);

  const setup = await (await fetch(`${base}/mail/setup`)).text();
  assert.match(setup, /<section id="dashboard-view" class="mail-app" hidden>/);
  assert.match(setup, /class="page mail-setup-page" data-page="mail"/);
  assert.match(setup, /id="wizard-body"/);
  assert.doesNotMatch(setup, /aria-label="Primary navigation"/);

  const portal = await (await fetch(`${base}/projects`)).text();
  assert.match(portal, /aria-label="Primary navigation"/);
  assert.match(portal, /data-nav="mail" href="\/mail" target="_blank" rel="noopener noreferrer"/);
});
