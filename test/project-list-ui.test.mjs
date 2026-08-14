import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('..', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('project list keeps technical settings behind details and protects deletion by exact name', async () => {
  const [app, dialogs, css, compat, layout] = await Promise.all([
    read('public/ui/app.js'),
    read('views/partials/dialogs.html'),
    read('public/ui/admin.css'),
    read('public/ui/v2-compat.css'),
    read('views/layout.html')
  ]);

  assert.match(app, /project-details/);
  assert.match(app, /project-actions-menu/);
  assert.match(app, /Sync latest/);
  assert.match(app, /function syncExistingProject\(project, button\)/);
  assert.match(app, /domain\.target = '_blank'/);
  assert.match(app, /domain\.rel = 'noopener noreferrer'/);
  assert.match(app, /input\.value !== project\.name/);
  assert.match(dialogs, /id="project-delete-dialog"/);
  assert.match(dialogs, /id="project-delete-confirmation"/);
  assert.match(dialogs, /class="modal drawer deploy-drawer"/);
  assert.match(dialogs, /data-deploy-step="1"/);
  assert.match(dialogs, /data-deploy-step="2"/);
  assert.match(dialogs, /data-deploy-step="3"/);
  assert.match(dialogs, /id="deploy-environment-rows"/);
  assert.match(dialogs, /id="deploy-add-variable"/);
  assert.match(dialogs, /id="deploy-package-manager"/);
  assert.match(dialogs, /id="deploy-lockfile"/);
  assert.match(app, /function setDeployStep\(step\)/);
  assert.match(app, /function closeDeployDialog\(\)/);
  assert.match(app, /collectDeployEnvironmentVariables/);
  assert.match(app, /deploy-configuration/);
  assert.match(compat, /project-action-divider/);
  assert.match(compat, /project-card\.menu-open/);
  assert.match(compat, /not\(\.env-sensitivity\)/);
  assert.match(compat, /deploy-env-row--new \{ grid-template-columns: 180px minmax\(0, 1fr\) 28px 28px/);
  assert.match(compat, /body\[data-shell="dashboard"\] \.app \{\s*grid-template-rows: var\(--topbar-h\) minmax\(0, 1fr\);\s*height: 100dvh;/);
  assert.match(compat, /body\[data-shell="dashboard"\] \.main,\s*body\[data-shell="dashboard"\] \.sidebar \{\s*min-height: 0;/);
  assert.match(compat, /body\[data-shell="dashboard"\] \.main \{ overflow: visible; \}/);
  assert.doesNotMatch(css, /Dark workspace/);
  assert.match(layout, /name="color-scheme" content="light"/);
  assert.match(layout, /\/ui\/v2-source\.css/);
});
