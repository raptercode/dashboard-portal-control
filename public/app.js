import { pageForPathname, pathnameForPage } from '/router.js';

const state = { csrfToken: null, mode: null, doctor: null, git: null, projects: [], credentials: [], audit: [], softwareUpdate: null, wizardStep: 1, slugManual: false, editingProject: null, deployProject: null, domainProject: null, domainDraftHosts: [], domainStatuses: {}, domainView: 'list', domainStep: 1, domainCheck: null };
const wizardPhases = [
  { title: 'ตั้งชื่อและจัดกลุ่ม', next: 'ขั้นถัดไป: เชื่อมต่อ repository' },
  { title: 'เชื่อมต่อ repository', next: 'ขั้นถัดไป: ตรวจสอบก่อน Sync' },
  { title: 'ตรวจสอบก่อน Sync', next: 'พร้อมบันทึกและ Sync source' },
];
const $ = (selector) => document.querySelector(selector);
const loginView = $('#login-view');
const dashboardView = $('#dashboard-view');
const loginError = $('#login-error');
const confirmDialog = $('#confirm-dialog');
const projectDialog = $('#project-dialog');
const deployDialog = $('#deploy-dialog');
const domainDialog = $('#domain-dialog');

removePasswordFromUrl();

$('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  loginError.textContent = '';
  try {
    const result = await api('/api/login', { method: 'POST', body: { password: new FormData(form).get('password') } });
    state.csrfToken = result.csrfToken;
    state.mode = result.mode;
    form.reset();
    await showDashboard();
  } catch (error) { loginError.textContent = error.message; }
});

$('#logout').addEventListener('click', async () => {
  try { await api('/api/logout', { method: 'POST', body: {} }); } catch { /* Session can have expired. */ }
  state.csrfToken = null;
  dashboardView.hidden = true;
  loginView.hidden = false;
  $('#password').focus();
});
$('#refresh').addEventListener('click', () => refresh().then(() => toast('อัปเดตสถานะล่าสุดแล้ว')).catch(showError));
$('#git-form').addEventListener('submit', (event) => saveGitConfig(event).catch(showError));
$('#credential-form').addEventListener('submit', (event) => saveCredential(event).catch(showError));
$('#project-form').addEventListener('submit', (event) => syncProject(event).catch(showError));
$('#deploy-form').addEventListener('submit', (event) => submitDeploy(event).catch(showError));
$('#domain-form').addEventListener('submit', (event) => confirmAddDomain(event).catch(showError));
$('#create-project').addEventListener('click', openProjectWizard);
projectDialog.querySelector('.modal-close').addEventListener('click', () => projectDialog.close());
projectDialog.addEventListener('close', () => { state.editingProject = null; });
$('#fetch-branches').addEventListener('click', () => fetchBranches().catch(showError));
$('#deploy-close').addEventListener('click', () => deployDialog.close());
$('#deploy-cancel').addEventListener('click', () => deployDialog.close());
$('#domain-close').addEventListener('click', () => closeDomainDialog());
$('#domain-cancel').addEventListener('click', () => closeDomainDialog());
$('#domain-add-start').addEventListener('click', () => setDomainView('add'));
$('#domain-recheck').addEventListener('click', () => checkDomainInput().catch(showError));
$('#domain-back').addEventListener('click', () => {
  if (state.domainView === 'add' && state.domainStep === 2) setDomainStep(1);
  else setDomainView('list');
});
$('#domain-check').addEventListener('click', () => checkDomainInput().catch(showError));
$('#domain-hostname').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    checkDomainInput().catch(showError);
  }
});
$('#wizard-next').addEventListener('click', nextWizardStep);
$('#wizard-back').addEventListener('click', () => setWizardStep(state.wizardStep - 1));
document.querySelectorAll('[data-wizard-dot]').forEach((dot) => dot.addEventListener('click', () => {
  const target = Number(dot.dataset.wizardDot);
  if (target < state.wizardStep) setWizardStep(target);
}));
$('#project-search').addEventListener('input', renderProjects);
$('#mobile-menu').addEventListener('click', toggleMobileMenu);
$('#copy-update-command').addEventListener('click', copyUpdateCommand);
$('#project-name').addEventListener('input', () => {
  if (!state.slugManual) $('#project-slug').value = slugify($('#project-name').value);
  updateWizardPreview();
});
$('#project-slug').addEventListener('input', () => { state.slugManual = true; updateWizardPreview(); });
$('#project-form').addEventListener('input', updateWizardPreview);
$('#project-form').addEventListener('change', updateWizardPreview);
document.querySelectorAll('input[name="protocol"]').forEach((input) => input.addEventListener('change', () => { toggleCredentialReference(); updateWizardPreview(); if (state.wizardStep === 3) renderProjectReview(); }));
document.querySelectorAll('[data-page-target]').forEach((button) => button.addEventListener('click', (event) => {
  event.preventDefault();
  navigate(button.dataset.pageTarget);
}));
window.addEventListener('popstate', () => navigate(pageForPathname(window.location.pathname), { updateUrl: false }));

