import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('..', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('project list keeps technical settings behind details and protects deletion by exact name', async () => {
  const [app, dialogs, css, layout, sidebar, repository, icons, projects] = await Promise.all([
    read('public/ui/app.js'),
    read('views/partials/dialogs.html'),
    read('public/ui/app.css'),
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
  assert.match(app, /hasNewerSyncedRevision/);
  assert.match(app, /project-manual-sync/);
  assert.match(app, /function startProjectDeploy\(project, button\)/);
  assert.match(app, /function confirmChoice\(/);
  assert.match(app, /confirmAction\('สร้าง release ใหม่'/);
  assert.match(app, /element\('button', 'secondary', 'แก้ไข ENV และ deploy'\)/);
  assert.doesNotMatch(app, /rejectLabel: 'ไม่ต้อง'/);
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
  assert.match(app, /เมื่อ sync Git จะสร้าง release อัตโนมัติ/);
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
  assert.match(dialogs, /id="confirm-reject"/);
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

  // The visible card row owns Sync latest and Logs; the overflow menu must not repeat them.
  assert.match(app, /element\('button', 'btn btn-ghost btn-sm project-manual-sync', 'Sync latest'\)/);
  assert.doesNotMatch(app, /element\('button', 'secondary', 'Sync latest'\)/);
  assert.doesNotMatch(app, /element\('a', 'secondary button', 'Logs'\)/);

  // One stylesheet carries the whole visual system.
  assert.match(css, /project-action-divider/);
  assert.match(css, /\.project-actions-menu\.opens-upward \.project-action-list/);
  assert.match(css, /\.project-new-commit/);
  assert.match(css, /\.project-card\.menu-open/);
  assert.match(css, /body\[data-shell="dashboard"\] \.app \{ height: 100dvh; min-height: 0; \}/);
  assert.match(css, /body\[data-shell="dashboard"\] \.main,\s*body\[data-shell="dashboard"\] \.sidebar \{ min-height: 0;/);
  assert.match(css, /body\[data-shell="dashboard"\] \.main \{ overflow: visible; \}/);
  assert.match(app, /SIDEBAR_COLLAPSED_KEY/);
  assert.match(app, /function setSidebarCollapsed\(collapsed\)/);
  assert.match(sidebar, /id="sidebar-toggle"/);
  assert.match(css, /body\.sidebar-collapsed \.app \{ --sidebar-w: 64px; \}/);
  assert.match(css, /\.runtime-menu-option \{[\s\S]*?width: 100%;[\s\S]*?border: 0;[\s\S]*?background: transparent;/);
  assert.match(css, /\.runtime-logo \{ display: block; width: 22px; height: 22px;/);
  assert.match(css, /\.project-list \{ display: grid; grid-template-columns: repeat\(3, minmax\(0, 1fr\)\); gap: 14px; \}/);
  assert.match(css, /\.project-card \{[\s\S]*?grid-template-areas: "title" "source" "domain" "details" "actions";/);
  assert.match(app, /const source = element\('div', 'project-source'\);/);
  assert.match(app, /secondary\.append\(stateLabel, domains\);/);
  assert.match(css, /\.deployment-log-output/);
  assert.match(app, /function runtimeLogo\(name\)/);
  assert.match(app, /function renderDeploymentLog\(events, failureLog, failure\)/);
  assert.match(repository, /\/ui\/runtime-logos\/nodejs\.svg/);
  assert.match(repository, /\/ui\/runtime-logos\/bun\.svg/);
  assert.match(repository, /\/ui\/runtime-logos\/php\.svg/);
  assert.match(repository, /\/ui\/runtime-logos\/docker\.svg/);
  assert.match(repository, /id="framework-menu"/);
  assert.match(repository, /id="framework-menu-options"/);
  assert.doesNotMatch(repository, /data-runtime-option="(next|nuxt|express|laravel|django)"/);
  assert.match(app, /function setDetectedFramework\(/);
  assert.match(app, /function projectFrameworkIcon\(project\)/);
  assert.match(app, /cardTitle\.append\([\s\S]*runtimeLogo\(projectFrameworkIcon\(project\)\)/);
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
  assert.match(css, /\.project-config-layout \{ display: grid; grid-template-columns: minmax\(300px, \.86fr\) minmax\(0, 1\.14fr\); \}/);
  assert.match(css, /@media \(max-width: 900px\) \{[\s\S]*\.project-config-layout \{ grid-template-columns: 1fr; \}/);
  assert.doesNotMatch(repository, /name="protocol"/);
  assert.ok(repository.indexOf('id="https-credential"') < repository.indexOf('id="project-directory"'));
  assert.match(repository, /id="health-check-details"/);
  assert.match(repository, /สถานะ 2xx หรือ 3xx/);
  assert.match(app, /function repositoryProtocol\(repository/);
  assert.match(sidebar, /title="Projects"/);
  assert.match(layout, /name="color-scheme" content="light dark"/);
  assert.match(layout, /prefers-color-scheme: light/);
  assert.match(layout, /setAttribute\('data-theme', theme\)/);
  assert.match(layout, /<link rel="stylesheet" href="\/ui\/app\.css">/);
  assert.equal(layout.match(/<link rel="stylesheet"/g).length, 1, 'the layout loads exactly one stylesheet');
  assert.doesNotMatch(layout, /admin\.css|v2-source|v2-compat|fonts\.googleapis/);
  assert.doesNotMatch(css, /v2|compat|legacy|bridge/i);
  assert.match(app, /const PROJECT_ORG_KEY = 'hostmgr\.selectedOrganization'/);
  assert.match(app, /function selectedOrganization\(\)/);
  assert.match(app, /function setSelectedOrganization\(name\)/);
  assert.match(app, /if \(selectedOrg\)/);
  assert.match(app, /\$\('#org-switcher'\)/);
  assert.match(projects, /id="org-switcher"/);
  assert.match(projects, /id="org-switcher-options"/);
  assert.match(css, /\.org-switcher \{ position: relative;/);
  assert.match(css, /\.page-loader \{/);
  assert.match(css, /@keyframes page-spin/);
  assert.match(layout, /id="page-loader"/);
  assert.match(app, /function setPageLoading\(loading\)/);
  assert.match(app, /function applyDetectedRuntimeCandidate\(runtime\)/);
  assert.match(app, /state\.runtimeDetection = detection/);
  assert.match(css, /\.card-meta \{ display: flex; align-items: center; gap: 4px 12px; flex-wrap: wrap;/);
  assert.match(css, /\.project-commit-link:hover, \.project-repository-link:hover/);
});

test('standard modals stay within the viewport and keep dark inputs readable', async () => {
  const [app, dialogs, css] = await Promise.all([
    read('public/ui/app.js'),
    read('views/partials/dialogs.html'),
    read('public/ui/app.css')
  ]);

  assert.match(css, /dialog\.modal \{[\s\S]*?width: min\(640px, calc\(100vw - 32px\)\);[\s\S]*?max-height: calc\(100dvh - 32px\);/);
  assert.match(css, /:root \{\s*color-scheme: dark;/);
  assert.match(css, /html\[data-theme="light"\] \{\s*color-scheme: light;/);
  assert.match(css, /input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\):not\(\[type="file"\]\):not\(\[type="hidden"\]\),\s*select,\s*textarea \{[\s\S]*?background: var\(--bg\);[\s\S]*?color: var\(--text\);/);
  assert.match(css, /option \{ background: var\(--surface\); color: var\(--text\); \}/);
  assert.match(css, /\.modal-form:not\(\.deploy-drawer-form\) \{ display: grid; grid-template-rows: auto minmax\(0, 1fr\) auto;/);
  assert.match(css, /\.modal-body \{[^}]*min-height: 0;[^}]*overflow: auto;/);
  assert.match(css, /\.close-btn, \.btn-icon, \.modal-close \{[\s\S]*?background: transparent;/);
  assert.match(css, /:root \{[\s\S]*?--surface: #111418;[\s\S]*?--text: #e6e8ec;/);
  assert.match(css, /html\[data-theme="light"\] \{[\s\S]*?--surface: #ffffff;[\s\S]*?--text: #111318;/);
  assert.match(css, /\.dialog-error \{[\s\S]*?border: 1px solid color-mix\(in srgb, var\(--danger\) 40%, transparent\);/);
  assert.match(app, /function showDialogError\(dialog, message\)/);
  assert.match(app, /\$\$\('dialog\[open\]'\)\.at\(-1\)/);
  assert.match(app, /function bindDialogDismissals\(\)/);
  assert.match(app, /bindDialogDismissals as bindModalDismissals/);
  assert.match(app, /bindModalDismissals\(\{[\s\S]*dialogs: \$\$\('dialog\.modal'\),/);
  assert.match(app, /await closeDeployDialog\(\);/);
  assert.match(app, /function showDialog\(dialog\)/);
  assert.match(dialogs, /id="deploy-close"[^>]*data-dialog-close/);
  assert.match(dialogs, /id="deployment-log-dismiss"[^>]*data-dialog-close/);
  assert.match(dialogs, /id="domain-cancel"[^>]*data-dialog-close/);
  assert.match(dialogs, /id="notification-hook-cancel"[^>]*data-dialog-close/);
});

test('forms guard against double submission and every shell keeps a page loader', async () => {
  const [app, identity, auth, mailLayout, layout] = await Promise.all([
    read('public/ui/app.js'),
    read('views/pages/projects-new.html'),
    read('views/partials/auth-views.html'),
    read('views/mail-layout.html'),
    read('views/layout.html')
  ]);
  assert.match(identity, /id="org-menu"/);
  assert.match(identity, /id="org-create-input"/);
  assert.match(identity, /id="project-organization"[^>]*type="hidden"/);
  assert.match(app, /function setProjectOrganization\(name\)/);
  assert.match(app, /function renderOrganizationMenu\(\)/);
  assert.match(app, /selectedOrganization\(\) \|\| projectOrganizations\(\)\[0\] \|\| 'Personal'/);
  assert.match(app, /function submitButton\(event\)/);
  assert.match(app, /if \(button\.disabled\) return undefined;/);
  for (const form of ['login-form', 'bootstrap-form', 'database-form', 'git-form', 'credential-form', 'password-change-form', 'monitor-token-form', 'project-notification-hook-form']) {
    const handler = app.slice(app.indexOf(`$('#${form}')?.addEventListener('submit'`));
    assert.match(handler.slice(0, 400), /withBusy\(submitButton\(event\)/, `${form} submit is wrapped in withBusy`);
  }
  assert.match(auth, /auth-panel-loading/);
  assert.match(auth, /page-loader-spinner/);
  assert.match(layout, /id="page-loader"/);
  assert.match(mailLayout, /id="page-loader"/);
  assert.match(mailLayout, /<link rel="stylesheet" href="\/ui\/app\.css">/);
  assert.equal(mailLayout.match(/<link rel="stylesheet"/g).length, 1);
  assert.match(app, /setPageLoading\(true\)/);
  assert.match(app, /setPageLoading\(false\)/);
});
