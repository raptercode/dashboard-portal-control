import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('..', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('project list keeps technical settings behind details and protects deletion by exact name', async () => {
  const [app, dialogs, css, layout] = await Promise.all([
    read('public/ui/app.js'),
    read('views/partials/dialogs.html'),
    read('public/ui/admin.css'),
    read('views/layout.html')
  ]);

  assert.match(app, /project-details/);
  assert.match(app, /project-actions-menu/);
  assert.match(app, /input\.value !== project\.name/);
  assert.match(dialogs, /id="project-delete-dialog"/);
  assert.match(dialogs, /id="project-delete-confirmation"/);
  assert.match(css, /project-action-divider/);
  assert.match(css, /Dark workspace/);
  assert.match(layout, /name="color-scheme" content="dark"/);
});