async function api(path, options = {}) {
  const headers = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (state.csrfToken && options.method && options.method !== 'GET') headers['X-CSRF-Token'] = state.csrfToken;
  const response = await fetch(path, { ...options, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'คำขอล้มเหลว');
  return data;
}

async function showDashboard() {
  loginView.hidden = true;
  dashboardView.hidden = false;
  await refresh();
  navigate(pageForPathname(window.location.pathname), { updateUrl: false, scroll: false });
}

async function refresh() {
  const [doctor, audit, git, projectPayload, credentialPayload, softwareUpdate] = await Promise.all([
    api('/api/doctor'), api('/api/audit'), api('/api/git-config'), api('/api/projects'), api('/api/credentials'), api('/api/software-update'),
  ]);
  Object.assign(state, { doctor, audit: audit.events, git, projects: projectPayload.projects, credentials: credentialPayload.credentials, vaultReady: credentialPayload.vaultReady, softwareUpdate, mode: doctor.mode });
  renderShell();
  renderOverview();
  renderTools(doctor.tools);
  renderProjects();
  renderCredentials();
  renderAudit();
  renderSoftwareUpdate();
  $('#git-name').value = git.identity?.name || '';
  $('#git-email').value = git.identity?.email || '';
  toggleCredentialReference();
}

function renderShell() {
  const demo = state.mode === 'demo';
  $('#mode-badge').textContent = demo ? 'SANDBOX' : 'HOST';
  $('#settings-mode').textContent = demo ? 'SANDBOX' : 'HOST';
  $('#mode-description').textContent = demo
    ? 'กำลังใช้ sandbox: การติดตั้งถูกจำลองและไม่แก้ไข Docker host'
    : 'กำลังเชื่อมต่อ host: การกระทำที่ได้รับอนุญาตจะเรียกผ่าน privileged helper';
  $('#sandbox-notice').hidden = !demo;
}

function renderSoftwareUpdate() {
  const update = state.softwareUpdate;
  const root = $('#software-update');
  const command = $('#update-command');
  const copy = $('#copy-update-command');
  if (!update?.configured) {
    root.replaceChildren(
      element('h2', '', 'Software updates'),
      element('p', '', 'ยังไม่ได้เชื่อมช่องทาง release ที่เซ็นลายเซ็นไว้ ระบบจะไม่ดาวน์โหลดหรืออัปเดตอะไรเอง')
    );
    command.textContent = 'sudo dashboard-portal configure-update --manifest=https://… --public-key=/path/to/public.pem';
    copy.disabled = false;
    return;
  }
  const status = update.status === 'available' ? 'มีเวอร์ชันใหม่พร้อมติดตั้ง' : update.status === 'current' ? 'ใช้งานเวอร์ชันล่าสุดแล้ว' : update.status === 'ahead' ? 'เครื่องนี้ใหม่กว่า release channel' : 'ตรวจสอบ release ไม่สำเร็จ';
  const detail = update.status === 'available'
    ? `v${update.update.version} พร้อมแล้ว — ${update.update.notes || 'ไม่มีหมายเหตุเพิ่มเติม'}`
    : update.status === 'current'
      ? `v${update.currentVersion} · channel ${update.channel}`
      : update.issue || `v${update.currentVersion} · channel ${update.channel}`;
  root.replaceChildren(
    element('h2', '', 'Software updates'),
    element('p', '', status),
    element('small', 'update-detail', detail)
  );
  command.textContent = `sudo dashboard-portal update --channel=${update.channel}`;
  copy.disabled = false;
}

async function copyUpdateCommand() {
  const value = $('#update-command').textContent;
  try {
    await navigator.clipboard.writeText(value);
    toast('คัดลอกคำสั่ง SSH แล้ว');
  } catch { toast('คัดลอกคำสั่งไม่ได้ กรุณาเลือกข้อความด้านล่าง', true); }
}

function renderOverview() {
  const { host, supportedNodeMajor, tools } = state.doctor;
  $('#host-name').textContent = host.hostname;
  $('#host-platform').textContent = `${host.platform} · ${host.arch}`;
  $('#node-version').textContent = `v${supportedNodeMajor}`;
  $('#uptime').textContent = duration(host.uptimeSeconds);
  $('#memory').textContent = `${Math.round(host.memoryBytes / 1024 / 1024 / 1024)} GB memory`;
  const checklist = [
    { key: 'tools', title: 'ติดตั้งเครื่องมือที่จำเป็น', detail: missingTools(tools).length ? `ยังขาด ${missingTools(tools).map((tool) => tool.label).join(', ')}` : 'เครื่องมือที่จำเป็นพร้อมแล้ว', ready: !missingTools(tools).length, page: 'setup' },
    { key: 'git', title: 'ตั้งค่า Git identity', detail: state.git.identity ? state.git.identity.email : 'เพิ่มชื่อและอีเมลสำหรับ commit', ready: Boolean(state.git.identity), page: 'setup' },
    { key: 'project', title: 'เพิ่มโปรเจคแรก', detail: state.projects.length ? `${state.projects.length} โปรเจคที่ตั้งค่าแล้ว` : 'เชื่อมต่อ repository และเลือก branch', ready: state.projects.length > 0, page: 'projects' },
    { key: 'environment', title: 'ตั้งค่า secrets ก่อน deploy', detail: state.projects.some((project) => project.environment?.keys?.length) ? 'มี project secrets ที่บันทึกแล้ว' : 'กดสร้าง release แล้วใส่ `.env` ของโปรเจคก่อน deploy', ready: state.projects.some((project) => project.environment?.keys?.length), page: 'projects' },
  ];
  $('#readiness-count').textContent = `${checklist.filter((item) => item.ready).length}/${checklist.length} พร้อม`;
  const root = $('#readiness');
  root.replaceChildren(...checklist.map((item) => {
    const row = element('article', 'readiness-item');
    row.append(element('span', `readiness-icon${item.ready ? '' : ' pending'}`, item.ready ? '✓' : '•'));
    const copy = element('div');
    copy.append(element('strong', '', item.title), element('small', '', item.detail));
    const chip = element('span', `status-chip ${item.ready ? 'ready' : 'muted'}`, item.ready ? 'พร้อม' : 'ต้องทำ');
    row.append(copy, chip);
    row.addEventListener('click', () => !item.ready && navigate(item.page));
    return row;
  }));
  const next = checklist.find((item) => !item.ready);
  $('#next-action-title').textContent = next ? next.title : 'ตั้งค่าพื้นฐานพร้อมแล้ว';
  $('#next-action-copy').textContent = next ? next.detail : 'ขั้นต่อไปคือ workflow deploy ซึ่งยังต้องเปิดใช้งานจาก backend';
  const button = $('#next-action-button');
  button.hidden = !next;
  if (next) { button.textContent = 'ไปทำต่อ'; button.onclick = () => navigate(next.page); }
}

function renderTools(tools) {
  const root = $('#tools');
  root.replaceChildren(...tools.map((tool) => {
    const card = element('article', 'tool-card');
    const head = element('header');
    const copy = element('div');
    copy.append(element('h3', '', tool.label), element('small', '', tool.required ? 'จำเป็น' : 'ทางเลือก'));
    head.append(copy, statusChip(tool.status === 'Installed' ? 'พร้อม' : 'ยังไม่ติดตั้ง', tool.status === 'Installed' ? 'ready' : 'muted'));
    const footer = element('footer');
    footer.append(element('small', '', tool.version || 'ไม่พบในระบบ'));
    if (tool.status !== 'Installed') {
      const install = element('button', '', 'ติดตั้ง');
      install.type = 'button';
      install.addEventListener('click', () => installTool(tool.id, install));
      footer.append(install);
    }
    card.append(head, element('p', '', tool.purpose), footer);
    return card;
  }));
}

function renderProjects() {
  const root = $('#projects');
  const query = $('#project-search').value.trim().toLocaleLowerCase('th-TH');
  const projects = state.projects.filter((project) => [project.name, project.slug, project.organization, project.repository, project.branch].join(' ').toLocaleLowerCase('th-TH').includes(query));
  $('#project-count').textContent = `${projects.length} โปรเจค`;
  if (!projects.length) {
    root.replaceChildren(element('div', 'empty-state', query ? 'ไม่พบโปรเจคที่ตรงกับคำค้นหา' : 'ยังไม่มีโปรเจค — เริ่มเชื่อมต่อ repository แรกของคุณ'));
    return;
  }
  const groups = new Map();
  projects.forEach((project) => {
    const name = project.organization || 'Unorganized';
    groups.set(name, [...(groups.get(name) || []), project]);
  });
  root.replaceChildren(...[...groups.entries()].flatMap(([organization, items]) => {
    const heading = element('h2', 'organization', organization);
    const list = element('section', 'project-list');
    list.setAttribute('aria-label', organization);
    list.append(...items.map(projectCard));
    return [heading, list];
  }));
}

function projectCard(project) {
  const sync = project.sync || { status: 'unknown', detail: 'ยังไม่มีข้อมูลการ sync' };
  const deployment = project.deployment || { state: 'idle', activeReleaseId: null, previousReleaseId: null, releases: [] };
  const row = element('article', 'project-row');
  const copy = element('div');
  const title = element('h3', '', project.name);
  const meta = element('p', 'project-meta');
  meta.append(element('b', '', project.slug), document.createTextNode(` ${project.branch} · ${project.protocol.toUpperCase()} · port ${project.port}`));
  const repository = element('p', 'project-meta', project.repository);
  if (project.environment?.keys?.length) repository.append(document.createTextNode(` · .env ${project.environment.keys.length} keys`));
  const scripts = element('p', 'project-meta', `npm: ${project.buildScript === null ? 'no build step' : `build=${project.buildScript || 'build'}`} · start=${project.startScript || 'start'}`);
  const directory = element('p', 'project-meta', `directory: ${project.directory || '/'}`);
  const domains = element('p', 'project-meta', project.domains?.hosts?.length ? `domains: ${project.domains.hosts.join(', ')}` : 'domains: not configured');
  copy.append(title, meta, repository, directory, scripts, domains);
  const badges = element('div', 'project-badges');
  const normalized = sync.status === 'synced' ? 'ready' : (sync.status === 'failed' || sync.status === 'needs_ssh_key' ? 'needs' : 'muted');
  const label = sync.status === 'synced' ? 'source synced' : sync.status === 'needs_ssh_key' ? 'ต้องมี SSH key' : sync.status === 'failed' ? 'sync ล้มเหลว' : 'ยังไม่ sync';
  badges.append(statusChip(label, normalized));
  const releaseLabel = deployment.state === 'active' ? 'release active' : deployment.state === 'awaiting_activation' ? 'รอ activate บน host' : deployment.state === 'failed' ? 'deploy ล้มเหลว' : 'ยังไม่ deploy';
  badges.append(statusChip(releaseLabel, deployment.state === 'active' ? 'ready' : deployment.state === 'failed' ? 'needs' : 'muted'));
  const actions = element('div', 'project-actions');
  const deploy = element('button', 'secondary', 'สร้าง release');
  deploy.type = 'button';
  deploy.disabled = sync.status !== 'synced';
  deploy.title = deploy.disabled ? 'ต้อง sync source สำเร็จก่อน' : 'ตั้งค่า secrets แล้วสร้าง candidate release';
  deploy.addEventListener('click', () => openDeployDialog(project));
  actions.append(deploy);
  const domain = element('button', 'secondary', 'Domains');
  domain.type = 'button';
  domain.addEventListener('click', () => openDomainDialog(project));
  actions.append(domain);
  const edit = element('button', 'secondary', 'แก้ไข');
  edit.type = 'button';
  edit.addEventListener('click', () => openProjectWizard(project));
  actions.append(edit);
  const remove = element('button', 'secondary danger', 'ลบ');
  remove.type = 'button';
  remove.addEventListener('click', () => deleteProject(project, remove));
  actions.append(remove);
  if (deployment.previousReleaseId) {
    const rollback = element('button', 'secondary', 'Rollback');
    rollback.type = 'button';
    rollback.addEventListener('click', () => rollbackProject(project, rollback));
    actions.append(rollback);
  }
  const side = element('div', 'project-side');
  side.append(badges, actions);
  row.append(copy, side);
  row.title = sync.detail || '';
  return row;
}

function renderCredentials() {
  const root = $('#credentials');
  if (!state.vaultReady) {
    root.replaceChildren(element('div', 'empty-state', 'Credential vault ยังไม่พร้อม — ตั้งค่า HOSTMGR_SECRET_KEY ก่อนบันทึก token'));
    return;
  }
  if (!state.credentials.length) {
    root.replaceChildren(element('div', 'empty-state', 'ยังไม่มี credential ที่บันทึกไว้'));
    return;
  }
  root.replaceChildren(...state.credentials.map((credential) => {
    const row = element('article', 'credential-row');
    const copy = element('div');
    copy.append(element('h3', '', credential.name), element('p', '', `HTTPS token · บันทึก ${new Date(credential.createdAt).toLocaleString('th-TH')}`));
    row.append(copy, statusChip('เข้ารหัสแล้ว', 'ready'));
    return row;
  }));
  const select = $('#credential-id');
  const current = select.value;
  select.replaceChildren(new Option('Public repository — ไม่ต้องใช้ credential', ''), ...state.credentials.map((credential) => new Option(credential.name, credential.id)));
  select.value = [...select.options].some((option) => option.value === current) ? current : '';
}

function renderAudit() {
  const body = $('#audit');
  body.replaceChildren(...state.audit.map((event) => {
    const row = element('tr');
    row.append(element('td', '', new Date(event.at).toLocaleString('th-TH')), element('td', '', event.action), element('td', '', event.target || '—'), element('td', `outcome-${event.outcome}`, event.outcome));
    return row;
  }));
  if (!state.audit.length) { const row = element('tr'); const cell = element('td', '', 'ยังไม่มีกิจกรรม'); cell.colSpan = 4; row.append(cell); body.append(row); }
}

function missingTools(tools) { return tools.filter((tool) => tool.required && tool.status !== 'Installed'); }
function statusChip(text, variant) { return element('span', `status-chip ${variant}`, text); }

async function installTool(tool, button) {
  if (!await confirmInstall(tool)) return;
  button.disabled = true;
  try {
    const result = await api(`/api/tools/${tool}/install`, { method: 'POST', body: { confirm: true } });
    toast(result.result.detail);
    await refresh();
  } catch (error) { toast(error.message, true); button.disabled = false; }
}

function confirmInstall(tool) {
  $('#confirm-title').textContent = `ติดตั้ง ${tool}?`;
  $('#confirm-message').textContent = `ระบบจะเรียก allowlisted installer สำหรับ ${tool} เท่านั้น และไม่รับคำสั่ง shell อิสระจากหน้าเว็บ`;
  return new Promise((resolve) => {
    confirmDialog.addEventListener('close', () => resolve(confirmDialog.returnValue === 'confirm'), { once: true });
    confirmDialog.showModal();
    $('#confirm-accept').focus();
  });
}

async function saveGitConfig(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const result = await api('/api/git-config', { method: 'POST', body: Object.fromEntries(new FormData(form)) });
  toast(`บันทึก Git identity สำหรับ ${result.identity.email} แล้ว`);
  await refresh();
}

async function saveCredential(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const result = await api('/api/credentials', { method: 'POST', body: Object.fromEntries(new FormData(form)) });
  form.reset();
  toast(`เข้ารหัสและบันทึก ${result.credential.name} แล้ว`);
  await refresh();
}

async function syncProject(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  const result = await api('/api/projects/sync', { method: 'POST', body: data });
  projectDialog.close();
  toast(result.project.sync.detail);
  await refresh();
}

async function deleteProject(project, button) {
  const confirmed = await confirmDeployment('ลบโปรเจค?', `จะหยุด service, ลบ managed runtime และลบ source workspace ของ ${project.name} การดำเนินการนี้ย้อนกลับไม่ได้`, 'ลบโปรเจค');
  if (!confirmed) return;
  button.disabled = true;
  try {
    await api(`/api/projects/${encodeURIComponent(project.slug)}`, { method: 'DELETE', body: {} });
    toast(`ลบ ${project.name} แล้ว`);
    await refresh();
  } catch (error) { toast(error.message, true); button.disabled = false; }
}

function openDomainDialog(project) {
  state.domainProject = project;
  state.domainDraftHosts = [...(project.domains?.hosts || [])];
  state.domainStatuses = {};
  state.domainCheck = null;
  $('#domain-project-label').textContent = `${project.organization || 'Unorganized'} / ${project.name}`;
  setDomainView('list');
  domainDialog.showModal();
  refreshDomainStatuses().catch(() => {});
}

function closeDomainDialog() {
  state.domainProject = null;
  state.domainDraftHosts = [];
  state.domainStatuses = {};
  state.domainCheck = null;
  if (domainDialog.open) domainDialog.close();
}

function setDomainView(view) {
  state.domainView = view;
  const body = domainDialog.querySelector('.deploy-body');
  body.dataset.domainView = view;
  const listMode = view === 'list';
  domainDialog.querySelector('.domain-list-panel').hidden = !listMode;
  domainDialog.querySelector('.domain-list-notice').hidden = !listMode;
  domainDialog.querySelector('.domain-add-panel').hidden = listMode;
  $('#domain-add-start').hidden = !listMode;
  $('#domain-cancel').hidden = !listMode;
  $('#domain-back').hidden = listMode;
  $('#domain-check').hidden = true;
  $('#domain-submit').hidden = true;
  if (listMode) {
    state.domainStep = 1;
    state.domainCheck = null;
    $('#domain-hostname').value = '';
    renderDomainList();
    return;
  }
  setDomainStep(1);
  $('#domain-hostname').focus();
}

function setDomainStep(step) {
  state.domainStep = step;
  domainDialog.querySelectorAll('[data-domain-step]').forEach((panel) => {
    panel.hidden = Number(panel.dataset.domainStep) !== step;
  });
  domainDialog.querySelectorAll('[data-domain-dot]').forEach((dot) => {
    const index = Number(dot.dataset.domainDot);
    dot.classList.toggle('current', index === step);
    dot.classList.toggle('done', index < step);
  });
  $('#domain-check').hidden = step !== 1;
  $('#domain-recheck').hidden = step !== 2;
  $('#domain-submit').hidden = step !== 2;
  $('#domain-submit').disabled = false;
}

function renderDomainList() {
  const list = $('#domain-list');
  const empty = $('#domain-list-empty');
  const hosts = state.domainDraftHosts;
  empty.hidden = hosts.length > 0;
  list.replaceChildren(...hosts.map((host) => {
    const row = element('div', 'domain-row');
    const copy = element('div', 'domain-row-copy');
    copy.append(element('strong', '', host));
    const status = state.domainStatuses[host];
    const chip = element('span', `status-chip ${domainStatusTone(status)}`, domainStatusLabel(status));
    copy.append(chip);
    const remove = element('button', 'secondary domain-remove', 'ลบ');
    remove.type = 'button';
    remove.disabled = hosts.length <= 1;
    remove.title = hosts.length <= 1 ? 'ต้องเหลืออย่างน้อยหนึ่งโดเมน' : `ลบ ${host}`;
    remove.addEventListener('click', () => removeDomainHost(host).catch(showError));
    row.append(copy, remove);
    return row;
  }));
}

function domainStatusTone(status) {
  if (!status) return 'muted';
  if (status === 'ok') return 'ready';
  if (status === 'mismatch' || status === 'unresolved' || status === 'error') return 'needs';
  return 'muted';
}

function domainStatusLabel(status) {
  if (!status) return 'กำลังตรวจ…';
  if (status === 'ok') return 'ชี้ IP ถูก';
  if (status === 'mismatch') return 'IP ไม่ตรง';
  if (status === 'unresolved') return 'ยังไม่ resolve';
  if (status === 'error') return 'ตรวจไม่สำเร็จ';
  return 'ไม่ทราบสถานะ';
}

async function refreshDomainStatuses() {
  const project = state.domainProject;
  if (!project) return;
  const hosts = [...state.domainDraftHosts];
  await Promise.all(hosts.map(async (host) => {
    try {
      const result = await api(`/api/projects/${encodeURIComponent(project.slug)}/domains/check`, { method: 'POST', body: { hostname: host } });
      state.domainStatuses[host] = result.status;
    } catch {
      state.domainStatuses[host] = 'error';
    }
  }));
  if (state.domainView === 'list' && domainDialog.open) renderDomainList();
}

async function checkDomainInput() {
  const project = state.domainProject;
  if (!project) return;
  const input = $('#domain-hostname');
  const hostname = input.value.trim().toLowerCase();
  if (!hostname) {
    input.setCustomValidity('กรอกชื่อโดเมน');
    input.reportValidity();
    return;
  }
  input.setCustomValidity('');
  const check = state.domainStep === 2 ? $('#domain-recheck') : $('#domain-check');
  check.disabled = true;
  try {
    const result = await api(`/api/projects/${encodeURIComponent(project.slug)}/domains/check`, { method: 'POST', body: { hostname } });
    state.domainCheck = result;
    renderDomainCheck(result);
    setDomainStep(2);
  } catch (error) {
    toast(error.message, true);
  } finally {
    check.disabled = false;
  }
}

function renderDomainCheck(result) {
  const summary = $('#domain-check-summary');
  if (result.status === 'ok') summary.textContent = `${result.hostname} ชี้มายังเครื่องนี้แล้ว`;
  else if (result.status === 'mismatch') summary.textContent = `${result.hostname} resolve แล้วแต่ยังไม่ชี้ IP ของเครื่องนี้`;
  else if (result.status === 'error') summary.textContent = result.detail || `ตรวจสอบ DNS สำหรับ ${result.hostname} ไม่สำเร็จ`;
  else summary.textContent = `${result.hostname} ยังไม่ resolve ใน DNS`;
  const detail = $('#domain-check-detail');
  detail.replaceChildren();
  appendDomainDetail(detail, 'พบ DNS', result.resolved?.length ? result.resolved.join(', ') : '—');
  appendDomainDetail(detail, 'ตั้ง DNS ไปที่', result.expected?.length ? result.expected.join(', ') : '—');
  appendDomainDetail(detail, 'สถานะ', domainStatusLabel(result.status));
  if (result.status === 'error' && result.detail) appendDomainDetail(detail, 'รายละเอียด', result.detail);
  $('#domain-submit').textContent = ['mismatch', 'unresolved', 'error'].includes(result.status) ? 'บันทึกโดเมนไว้ก่อน' : 'เพิ่มโดเมน';
}

function appendDomainDetail(root, label, value) {
  const dt = document.createElement('dt');
  dt.textContent = label;
  const dd = document.createElement('dd');
  dd.textContent = value;
  root.append(dt, dd);
}

async function confirmAddDomain(event) {
  event.preventDefault();
  const project = state.domainProject;
  if (!project) return;
  const hostname = (state.domainCheck?.hostname || $('#domain-hostname').value.trim().toLowerCase());
  if (!hostname) {
    toast('กรอกชื่อโดเมนก่อน', true);
    return;
  }
  if (state.domainDraftHosts.includes(hostname)) {
    toast('โดเมนนี้มีอยู่แล้ว', true);
    return;
  }
  if (state.domainDraftHosts.length >= 10) {
    toast('เพิ่มได้สูงสุด 10 โดเมน', true);
    return;
  }
  const domains = [...state.domainDraftHosts, hostname];
  const submit = $('#domain-submit');
  submit.disabled = true;
  try {
    const result = await api(`/api/projects/${encodeURIComponent(project.slug)}/domains`, { method: 'POST', body: { domains } });
    state.domainDraftHosts = [...(result.project.domains?.hosts || domains)];
    state.domainStatuses[hostname] = state.domainCheck?.status || 'muted';
    state.domainProject = { ...project, domains: result.project.domains };
    toast('บันทึกโดเมนแล้ว');
    await refresh();
    const updated = state.projects.find((item) => item.slug === project.slug);
    if (updated) state.domainProject = updated;
    setDomainView('list');
    refreshDomainStatuses().catch(() => {});
  } catch (error) {
    toast(error.message, true);
    submit.disabled = false;
  }
}

async function removeDomainHost(host) {
  const project = state.domainProject;
  if (!project) return;
  const domains = state.domainDraftHosts.filter((item) => item !== host);
  if (!domains.length) {
    toast('ต้องเหลืออย่างน้อยหนึ่งโดเมน', true);
    return;
  }
  const result = await api(`/api/projects/${encodeURIComponent(project.slug)}/domains`, { method: 'POST', body: { domains } });
  state.domainDraftHosts = [...(result.project.domains?.hosts || domains)];
  delete state.domainStatuses[host];
  toast('ลบโดเมนแล้ว');
  await refresh();
  const updated = state.projects.find((item) => item.slug === project.slug);
  if (updated) state.domainProject = updated;
  renderDomainList();
  refreshDomainStatuses().catch(() => {});
}

function openDeployDialog(project) {
  state.deployProject = project;
  const keys = project.environment?.keys || [];
  $('#deploy-project-label').textContent = `${project.organization || 'Unorganized'} / ${project.name}`;
  $('#deploy-environment').value = '';
  $('#deploy-env-hint').textContent = keys.length
    ? `มี ${keys.length} keys แล้ว — วางค่าใหม่เฉพาะเมื่อต้องการอัปเดต แล้วกดสร้าง release`
    : 'ต้องมีอย่างน้อยหนึ่งตัวแปรก่อน deploy';
  if (!keys.length) $('#deploy-env-hint').textContent = 'Leave this blank to save NODE_ENV=production automatically.';
  const keyList = $('#deploy-existing-keys');
  if (keys.length) {
    keyList.hidden = false;
    keyList.replaceChildren(...keys.map((key) => element('span', 'env-key-chip', key)));
  } else {
    keyList.hidden = true;
    keyList.replaceChildren();
  }
  $('#deploy-submit').disabled = false;
  $('#deploy-submit').textContent = keys.length ? 'สร้าง release' : 'บันทึกและสร้าง release';
  deployDialog.showModal();
  $('#deploy-environment').focus();
}

async function submitDeploy(event) {
  event.preventDefault();
  const project = state.deployProject;
  if (!project) return;
  const content = $('#deploy-environment').value.trim();
  const hasKeys = Boolean(project.environment?.keys?.length);
  const submit = $('#deploy-submit');
  submit.disabled = true;
  try {
    if (content || !hasKeys) await api(`/api/projects/${encodeURIComponent(project.slug)}/environment`, { method: 'POST', body: { content } });
    const result = await api(`/api/projects/${encodeURIComponent(project.slug)}/deploy`, { method: 'POST', body: {} });
    state.deployProject = null;
    toast(result.activation === 'pending' ? 'Candidate ผ่าน health check แล้ว — รอ privileged helper activate บน host' : 'Deploy สำเร็จและเปิดใช้งาน release ใหม่แล้ว');
    await refresh();
    if (deployDialog.open) deployDialog.close();
  } catch (error) {
    toast(error.message, true);
    submit.disabled = false;
  }
}

async function rollbackProject(project, button) {
  if (!await confirmDeployment('Rollback release?', `ระบบจะสลับ ${project.name} กลับไปยัง release ก่อนหน้า หลัง privileged helper ยืนยันการ activate`, 'Rollback')) return;
  button.disabled = true;
  try {
    const result = await api(`/api/projects/${encodeURIComponent(project.slug)}/rollback`, { method: 'POST', body: {} });
    toast(result.activation === 'pending' ? 'Rollback พร้อมแล้ว — รอ privileged helper activate บน host' : 'Rollback สำเร็จแล้ว');
    await refresh();
  } catch (error) { toast(error.message, true); button.disabled = false; }
}

function confirmDeployment(title, message, acceptLabel) {
  $('#confirm-title').textContent = title;
  $('#confirm-message').textContent = message;
  $('#confirm-accept').textContent = acceptLabel;
  return new Promise((resolve) => {
    confirmDialog.addEventListener('close', () => resolve(confirmDialog.returnValue === 'confirm'), { once: true });
    confirmDialog.showModal();
    $('#confirm-accept').focus();
  });
}

function openProjectWizard(project = null) {
  state.editingProject = project;
  state.slugManual = false;
  const form = $('#project-form');
  form.reset();
  $('#project-dialog-eyebrow').textContent = project ? 'EDIT PROJECT' : 'NEW PROJECT';
  $('#project-dialog-title').textContent = project ? `แก้ไข ${project.name}` : 'สร้างโปรเจคใหม่';
  $('#wizard-submit').textContent = project ? 'บันทึกการแก้ไขและ Sync source' : 'บันทึกและ Sync source';
  $('#project-slug').readOnly = Boolean(project);
  setBranchOptions([project?.branch || 'main'], project?.branch || 'main');
  if (project) {
    for (const [key, value] of Object.entries(project)) {
      const field = form.elements.namedItem(key);
      if (field && typeof value === 'string') field.value = value;
    }
    $('#project-directory').value = project.directory || '/';
    const protocol = form.querySelector(`input[name="protocol"][value="${project.protocol}"]`);
    if (protocol) protocol.checked = true;
    $('#credential-id').value = project.credentialId || '';
  }
  $('#project-port').value = '3000';
  if (project) $('#project-port').value = String(project.port);
  setWizardStep(1);
  toggleCredentialReference();
  updateWizardPreview();
  projectDialog.showModal();
  focusWizardPanel();
}

async function fetchBranches() {
  const repository = $('#repository');
  if (!repository.reportValidity()) return;
  const button = $('#fetch-branches');
  const protocol = document.querySelector('input[name="protocol"]:checked')?.value || 'https';
  button.disabled = true;
  try {
    const result = await api('/api/git/branches', { method: 'POST', body: { repository: repository.value, protocol, credentialId: $('#credential-id').value } });
    if (!result.branches.length) throw new Error('ไม่พบ branch ที่เลือกได้ใน repository นี้');
    const previous = $('#branch').value;
    setBranchOptions(result.branches, result.branches.includes(previous) ? previous : (result.branches.includes('main') ? 'main' : result.branches[0]));
    toast(`พบ ${result.branches.length} branches แล้ว`);
  } finally { button.disabled = false; }
}

function setBranchOptions(branches, selected) {
  const branch = $('#branch');
  branch.replaceChildren(...branches.map((name) => new Option(name, name)));
  branch.value = branches.includes(selected) ? selected : branches[0] || '';
}

function nextWizardStep() {
  const panel = document.querySelector(`[data-wizard-step="${state.wizardStep}"]`);
  const fields = [...panel.querySelectorAll('input:not([disabled]), select:not([disabled])')];
  if (!fields.every((field) => field.reportValidity())) return;
  if (state.wizardStep === 2) renderProjectReview();
  setWizardStep(state.wizardStep + 1);
}

function setWizardStep(step) {
  const previous = state.wizardStep;
  state.wizardStep = Math.max(1, Math.min(3, step));
  const phase = wizardPhases[state.wizardStep - 1];
  document.querySelectorAll('[data-wizard-step]').forEach((panel) => {
    const active = Number(panel.dataset.wizardStep) === state.wizardStep;
    panel.hidden = !active;
    panel.classList.toggle('is-entering', active && previous !== state.wizardStep);
  });
  document.querySelectorAll('[data-wizard-dot]').forEach((dot) => {
    const index = Number(dot.dataset.wizardDot);
    dot.classList.toggle('current', index === state.wizardStep);
    dot.classList.toggle('done', index < state.wizardStep);
    dot.classList.toggle('active', index <= state.wizardStep);
  });
  $('#wizard-phase-label').textContent = `ขั้นที่ ${state.wizardStep} จาก 3 · ${phase.title}`;
  $('#wizard-preview-phase').textContent = phase.next;
  $('#wizard-back').hidden = state.wizardStep === 1;
  $('#wizard-next').hidden = state.wizardStep === 3;
  $('#wizard-submit').hidden = state.wizardStep !== 3;
  if (state.wizardStep === 3) renderProjectReview();
  updateWizardPreview();
  const stage = $('.wizard-stage');
  stage.scrollTop = 0;
  projectDialog.scrollTop = 0;
  if (previous !== state.wizardStep) focusWizardPanel();
}

function focusWizardPanel() {
  const panel = document.querySelector(`[data-wizard-step="${state.wizardStep}"]`);
  const field = panel?.querySelector('input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])');
  (field || $('.wizard-stage'))?.focus({ preventScroll: true });
  panel?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function wizardFormData() {
  const data = Object.fromEntries(new FormData($('#project-form')));
  data.protocol = document.querySelector('input[name="protocol"]:checked')?.value || 'https';
  return data;
}

function connectionLabel(data) {
  if (data.protocol === 'ssh') return 'SSH — ต้องมี deploy key ก่อน sync';
  if (data.credentialId) {
    const option = $('#credential-id').selectedOptions[0];
    return `HTTPS — ${option?.textContent || 'private credential'}`;
  }
  return 'HTTPS — public repository';
}

function updateWizardPreview() {
  const data = wizardFormData();
  const phase = wizardPhases[state.wizardStep - 1];
  $('#wizard-preview-title').textContent = data.name?.trim() || 'โปรเจคใหม่';
  $('#wizard-preview-sub').textContent = [data.organization?.trim(), data.slug?.trim()].filter(Boolean).join(' / ') || 'กรอกข้อมูลแล้วดูสรุปที่นี่';
  $('#wizard-preview-phase').textContent = phase.next;
  const pairs = [
    { term: 'Organization', value: data.organization, step: 1 },
    { term: 'Slug', value: data.slug, step: 1 },
    { term: 'Repository', value: data.repository, step: 2 },
    { term: 'Directory', value: data.directory || '/', step: 2 },
    { term: 'Branch', value: data.branch || 'main', step: 2 },
    { term: 'Port', value: data.port || '3000', step: 2 },
    { term: 'Connection', value: connectionLabel(data), step: 2 },
  ];
  const list = $('#wizard-preview-list');
  list.replaceChildren(...pairs.map((item) => {
    const filled = Boolean(item.value?.trim());
    const tone = state.wizardStep === 3 || item.step < state.wizardStep ? 'is-done' : item.step === state.wizardStep ? 'is-focus' : 'is-ahead';
    const row = element('div', tone);
    row.append(element('dt', '', item.term), element('dd', filled ? '' : 'is-empty', filled ? item.value.trim() : 'ยังไม่ได้กรอก'));
    return row;
  }));
}

function renderProjectReview() {
  const data = wizardFormData();
  const pairs = [
    ['Organization', data.organization || '—'],
    ['Project', data.name || '—'],
    ['Slug', data.slug || '—'],
    ['Repository', data.repository || '—'],
    ['Directory', data.directory || '/'],
    ['Branch', data.branch || '—'],
    ['Connection', connectionLabel(data)],
    ['Internal port', data.port || '—'],
  ];
  const list = $('#project-review');
  list.replaceChildren(...pairs.flatMap(([term, description]) => [element('dt', '', term), element('dd', '', description)]));
}

function slugify(value) {
  let slug = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);
  if (!slug) return '';
  if (!/^[a-z]/.test(slug)) slug = `p-${slug}`.slice(0, 63);
  return slug;
}

function toggleCredentialReference() {
  const selected = document.querySelector('input[name="protocol"]:checked')?.value || 'https';
  $('#https-credential').hidden = selected !== 'https';
  $('#credential-id').disabled = selected !== 'https';
}

function navigate(page, { updateUrl = true, scroll = true } = {}) {
  const target = pathnameForPage(page);
  document.querySelectorAll('[data-page]').forEach((section) => { section.hidden = section.dataset.page !== page; });
  document.querySelectorAll('[data-page-target]').forEach((button) => button.classList.toggle('active', button.dataset.pageTarget === page));
  document.title = `${page === 'overview' ? 'Dashboard' : page[0].toUpperCase() + page.slice(1)} · Dashboard Portal`;
  closeMobileMenu();
  if (updateUrl && window.location.pathname !== target) history.pushState({ page }, '', target);
  if (scroll) window.scrollTo({ top: 0, behavior: 'smooth' });
}

function toggleMobileMenu() { $('.sidebar').classList.toggle('open'); $('#mobile-menu').setAttribute('aria-expanded', $('.sidebar').classList.contains('open')); }
function closeMobileMenu() { $('.sidebar').classList.remove('open'); $('#mobile-menu').setAttribute('aria-expanded', 'false'); }
function element(tag, className = '', text = '') { const node = document.createElement(tag); node.className = className; node.textContent = text; return node; }
function duration(seconds) { const days = Math.floor(seconds / 86400); const hours = Math.floor(seconds % 86400 / 3600); const minutes = Math.floor(seconds % 3600 / 60); return days ? `${days}d ${hours}h` : `${hours}h ${minutes}m`; }
function toast(message, error = false) { const el = $('#toast'); el.textContent = message; el.className = `toast show${error ? ' error-toast' : ''}`; clearTimeout(toast.timeout); toast.timeout = setTimeout(() => { el.className = 'toast'; }, 4400); }
function showError(error) { toast(error.message, true); }

async function bootstrap() {
  const session = await api('/api/session');
  if (session.authenticated) { state.csrfToken = session.csrfToken; state.mode = session.mode; await showDashboard(); }
}

function removePasswordFromUrl() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has('password')) return;
  url.searchParams.delete('password');
  history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}
bootstrap().catch(showError);
