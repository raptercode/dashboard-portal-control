import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('..', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('project log views preserve an independently scrollable runtime panel and wrap release metadata', async () => {
  const [app, css, dialogs, page] = await Promise.all([
    read('public/ui/app.js'),
    read('public/ui/app.css'),
    read('views/partials/dialogs.html'),
    read('views/pages/project-logs.html')
  ]);

  assert.match(app, /log-release-copy/);
  assert.match(app, /log-release-id/);
  assert.match(app, /log-release-time/);
  assert.match(css, /\.log-viewer \{[\s\S]*max-height: min\(440px, 52dvh\);[\s\S]*overflow: auto;[\s\S]*scrollbar-gutter: stable;/);
  assert.match(css, /\.log-release-copy \{[^}]*min-width: 0;/);
  assert.match(css, /\.log-release-id \{[^}]*overflow-wrap: anywhere;/);
  assert.match(page, /id="log-runtime"[^>]*tabindex="0"/);
  assert.match(page, /id="log-auto-refresh"/);
  assert.match(page, /id="log-refresh-now"/);
  assert.match(dialogs, /id="deployment-log-output"[^>]*tabindex="0"/);
  assert.match(css, /dialog#deployment-log-dialog\[open\] \{ display: grid; grid-template-rows: auto minmax\(0, 1fr\) auto; \}/);
  assert.doesNotMatch(css, /dialog#deployment-log-dialog\s*\{[^}]*display:/);
  assert.match(css, /dialog\.modal:not\(\[open\]\)\s*\{\s*display: none;/);
  assert.match(css, /\.deployment-log-output \{[\s\S]*max-height: min\(360px, 46dvh\);[\s\S]*overflow: auto;[\s\S]*scrollbar-gutter: stable;/);
  assert.match(css, /\.deployment-log-output \{[^}]*background: var\(--code-bg\);[^}]*color: var\(--code-text\);/);
  assert.match(css, /\.log-viewer \{[^}]*background: var\(--code-bg\);/);
});
