import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('..', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('project list keeps technical settings behind details and protects deletion by exact name', async () => {
  const [app, dialogs, css, compat, source, layout, sidebar, repository, icons, projects] = await Promise.all([
    read('public/ui/app.js'),
    read('views/partials/dialogs.html'),
    read('public/ui/admin.css'),
    read('public/ui/v2-compat.css'),
    read('public/ui/v2-source.css'),
    read('views/layout.html'),
    read('views/partials/sidebar.html'),
    read('views/pages/projects-new-repository.html'),
    read('views/partials/icons.html'),
    read('views/pages/projects.html')
  ]);

  assert.match(app, /project-details/);
  assert.match(app, /project-actions-menu/);
  assert.match(app, /projectActionMenuPlacement/);
  assert.match(app, /positionProjectActionMenu/);
  assert.match(app, /opens-upward/);
  assert.match(app, /shouldOfferManualSync/);
  assert.match(app, /project-manual-sync/);
  assert.match(app, /details\.project-actions-menu\[open\]/);
  assert.match(app, /event\.target\.closest\('\.project-actions-menu'\)/);
  assert.match(app, /Sync latest/);
  assert.match(app, /function syncExistingProject\(project, button\)/);
  assert.match(app, /function shortGitCommit\(revision\)/);
  assert.match(app, /function publicRepositoryUrl\(repository\)/);
  assert.match(app, /function projectCommitUrl\(repository, revision\)/);
  assert.match(app, /projectCommitReference\(project, deployedRevision, 'card-version project-commit-link'/);
  assert.match(app, /projectCommitReference\(project, sync\.revision, 'project-commit-link'/);
  assert.match(app, /repository\.href = repositoryUrl/);
  assert.match(app, /const activeRelease = deployment\.activeReleaseId/);
  assert.match(app, /release\.id === deployment\.activeReleaseId/);
  assert.match(app, /const deployedRevision = activeRelease\?\.revision \|\| null/);
  assert.match(app, /New commit/);
  assert.match(app, /sync\.revision/);
  assert.match(app, /function openNotificationHookDialog\(project\)/);
  assert.match(app, /function configureAutoSync\(project, button\)/);
  assert.match(app, /ตรวจ Git ทุก 5 นาที/);
  assert.match(app, /api\/projects\/\$\{encodeURIComponent\(project\.slug\)\}\/auto-sync/);
  assert.match(app, /function projectDisplayStatus\(project\)/);
  assert.match(app, /Ready to release/);
  assert.match(app, /Needs attention/);
  assert.doesNotMatch(app, /row\.title = sync\.detail/);
  assert.match(app, /project-notification-hook-form/);
  assert.doesNotMatch(app, /settings\?project=/);
  assert.match(app, /domain\.target = '_blank'/);
  assert.match(app, /domain\.rel = 'noopener noreferrer'/);
  assert.match(app, /input\.value !== project\.name/);
  assert.match(dialogs, /id="project-delete-dialog"/);
  assert.match(dialogs, /id="notification-hook-dialog"/);
  assert.doesNotMatch(dialogs, /auto-sync-secret/);
  assert.match(dialogs, /id="project-notification-hook-list"/);
  assert.match(dialogs, /id="project-delete-confirmation"/);
  assert.match(dialogs, /class="modal drawer deploy-drawer"/);
  assert.match(dialogs, /data-deploy-step="1"/);
  assert.match(dialogs, /data-deploy-step="2"/);
  assert.match(dialogs, /data-deploy-step="3"/);
  assert.match(dialogs, /id="deploy-environment-rows"/);
  assert.match(dialogs, /id="deploy-add-variable"/);
  assert.match(dialogs, /id="deploy-package-manager"/);
  assert.match(dialogs, /id="deploy-lockfile"/);
  assert.match(dialogs, /id="deployment-log-output"/);
  assert.match(app, /function setDeployStep\(step\)/);
  assert.match(app, /function closeDeployDialog\(\)/);
  assert.match(app, /collectDeployEnvironmentVariables/);
  assert.match(app, /deploy-configuration/);
  assert.match(compat, /project-action-divider/);
  assert.match(compat, /project-actions-menu\.opens-upward \.project-action-list/);
  assert.match(source, /\.project-new-commit/);
  assert.match(compat, /project-card\.menu-open/);
  assert.match(compat, /body\[data-shell="dashboard"\] \.app \{\s*grid-template-rows: var\(--topbar-h\) minmax\(0, 1fr\);\s*height: 100dvh;/);
  assert.match(compat, /body\[data-shell="dashboard"\] \.main,\s*body\[data-shell="dashboard"\] \.sidebar \{\s*min-height: 0;/);
  assert.match(compat, /body\[data-shell="dashboard"\] \.main \{ overflow: visible; \}/);
  assert.match(app, /SIDEBAR_COLLAPSED_KEY/);
  assert.match(app, /function setSidebarCollapsed\(collapsed\)/);
  assert.match(layout, /id="sidebar-toggle"/);
  assert.match(compat, /body\.sidebar-collapsed \.app \{ --sidebar-w: 68px; \}/);
  assert.match(compat, /:not\(\.runtime-menu-option\)/);
  assert.match(compat, /\.runtime-menu-option \{ width: 100%; border: 0;/);
  assert.match(compat, /\.runtime-logo \{ display: block; width: 23px; height: 23px;/);
  assert.match(compat, /\.project-list \{ display: grid; grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/);
  assert.match(compat, /\.deployment-log-output/);
  assert.match(app, /function runtimeLogo\(name\)/);
  assert.match(app, /function renderDeploymentLog\(events, failureLog\)/);
  assert.match(repository, /\/ui\/runtime-logos\/nodejs\.svg/);
  assert.match(repository, /\/ui\/runtime-logos\/bun\.svg/);
  assert.match(repository, /\/ui\/runtime-logos\/docker\.svg/);
  assert.doesNotMatch(repository, /#icon-(node|bun|docker)/);
  assert.doesNotMatch(icons, /id="icon-(node|bun|docker)"/);
  assert.match(repository, /id="repository-connection-note"/);
  assert.match(repository, /class="project-config-layout"/);
  assert.match(repository, /class="project-config-column project-source-column"/);
  assert.match(repository, /class="project-config-column project-settings-column"/);
  assert.match(repository, /id="project-source-name"/);
  assert.match(repository, /id="project-source-meta"/);
  assert.match(repository, /id="project-source-edit"/);
  assert.match(app, /\$\('#project-source-edit'\)\.href = flowPath\('identity'\)/);
  assert.match(app, /\$\('#project-source-name'\)\.textContent = draft\.name/);
  assert.match(app, /\$\('#project-source-meta'\)\.textContent = sourceMeta\.join/);
  assert.match(compat, /\.project-config-layout \{ display: grid; grid-template-columns: minmax\(300px, \.86fr\) minmax\(0, 1\.14fr\); \}/);
  assert.match(compat, /@media \(max-width: 900px\) \{[\s\S]*\.project-config-layout \{ grid-template-columns: 1fr; \}/);
  assert.doesNotMatch(repository, /name="protocol"/);
  assert.ok(repository.indexOf('id="https-credential"') < repository.indexOf('id="project-directory"'));
  assert.match(repository, /id="health-check-details"/);
  assert.match(repository, /สถานะ 2xx หรือ 3xx/);
  assert.match(app, /function repositoryProtocol\(repository/);
  assert.match(sidebar, /title="Projects"/);
  assert.doesNotMatch(css, /Dark workspace/);
  assert.match(layout, /name="color-scheme" content="light dark"/);
  assert.match(layout, /\/ui\/v2-source\.css/);
  assert.match(app, /const PROJECT_GROUPING_KEY = 'hostmgr\.projectGrouping'/);
  assert.match(app, /function projectGrouping\(\)/);
  assert.match(app, /function setProjectGrouping\(grouping\)/);
  assert.match(app, /if \(grouping === 'all'\)/);
  assert.match(app, /data-project-grouping/);
  assert.match(projects, /data-project-grouping="grouped"/);
  assert.match(projects, /data-project-grouping="all"/);
  assert.match(compat, /\.project-view-toggle/);
  assert.match(compat, /\.card-meta \{ align-items: center; flex-wrap: wrap; row-gap: 7px; \}/);
  assert.match(compat, /project-commit-link:hover, \.project-card \.project-repository-link:hover/);
});

test('standard modals stay within the viewport and keep dark inputs readable', async () => {
  const [app, dialogs, compat] = await Promise.all([
    read('public/ui/app.js'),
    read('views/partials/dialogs.html'),
    read('public/ui/v2-compat.css')
  ]);

  assert.match(compat, /dialog\.modal:not\(\.deploy-drawer\) \{[\s\S]*max-height: calc\(100dvh - 32px\);[\s\S]*width: min\(680px, calc\(100vw - 32px\)\);/);
  assert.match(compat, /\.modal-form:not\(\.deploy-drawer-form\) \{ display: grid; grid-template-rows: auto minmax\(0, 1fr\) auto;/);
  assert.match(compat, /\.modal-body \{ min-height: 0; overflow: auto;/);
  assert.match(compat, /\.modal-close \{[\s\S]*background: transparent !important;[\s\S]*height: 34px;/);
  assert.match(compat, /html\[data-theme="dark"\] dialog\.modal input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\):not\(\[type="file"\]\),[\s\S]*color: #f8fafc;/);
  assert.match(compat, /\.dialog-error \{[\s\S]*border: 1px solid rgba\(239, 68, 68, \.38\);/);
  assert.match(app, /function showDialogError\(dialog, message\)/);
  assert.match(app, /\$\$\('dialog\[open\]'\)\.at\(-1\)/);
  assert.match(app, /function bindDialogDismissals\(\)/);
  assert.match(app, /dialog\.addEventListener\('cancel'/);
  assert.match(app, /await closeDeployDialog\(\);/);
  assert.match(app, /function showDialog\(dialog\)/);
  assert.match(dialogs, /id="deploy-close"[^>]*data-dialog-close/);
  assert.match(dialogs, /id="deployment-log-dismiss"[^>]*data-dialog-close/);
  assert.match(dialogs, /id="domain-cancel"[^>]*data-dialog-close/);
  assert.match(dialogs, /id="notification-hook-cancel"[^>]*data-dialog-close/);
});
