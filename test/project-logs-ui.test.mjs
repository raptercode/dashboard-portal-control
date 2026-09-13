import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('..', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('project log views preserve an independently scrollable runtime panel and wrap release metadata', async () => {
  const [app, css, compat, dialogs, page] = await Promise.all([
    read('public/ui/app.js'),
    read('public/ui/admin.css'),
    read('public/ui/v2-compat.css'),
    read('views/partials/dialogs.html'),
    read('views/pages/project-logs.html')
  ]);

  assert.match(app, /log-release-copy/);
  assert.match(app, /log-release-id/);
  assert.match(app, /log-release-time/);
  assert.match(css, /\.log-viewer \{[\s\S]*max-height: min\(440px, 52dvh\);[\s\S]*overflow: auto;[\s\S]*scrollbar-gutter: stable;/);
  assert.match(css, /\.log-release-copy \{[\s\S]*min-width: 0;/);
  assert.match(css, /\.log-release-id \{[\s\S]*overflow-wrap: anywhere;/);
  assert.match(page, /id="log-runtime"[^>]*tabindex="0"/);
  assert.match(dialogs, /id="deployment-log-output"[^>]*tabindex="0"/);
  assert.match(compat, /dialog#deployment-log-dialog \{ display: grid; grid-template-rows: auto minmax\(0, 1fr\) auto; \}/);
  assert.match(compat, /\.deployment-log-output \{[\s\S]*max-height: min\(360px, 46dvh\);[\s\S]*overflow: auto;[\s\S]*scrollbar-gutter: stable;/);
});
