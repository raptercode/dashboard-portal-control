import { pageForPathname } from './router.js';

const DRAFT_KEY = 'hostmgr.projectDraft';
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const state = {
  csrfToken: null,
  mode: null,
  doctor: null,
  audit: [],
  git: { identity: null },
  projects: [],
  credentials: [],
  vaultReady: false,
  softwareUpdate: null,
  metrics: null,
  metricsRange: Number(sessionStorage.getItem('hostmgr.metricsRange') || 7) || 7,
  databases: [],
  databaseProviders: [],
  bootstrapRequired: false,
  owner: null,
  activeProject: null,
  domainDraft: null,
  slugManual: false
};

const page = document.body.dataset.page || pageForPathname(location.pathname);
const view = document.body.dataset.view || page;
const flowMode = document.body.dataset.flowMode || 'create';
const editSlug = document.body.dataset.editSlug || '';

function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#icon-${name}`);
  svg.append(use);
  return svg;
}

function element(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function duration(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor(seconds % 86400 / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  return days ? `${days}d ${hours}h` : `${hours}h ${minutes}m`;
}

function toast(message, error = false) {
  const node = $('#toast');
  node.textContent = message;
  node.classList.toggle('error', error);
  node.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove('show'), 3200);
}

function showError(error) { toast(error.message || String(error), true); }

async function api(path, options = {}) {
  const headers = { Accept: 'application/json', ...(options.headers || {}) };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.method && options.method !== 'GET' && state.csrfToken) headers['x-csrf-token'] = state.csrfToken;
  const response = await fetch(path, { ...options, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}

function readDraft() {
  try { return JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null') || {}; }
  catch { return {}; }
}

function writeDraft(patch) {
  const next = { ...readDraft(), ...patch };
  sessionStorage.setItem(DRAFT_KEY, JSON.stringify(next));
  return next;
}

function clearDraft() { sessionStorage.removeItem(DRAFT_KEY); }

function slugify(value) {
  let slug = String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63);
  if (!slug) return '';
  if (!/^[a-z]/.test(slug)) slug = `p-${slug}`.slice(0, 63);
  return slug;
}

function flowPath(step) {
  if (flowMode === 'edit' && editSlug) {
    if (step === 'identity') return `/projects/${editSlug}/edit`;
    if (step === 'repository') return `/projects/${editSlug}/edit/repository`;
    return `/projects/${editSlug}/edit/review`;
  }
  if (step === 'identity') return '/projects/new';
  if (step === 'repository') return '/projects/new/repository';
  return '/projects/new/review';
}

function missingTools(tools) { return tools.filter((tool) => tool.required && tool.status !== 'Installed'); }
function statusChip(text, variant) { return element('span', `status-chip ${variant}`, text); }

const PROJECT_STATUS = Object.freeze({
  ready: { key: 'ready', label: 'Ready', detail: 'โปรเจคที่ release พร้อมใช้งาน' },
  down: { key: 'down', label: 'Down', detail: 'sync หรือ deploy ล้มเหลว' },
  pause: { key: 'pause', label: 'Pause', detail: 'ยังไม่รัน / รอ activate' }
});

function projectRuntimeStatus(project) {
  const deployment = project.deployment || {};
  const sync = project.sync || {};
  if (deployment.state === 'active') return 'ready';
  if (deployment.state === 'failed' || sync.status === 'failed') return 'down';
  return 'pause';
}

function projectStatusCounts(projects) {
  const counts = { ready: 0, down: 0, pause: 0 };
  for (const project of projects) counts[projectRuntimeStatus(project)] += 1;
  return counts;
}

function currentProjectStatusFilter() {
  const value = new URLSearchParams(location.search).get('status');
  return PROJECT_STATUS[value] ? value : '';
}

function setShell(mode) {
  const boot = $('#boot-view');
  const login = $('#login-view');
  const bootstrap = $('#bootstrap-view');
  const dashboard = $('#dashboard-view');
  if (boot) boot.hidden = mode !== 'boot';
  if (login) login.hidden = mode !== 'login';
  if (bootstrap) bootstrap.hidden = mode !== 'bootstrap';
  if (dashboard) dashboard.hidden = mode !== 'dashboard';
  document.body.dataset.shell = mode;
}

async function showLogin() {
  setShell('login');
  $('#login-email')?.focus();
}

async function showBootstrap(requireCurrent = false) {
  setShell('bootstrap');
  const wrap = $('#bootstrap-current-wrap');
  const current = $('#bootstrap-current');
  if (wrap && current) {
    wrap.hidden = !requireCurrent;
    current.required = requireCurrent;
  }
  $('#bootstrap-email')?.focus();
}

async function showDashboard() {
  setShell('dashboard');
  $$('.nav-link').forEach((link) => link.classList.toggle('active', link.dataset.nav === page));
  await refresh();
  await hydrateCurrentView();
}

async function refresh() {
  const [doctor, audit, git, projects, credentials, softwareUpdate] = await Promise.all([
    api('/api/doctor'), api('/api/audit'), api('/api/git-config'), api('/api/projects'), api('/api/credentials'), api('/api/software-update')
  ]);
  state.doctor = doctor;
  state.audit = audit.events || [];
  state.git = git;
  state.projects = projects.projects || [];
  state.credentials = credentials.credentials || [];
  state.vaultReady = credentials.vaultReady;
  state.softwareUpdate = softwareUpdate;
  state.mode = doctor.mode;
  $('#mode-badge').textContent = doctor.mode === 'host' ? 'host' : 'sandbox';
  const notice = $('#sandbox-notice');
  if (notice) notice.hidden = doctor.mode !== 'demo';
  if (page === 'overview') {
    renderOverview();
    await loadMetrics(state.metricsRange);
  }
  if (page === 'setup') renderSetup();
  if (view === 'projects') renderProjects();
  if (page === 'credentials') renderCredentials();
  if (page === 'databases') await renderDatabases();
  if (page === 'activity') renderAudit();
  if (page === 'settings') renderSettings();
}

function renderOverview() {
  const { host, supportedNodeMajor, tools } = state.doctor;
  $('#host-name').textContent = host.hostname;
  $('#host-platform').textContent = `${host.platform} · ${host.arch}`;
  $('#node-version').textContent = `v${supportedNodeMajor}`;
  $('#uptime').textContent = duration(host.uptimeSeconds);
  $('#memory').textContent = `${formatBytes(host.memoryBytes)} total`;
  renderResourceCards(host);
  const counts = projectStatusCounts(state.projects);
  $('#status-ready-count').textContent = String(counts.ready);
  $('#status-down-count').textContent = String(counts.down);
  $('#status-pause-count').textContent = String(counts.pause);
  $$('.range-button').forEach((button) => {
    button.classList.toggle('is-active', Number(button.dataset.range) === state.metricsRange);
  });
  const checklist = [
    { title: 'ติดตั้งเครื่องมือที่จำเป็น', detail: missingTools(tools).length ? `ยังขาด ${missingTools(tools).map((tool) => tool.label).join(', ')}` : 'เครื่องมือที่จำเป็นพร้อมแล้ว', ready: !missingTools(tools).length, href: '/setup' },
    { title: 'ตั้งค่า Git identity', detail: state.git.identity ? state.git.identity.email : 'เพิ่มชื่อและอีเมลสำหรับ commit', ready: Boolean(state.git.identity), href: '/setup' },
    { title: 'เพิ่มโปรเจคแรก', detail: state.projects.length ? `${state.projects.length} โปรเจคที่ตั้งค่าแล้ว` : 'เชื่อมต่อ repository และเลือก branch', ready: state.projects.length > 0, href: '/projects' },
    { title: 'ตั้งค่า secrets ก่อน deploy', detail: state.projects.some((project) => project.environment?.keys?.length) ? 'มี project secrets ที่บันทึกแล้ว' : 'กดสร้าง release แล้วใส่ `.env` ของโปรเจคก่อน deploy', ready: state.projects.some((project) => project.environment?.keys?.length), href: '/projects' }
  ];
  $('#readiness-count').textContent = `${checklist.filter((item) => item.ready).length}/${checklist.length} พร้อม`;
  const root = $('#readiness');
  root.replaceChildren(...checklist.map((item) => {
    const row = element('article', `readiness-item${item.ready ? '' : ' is-actionable'}`);
    const copyWrap = element('div', 'readiness-copy');
    const badge = element('span', `readiness-icon${item.ready ? '' : ' pending'}`);
    badge.append(icon(item.ready ? 'check' : 'dot'));
    const copy = element('div');
    copy.append(element('strong', '', item.title), element('small', '', item.detail));
    copyWrap.append(badge, copy);
    row.append(copyWrap, statusChip(item.ready ? 'พร้อม' : 'ต้องทำ', item.ready ? 'ready' : 'muted'));
    if (!item.ready) row.addEventListener('click', () => { location.href = item.href; });
    return row;
  }));
  const next = checklist.find((item) => !item.ready);
  $('#next-action-title').textContent = next ? next.title : 'ตั้งค่าพื้นฐานพร้อมแล้ว';
  $('#next-action-copy').textContent = next ? next.detail : 'สามารถจัดการโปรเจค deploy และ domain ได้จากเมนูโปรเจค';
  const button = $('#next-action-button');
  button.hidden = !next;
  if (next) {
    button.textContent = 'ไปทำต่อ';
    button.onclick = () => { location.href = next.href; };
  }
}

function renderResourceCards(host) {
  const current = state.metrics?.current;
  const cpu = current?.cpuPercent ?? host.cpuPercent ?? 0;
  const memoryUsed = current?.memoryUsedBytes ?? host.memoryUsedBytes ?? 0;
  const memoryTotal = current?.memoryTotalBytes ?? host.memoryBytes ?? 0;
  const diskUsed = current?.diskUsedBytes ?? host.diskUsedBytes ?? 0;
  const diskTotal = current?.diskTotalBytes ?? host.diskTotalBytes ?? 0;
  const memoryPercent = memoryTotal ? (memoryUsed / memoryTotal) * 100 : 0;
  const diskPercent = diskTotal ? (diskUsed / diskTotal) * 100 : 0;
  $('#resource-cpu').textContent = `${formatPercent(cpu)}%`;
  $('#resource-cpu-bar').style.width = `${Math.min(100, cpu)}%`;
  $('#resource-memory').textContent = formatBytes(memoryUsed);
  $('#resource-memory-bar').style.width = `${Math.min(100, memoryPercent)}%`;
  $('#resource-memory-detail').textContent = `${formatPercent(memoryPercent)}% · ${formatBytes(memoryTotal)} รวม`;
  $('#resource-disk').textContent = diskTotal ? formatBytes(diskUsed) : '—';
  $('#resource-disk-bar').style.width = `${Math.min(100, diskPercent)}%`;
  $('#resource-disk-detail').textContent = diskTotal ? `${formatPercent(diskPercent)}% · ${formatBytes(diskTotal)} รวม` : 'ยังไม่อ่านดิสก์ได้';
  $('#resource-uptime').textContent = duration(current?.uptimeSeconds ?? host.uptimeSeconds ?? 0);
  $('#resource-host-detail').textContent = `${host.hostname} · ${host.platform}`;
}

async function loadMetrics(rangeDays = state.metricsRange) {
  if (page !== 'overview' || !$('#metrics-chart')) return;
  state.metricsRange = [1, 3, 7, 15, 30].includes(Number(rangeDays)) ? Number(rangeDays) : 7;
  sessionStorage.setItem('hostmgr.metricsRange', String(state.metricsRange));
  $$('.range-button').forEach((button) => {
    button.classList.toggle('is-active', Number(button.dataset.range) === state.metricsRange);
  });
  state.metrics = await api(`/api/metrics?range=${state.metricsRange}`);
  $('#metrics-updated').textContent = `อัปเดต ${new Date(state.metrics.updatedAt).toLocaleTimeString('th-TH')}`;
  if (state.doctor?.host) renderResourceCards(state.doctor.host);
  drawMetricsChart(state.metrics.samples || []);
}

function drawMetricsChart(samples) {
  const canvas = $('#metrics-chart');
  if (!canvas) return;
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth || 960;
  const height = 280;
  canvas.width = Math.floor(width * ratio);
  canvas.height = Math.floor(height * ratio);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#fbfcfd';
  ctx.fillRect(0, 0, width, height);
  const pad = { top: 16, right: 16, bottom: 28, left: 36 };
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;
  ctx.strokeStyle = '#d5dce2';
  ctx.fillStyle = '#5b6775';
  ctx.font = '11px Segoe UI, Tahoma, sans-serif';
  for (let i = 0; i <= 4; i += 1) {
    const y = pad.top + (chartH * i) / 4;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + chartW, y);
    ctx.stroke();
    ctx.fillText(String(100 - i * 25), 8, y + 3);
  }
  if (!samples.length) {
    ctx.fillText('ยังไม่มีข้อมูลประวัติ — จะเริ่มสะสมทุก 5 นาที', pad.left, pad.top + chartH / 2);
    return;
  }
  const times = samples.map((sample) => Date.parse(sample.at));
  const minX = Math.min(...times);
  const maxX = Math.max(...times);
  const spanX = Math.max(1, maxX - minX);
  const series = [
    { key: 'cpuPercent', color: '#d64545' },
    { key: 'memoryPercent', color: '#2f9e6b' },
    { key: 'diskPercent', color: '#2f6fed' }
  ];
  for (const line of series) {
    ctx.beginPath();
    ctx.strokeStyle = line.color;
    ctx.lineWidth = 1.6;
    samples.forEach((sample, index) => {
      const x = pad.left + ((times[index] - minX) / spanX) * chartW;
      const y = pad.top + chartH - (Math.min(100, Math.max(0, sample[line.key] || 0)) / 100) * chartH;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
  const labelCount = Math.min(5, samples.length);
  for (let i = 0; i < labelCount; i += 1) {
    const index = labelCount === 1 ? 0 : Math.round((i * (samples.length - 1)) / (labelCount - 1));
    const x = pad.left + ((times[index] - minX) / spanX) * chartW;
    const label = new Date(times[index]).toLocaleString('th-TH', state.metricsRange <= 1
      ? { hour: '2-digit', minute: '2-digit' }
      : { month: 'short', day: 'numeric', hour: '2-digit' });
    ctx.fillStyle = '#5b6775';
    ctx.fillText(label, Math.min(x, width - 70), height - 8);
  }
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GB`;
  if (value >= 1024 ** 2) return `${Math.round(value / 1024 ** 2)} MB`;
  return `${Math.round(value / 1024)} KB`;
}

function formatPercent(value) {
  return (Math.round((Number(value) || 0) * 10) / 10).toFixed(1).replace(/\.0$/, '');
}

function renderSetup() {
  const root = $('#tools');
  root.replaceChildren(...state.doctor.tools.map((tool) => {
    const row = element('article', 'tool-row');
    const copy = element('div');
    copy.append(element('h3', '', tool.label), element('p', 'muted', `${tool.required ? 'จำเป็น' : 'ทางเลือก'} · ${tool.purpose}`), element('small', '', tool.version || 'ไม่พบในระบบ'));
    const side = element('div');
    side.append(statusChip(tool.status === 'Installed' ? 'พร้อม' : 'ยังไม่ติดตั้ง', tool.status === 'Installed' ? 'ready' : 'muted'));
    if (tool.status !== 'Installed') {
      const install = element('button', '', 'ติดตั้ง');
      install.type = 'button';
      install.addEventListener('click', () => installTool(tool.id, install));
      side.append(install);
    }
    row.append(copy, side);
    return row;
  }));
  if (state.git.identity) {
    $('#git-name').value = state.git.identity.name || '';
    $('#git-email').value = state.git.identity.email || '';
  }
}

function renderProjects() {
  const root = $('#projects');
  if (!root) return;
  const statusFilter = currentProjectStatusFilter();
  const filterBanner = $('#project-status-filter');
  const filterLabel = $('#project-status-filter-label');
  if (filterBanner && filterLabel) {
    filterBanner.hidden = !statusFilter;
    if (statusFilter) {
      const meta = PROJECT_STATUS[statusFilter];
      filterLabel.textContent = `กรองสถานะ ${meta.label} — ${meta.detail}`;
    }
  }
  const query = ($('#project-search')?.value || '').trim().toLocaleLowerCase('th-TH');
  const projects = state.projects.filter((project) => {
    if (statusFilter && projectRuntimeStatus(project) !== statusFilter) return false;
    if (!query) return true;
    return [project.name, project.slug, project.organization, project.repository, project.branch].join(' ').toLocaleLowerCase('th-TH').includes(query);
  });
  $('#project-count').textContent = `${projects.length} โปรเจค`;
  if (!projects.length) {
    const empty = statusFilter
      ? `ไม่มีโปรเจคในสถานะ ${PROJECT_STATUS[statusFilter].label}`
      : (query ? 'ไม่พบโปรเจคที่ตรงกับคำค้นหา' : 'ยังไม่มีโปรเจค — เริ่มเชื่อมต่อ repository แรกของคุณ');
    root.replaceChildren(element('div', 'empty-state', empty));
    return;
  }
  const groups = new Map();
  projects.forEach((project) => {
    const name = project.organization || 'ไม่ระบุองค์กร';
    groups.set(name, [...(groups.get(name) || []), project]);
  });
  root.replaceChildren(...[...groups.entries()].flatMap(([organization, items]) => {
    const heading = element('h2', 'organization', organization);
    const list = element('section', 'project-list');
    list.setAttribute('aria-label', organization);
    list.append(...items.map(projectRow));
    return [heading, list];
  }));
}

function projectRow(project) {
  const sync = project.sync || { status: 'unknown', detail: 'ยังไม่มีข้อมูลการ sync' };
  const deployment = project.deployment || { state: 'idle', activeReleaseId: null, previousReleaseId: null, releases: [] };
  const row = element('article', 'project-row');
  const copy = element('div');
  copy.append(
    element('h3', '', project.name),
    (() => { const meta = element('p', 'project-meta'); meta.append(element('b', '', project.slug), document.createTextNode(` ${project.branch} · ${project.protocol.toUpperCase()} · port ${project.port}`)); return meta; })(),
    element('p', 'project-meta', project.repository + (project.environment?.keys?.length ? ` · .env ${project.environment.keys.length} keys` : '')),
    element('p', 'project-meta', `directory: ${project.directory || '/'} · npm: ${project.buildScript === null ? 'no build step' : `build=${project.buildScript || 'build'}`} · start=${project.startScript || 'start'}`),
    element('p', 'project-meta', project.domains?.hosts?.length ? `domains: ${project.domains.hosts.join(', ')}` : 'domains: not configured')
  );
  const badges = element('div', 'project-badges');
  const syncTone = sync.status === 'synced' ? 'ready' : (sync.status === 'failed' || sync.status === 'needs_ssh_key' ? 'needs' : 'muted');
  const syncLabel = sync.status === 'synced' ? 'source synced' : sync.status === 'needs_ssh_key' ? 'ต้องมี SSH key' : sync.status === 'failed' ? 'sync ล้มเหลว' : 'ยังไม่ sync';
  badges.append(statusChip(syncLabel, syncTone));
  const releaseLabel = deployment.state === 'active' ? 'release พร้อมใช้งาน' : deployment.state === 'awaiting_activation' ? 'รอ activate บน host' : deployment.state === 'failed' ? 'deploy ล้มเหลว' : 'ยังไม่ deploy';
  badges.append(statusChip(releaseLabel, deployment.state === 'active' ? 'ready' : deployment.state === 'failed' ? 'needs' : 'muted'));
  const actions = element('div', 'project-actions');
  const deploy = element('button', 'secondary', 'สร้าง release');
  deploy.type = 'button';
  deploy.disabled = sync.status !== 'synced';
  deploy.addEventListener('click', () => openDeployDialog(project));
  actions.append(deploy);
  const latestRelease = deployment.releases?.[0];
  if (latestRelease) {
    const logs = element('button', 'secondary', 'ดู log');
    logs.type = 'button';
    logs.addEventListener('click', () => openDeploymentLog(project, latestRelease));
    actions.append(logs);
  }
  const domain = element('button', 'secondary', 'จัดการ domain');
  domain.type = 'button';
  domain.addEventListener('click', () => openDomainDialog(project));
  actions.append(domain);
  const logsPage = element('a', 'secondary button', 'Logs');
  logsPage.href = `/projects/${encodeURIComponent(project.slug)}/logs`;
  actions.append(logsPage);
  const edit = element('a', 'secondary button', 'แก้ไข');
  edit.href = `/projects/${encodeURIComponent(project.slug)}/edit`;
  actions.append(edit);
  const remove = element('button', 'secondary danger', 'ลบ');
  remove.type = 'button';
  remove.addEventListener('click', () => deleteProject(project, remove));
  actions.append(remove);
  if (deployment.previousReleaseId) {
    const rollback = element('button', 'secondary', 'ย้อนกลับ');
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
    copy.append(element('h3', '', credential.name), element('p', 'muted', `HTTPS token · บันทึก ${new Date(credential.createdAt).toLocaleString('th-TH')}`));
    row.append(copy, statusChip('เข้ารหัสแล้ว', 'ready'));
    return row;
  }));
}

async function renderDatabases() {
  const root = $('#databases');
  if (!root) return;
  const payload = await api('/api/databases');
  state.databases = payload.connections || [];
  state.databaseProviders = payload.providers || [];
  state.vaultReady = payload.vaultReady;
  $('#database-count').textContent = `${state.databases.length} connectors`;
  const defaults = { postgresql: 5432, mysql: 3306, mongodb: 27017, redis: 6379 };
  const provider = $('#database-provider');
  if (provider && !provider.dataset.bound) {
    provider.dataset.bound = '1';
    provider.addEventListener('change', () => {
      $('#database-port').value = String(defaults[provider.value] || 5432);
    });
  }
  if (!state.vaultReady) {
    root.replaceChildren(element('div', 'empty-state', 'Credential vault ยังไม่พร้อม — ตั้งค่า HOSTMGR_SECRET_KEY ก่อนบันทึก connector'));
    return;
  }
  if (!state.databases.length) {
    root.replaceChildren(element('div', 'empty-state', 'ยังไม่มี database connector'));
    return;
  }
  root.replaceChildren(...state.databases.map((connection) => {
    const row = element('article', 'credential-row');
    const copy = element('div');
    copy.append(
      element('h3', '', connection.name),
      element('p', 'muted', `${connection.provider} · ${connection.host}:${connection.port}${connection.database ? ` · ${connection.database}` : ''}`),
      element('small', '', connection.lastStatus ? `ตรวจล่าสุด: ${connection.lastStatus}` : 'ยังไม่เคยทดสอบ')
    );
    const side = element('div');
    side.append(statusChip(connection.hasPassword ? 'มีรหัสผ่าน' : 'ไม่มีรหัสผ่าน', connection.hasPassword ? 'ready' : 'muted'));
    const check = element('button', 'secondary', 'ทดสอบ');
    check.type = 'button';
    check.addEventListener('click', async () => {
      check.disabled = true;
      try {
        const result = await api(`/api/databases/${encodeURIComponent(connection.id)}/check`, { method: 'POST', body: {} });
        toast(result.result?.detail || 'เชื่อมต่อได้');
        await renderDatabases();
      } catch (error) { showError(error); }
      finally { check.disabled = false; }
    });
    const remove = element('button', 'secondary danger', 'ลบ');
    remove.type = 'button';
    remove.addEventListener('click', async () => {
      if (!await confirmAction('ลบ connector', `ลบ ${connection.name} หรือไม่?`, 'ลบ')) return;
      await api(`/api/databases/${encodeURIComponent(connection.id)}`, { method: 'DELETE', body: {} });
      toast('ลบ connector แล้ว');
      await renderDatabases();
    });
    side.append(check, remove);
    row.append(copy, side);
    return row;
  }));
}

function fillCredentialSelect(selected = '') {
  const select = $('#credential-id');
  if (!select) return;
  select.replaceChildren(new Option('Public repository — ไม่ต้องใช้ credential', ''), ...state.credentials.map((credential) => new Option(credential.name, credential.id)));
  select.value = [...select.options].some((option) => option.value === selected) ? selected : '';
}

function renderAudit() {
  const body = $('#audit');
  body.replaceChildren(...state.audit.map((event) => {
    const row = element('tr');
    row.append(
      element('td', '', new Date(event.at).toLocaleString('th-TH')),
      element('td', '', event.action),
      element('td', '', event.target || '—'),
      element('td', `outcome-${event.outcome}`, event.outcome)
    );
    return row;
  }));
  if (!state.audit.length) {
    const row = element('tr');
    const cell = element('td', '', 'ยังไม่มีกิจกรรม');
    cell.colSpan = 4;
    row.append(cell);
    body.append(row);
  }
}

function renderSettings() {
  renderSoftwareUpdate();
  $('#settings-mode').textContent = state.mode === 'host' ? 'host' : 'sandbox';
  $('#mode-description').textContent = state.mode === 'host'
    ? 'โหมด host — คำสั่งติดตั้งและ deploy ทำงานบนเครื่องจริงผ่าน privileged helper'
    : 'โหมด sandbox — การติดตั้งถูกจำลองและไม่แก้ host จริง';
}

function renderSoftwareUpdate() {
  const update = state.softwareUpdate;
  const root = $('#software-update');
  const command = $('#update-command');
  const copy = $('#copy-update-command');
  if (!update?.configured) {
    root.replaceChildren(element('h2', '', 'อัปเดตซอฟต์แวร์'), element('p', '', 'ยังไม่ได้เชื่อมช่องทาง release ที่เซ็นลายเซ็นไว้ ระบบจะไม่ดาวน์โหลดหรืออัปเดตอะไรเอง'));
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
  root.replaceChildren(element('h2', '', 'อัปเดตซอฟต์แวร์'), element('p', '', status), element('small', 'update-detail', detail));
  command.textContent = `sudo dashboard-portal update --channel=${update.channel}`;
  copy.disabled = false;
}

async function installTool(tool, button) {
  if (!await confirmAction('ยืนยันการติดตั้ง', `ติดตั้ง ${tool} ผ่าน allowlisted helper หรือไม่?`, 'ติดตั้งต่อ')) return;
  button.disabled = true;
  try {
    const result = await api(`/api/tools/${tool}/install`, { method: 'POST', body: { confirm: true } });
    toast(result.detail || `ติดตั้ง ${tool} แล้ว`);
    await refresh();
  } catch (error) { showError(error); }
  finally { button.disabled = false; }
}

function confirmAction(title, message, acceptLabel = 'ยืนยัน') {
  const dialog = $('#confirm-dialog');
  $('#confirm-title').textContent = title;
  $('#confirm-message').textContent = message;
  $('#confirm-accept').textContent = acceptLabel;
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true });
  });
}

async function deleteProject(project, button) {
  if (!await confirmAction('ลบโปรเจค', `ลบ ${project.name} ออกจาก Dashboard หรือไม่?`, 'ลบ')) return;
  button.disabled = true;
  try {
    await api(`/api/projects/${encodeURIComponent(project.slug)}`, { method: 'DELETE', body: {} });
    toast(`ลบ ${project.name} แล้ว`);
    await refresh();
  } catch (error) { showError(error); }
  finally { button.disabled = false; }
}

async function rollbackProject(project, button) {
  if (!await confirmAction('ย้อนกลับ release', `ย้อน ${project.name} ไปยัง release ก่อนหน้าหรือไม่?`, 'ย้อนกลับ')) return;
  button.disabled = true;
  try {
    const result = await api(`/api/projects/${encodeURIComponent(project.slug)}/rollback`, { method: 'POST', body: {} });
    toast(result.activation === 'queued' || result.activation === 'pending' ? 'จัดคิว rollback แล้ว' : 'rollback สำเร็จ');
    if (result.job?.id) watchDeploymentJob(result.job.id, project.slug);
    else await refresh();
  } catch (error) { showError(error); }
  finally { button.disabled = false; }
}

function openDeployDialog(project) {
  state.activeProject = project;
  $('#deploy-project-label').textContent = `${project.name} · ${project.slug}`;
  const keys = project.environment?.keys || [];
  const keyList = $('#deploy-existing-keys');
  keyList.hidden = !keys.length;
  keyList.replaceChildren(...keys.map((key) => element('span', '', key)));
  $('#deploy-environment').value = '';
  $('#deploy-env-hint').textContent = keys.length ? `มี ${keys.length} keys อยู่แล้ว — วางทับได้เมื่อต้องการอัปเดต` : 'ต้องมีอย่างน้อยหนึ่งตัวแปรก่อน deploy';
  $('#deploy-dialog').showModal();
}

async function submitDeploy(event) {
  event.preventDefault();
  const project = state.activeProject;
  const content = $('#deploy-environment').value;
  const hasKeys = Boolean(project.environment?.keys?.length);
  if (!content && !hasKeys) throw new Error('ต้องมีอย่างน้อยหนึ่งตัวแปรใน .env ก่อน deploy');
  const submit = $('#deploy-submit');
  submit.disabled = true;
  try {
    if (content || !hasKeys) await api(`/api/projects/${encodeURIComponent(project.slug)}/environment`, { method: 'POST', body: { content } });
    const result = await api(`/api/projects/${encodeURIComponent(project.slug)}/deploy`, { method: 'POST', body: {} });
    $('#deploy-dialog').close();
    toast(result.activation === 'queued' ? 'จัดคิว deploy แล้ว' : 'สร้าง release แล้ว');
    if (result.job?.id) watchDeploymentJob(result.job.id, project.slug);
    else await refresh();
  } catch (error) { showError(error); }
  finally { submit.disabled = false; }
}

function openDeploymentLog(project, release) {
  $('#deployment-log-title').textContent = `${project.name} · ${release.id || 'release'}`;
  $('#deployment-log-summary').textContent = `${release.status || 'unknown'} · ${release.createdAt ? new Date(release.createdAt).toLocaleString('th-TH') : ''}`;
  const list = $('#deployment-log-events');
  const events = release.events || [];
  list.replaceChildren(...(events.length ? events.map((event) => {
    const item = element('li');
    item.textContent = `${event.at ? new Date(event.at).toLocaleString('th-TH') : ''} · ${event.phase || event.status || 'event'} · ${event.message || ''}`;
    return item;
  }) : [element('li', '', 'ยังไม่มีเหตุการณ์')]));
  $('#deployment-log-dialog').showModal();
}

function renderProjectReleaseLogs(project) {
  const root = $('#log-releases');
  const releases = project.deployment?.releases || [];
  if (!releases.length) {
    root.replaceChildren(element('div', 'empty-state', 'ยังไม่มี release'));
    return;
  }
  root.replaceChildren(...releases.map((release) => {
    const row = element('article', 'readiness-item');
    const copy = element('div', 'readiness-copy');
    const text = element('div');
    text.append(element('strong', '', release.id), element('small', '', release.createdAt ? new Date(release.createdAt).toLocaleString('th-TH') : ''));
    copy.append(text);
    const trailing = element('div', 'form-actions');
    const button = element('button', 'secondary', 'ดู log');
    button.type = 'button';
    button.addEventListener('click', () => openDeploymentLog(project, release));
    trailing.append(statusChip(release.status || 'unknown', release.status === 'active' ? 'ready' : release.status === 'failed' ? 'needs' : 'muted'), button);
    row.append(copy, trailing);
    return row;
  }));
}

async function hydrateProjectLogs() {
  const slug = editSlug;
  const project = state.projects.find((item) => item.slug === slug);
  if (!project) {
    $('#log-page-title').textContent = 'ไม่พบโปรเจค';
    $('#log-runtime').textContent = `ไม่พบโปรเจค slug "${slug}"`;
    return;
  }
  $('#log-page-title').textContent = `${project.name} · Logs`;
  $('#log-page-subtitle').textContent = `${project.slug} · ${project.branch}`;
  renderProjectReleaseLogs(project);
  const checkbox = $('#log-auto-refresh');
  const runtime = $('#log-runtime');
  const notice = $('#log-runtime-notice');
  let timer = null;
  async function loadRuntimeLog() {
    try {
      const data = await api(`/api/projects/${encodeURIComponent(slug)}/logs`);
      $('#log-unit-name').textContent = data.unit || '—';
      if (data.simulated) { notice.hidden = false; notice.textContent = 'Sandbox mode: ข้อความจำลอง ไม่ใช่ log จริงจาก host'; }
      else if (data.available === false) { notice.hidden = false; notice.textContent = data.notice || 'อ่าน log ไม่ได้ในขณะนี้'; }
      else { notice.hidden = true; }
      const wasAtBottom = runtime.scrollTop + runtime.clientHeight >= runtime.scrollHeight - 4;
      runtime.textContent = data.lines?.length ? data.lines.join('\n') : 'ยังไม่มี log';
      if (wasAtBottom) runtime.scrollTop = runtime.scrollHeight;
    } catch (error) {
      notice.hidden = false;
      notice.textContent = error.message || 'โหลด log ไม่สำเร็จ';
    }
  }
  function schedule() {
    clearInterval(timer);
    if (checkbox.checked) timer = setInterval(loadRuntimeLog, 5000);
  }
  checkbox.addEventListener('change', schedule);
  $('#log-refresh-now').addEventListener('click', loadRuntimeLog);
  await loadRuntimeLog();
  schedule();
}

function watchDeploymentJob(jobId, slug) {
  const poll = async () => {
    try {
      const { job } = await api(`/api/jobs/${encodeURIComponent(jobId)}`);
      if (job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled') {
        toast(job.status === 'succeeded' ? `งานของ ${slug} สำเร็จ` : `งานของ ${slug} สิ้นสุดด้วยสถานะ ${job.status}`, job.status !== 'succeeded');
        await refresh();
        return;
      }
      setTimeout(poll, 1500);
    } catch { setTimeout(poll, 2500); }
  };
  setTimeout(poll, 800);
}

function openDomainDialog(project) {
  state.activeProject = project;
  state.domainDraft = { hosts: [...(project.domains?.hosts || [])], pending: null, check: null };
  $('#domain-project-label').textContent = `${project.name} · ${project.slug}`;
  setDomainView('list');
  renderDomainList();
  $('#domain-dialog').showModal();
  refreshDomainStatuses();
}

function setDomainView(viewName) {
  const root = $('[data-domain-view]');
  root.dataset.domainView = viewName;
  $$('.domain-list-panel, .domain-list-notice').forEach((node) => { node.hidden = viewName !== 'list'; });
  $('.domain-add-panel').hidden = viewName !== 'add';
  $('#domain-cancel').hidden = viewName !== 'list';
  $('#domain-add-start').hidden = viewName !== 'list';
  $('#domain-back').hidden = viewName === 'list';
  $('#domain-check').hidden = viewName !== 'add' || Number(root.dataset.domainStep || 1) !== 1;
  $('#domain-recheck').hidden = viewName !== 'add' || Number(root.dataset.domainStep || 1) !== 2;
  $('#domain-submit').hidden = viewName !== 'add' || Number(root.dataset.domainStep || 1) !== 2;
  if (viewName === 'add') setDomainStep(1);
}

function setDomainStep(step) {
  $('[data-domain-view]').dataset.domainStep = String(step);
  $$('[data-domain-step]').forEach((panel) => { panel.hidden = Number(panel.dataset.domainStep) !== step; });
  $$('[data-domain-dot]').forEach((dot) => {
    const index = Number(dot.dataset.domainDot);
    dot.classList.toggle('current', index === step);
    dot.classList.toggle('done', index < step);
  });
  $('#domain-check').hidden = step !== 1;
  $('#domain-recheck').hidden = step !== 2;
  $('#domain-submit').hidden = step !== 2;
  $('#domain-back').hidden = false;
}

function renderDomainList() {
  const hosts = state.domainDraft?.hosts || [];
  const list = $('#domain-list');
  $('#domain-list-empty').hidden = hosts.length > 0;
  list.replaceChildren(...hosts.map((host) => {
    const chip = element('span', 'domain-chip', host);
    const remove = element('button', 'secondary', 'ลบ');
    remove.type = 'button';
    remove.addEventListener('click', () => removeDomainHost(host));
    chip.append(remove);
    return chip;
  }));
}

function domainStatusLabel(status) {
  if (status === 'ok') return 'DNS พร้อม';
  if (status === 'mismatch') return 'ชี้ผิดเครื่อง';
  if (status === 'unresolved') return 'ยังไม่ resolve';
  return 'ตรวจไม่ได้';
}

async function refreshDomainStatuses() {
  const project = state.activeProject;
  if (!project || !state.domainDraft?.hosts?.length) return;
  for (const host of state.domainDraft.hosts) {
    try {
      await api(`/api/projects/${encodeURIComponent(project.slug)}/domains/check`, { method: 'POST', body: { hostname: host } });
    } catch { /* keep list usable even if one check fails */ }
  }
}

async function checkDomainInput() {
  const hostname = $('#domain-hostname').value.trim();
  if (!hostname) throw new Error('กรุณากรอกโดเมน');
  const project = state.activeProject;
  $('#domain-check-summary').textContent = 'กำลังตรวจสอบ…';
  $('#domain-check-detail').replaceChildren();
  setDomainStep(2);
  try {
    const result = await api(`/api/projects/${encodeURIComponent(project.slug)}/domains/check`, { method: 'POST', body: { hostname } });
    state.domainDraft.pending = result.hostname || hostname;
    state.domainDraft.check = result;
    renderDomainCheck(result);
  } catch (error) {
    $('#domain-check-summary').textContent = error.message;
    showError(error);
  }
}

function renderDomainCheck(result) {
  $('#domain-check-summary').textContent = domainStatusLabel(result.status);
  const detail = $('#domain-check-detail');
  detail.replaceChildren();
  const pairs = [
    ['Hostname', result.hostname],
    ['สถานะ', domainStatusLabel(result.status)],
    ['รายละเอียด', result.detail || result.message || '—']
  ];
  for (const [term, value] of pairs) {
    detail.append(element('dt', '', term), element('dd', '', value || '—'));
  }
}

async function confirmAddDomain(event) {
  event.preventDefault();
  const project = state.activeProject;
  const hostname = state.domainDraft.pending;
  if (!hostname) throw new Error('ยังไม่มีโดเมนที่ตรวจแล้ว');
  const domains = [...new Set([...(state.domainDraft.hosts || []), hostname])];
  if (domains.length > 10) throw new Error('เพิ่มได้ไม่เกิน 10 โดเมน');
  const result = await api(`/api/projects/${encodeURIComponent(project.slug)}/domains`, { method: 'POST', body: { domains } });
  state.domainDraft.hosts = result.project?.domains?.hosts || domains;
  toast(`เพิ่ม ${hostname} แล้ว`);
  setDomainView('list');
  renderDomainList();
  await refresh();
}

async function removeDomainHost(host) {
  const project = state.activeProject;
  const domains = (state.domainDraft.hosts || []).filter((item) => item !== host);
  if (!domains.length) {
    toast('ต้องเหลืออย่างน้อยหนึ่งโดเมน หรือลบผ่านการตั้งค่าใหม่ภายหลัง', true);
    return;
  }
  const result = await api(`/api/projects/${encodeURIComponent(project.slug)}/domains`, { method: 'POST', body: { domains } });
  state.domainDraft.hosts = result.project?.domains?.hosts || domains;
  renderDomainList();
  await refresh();
}

async function hydrateCurrentView() {
  if (view === 'projects-new') return hydrateIdentityStep();
  if (view === 'projects-new-repository') return hydrateRepositoryStep();
  if (view === 'projects-new-review') return hydrateReviewStep();
  if (view === 'project-logs') return hydrateProjectLogs();
}

async function ensureEditDraft() {
  if (flowMode !== 'edit' || !editSlug) return readDraft();
  const draft = readDraft();
  if (draft.slug === editSlug && draft.repository) return draft;
  const project = state.projects.find((item) => item.slug === editSlug);
  if (!project) throw new Error('ไม่พบโปรเจคที่ต้องการแก้ไข');
  return writeDraft({
    organization: project.organization || '',
    name: project.name || '',
    slug: project.slug,
    repository: project.repository || '',
    directory: project.directory || '/',
    branch: project.branch || 'main',
    port: String(project.port || 3000),
    buildScript: project.buildScript ?? 'build',
    startScript: project.startScript || 'start',
    healthCheckEnabled: project.healthCheckEnabled !== false,
    healthCheckPath: project.healthCheckPath || '/',
    protocol: project.protocol || 'https',
    credentialId: project.credentialId || ''
  });
}

async function hydrateIdentityStep() {
  const draft = await ensureEditDraft();
  $('#flow-title').textContent = flowMode === 'edit' ? `แก้ไข ${draft.name || editSlug}` : 'สร้างโปรเจค';
  $('#project-organization').value = draft.organization || '';
  $('#project-name').value = draft.name || '';
  $('#project-slug').value = draft.slug || '';
  $('#project-slug').readOnly = flowMode === 'edit';
  state.slugManual = flowMode === 'edit' || Boolean(draft.slug && draft.name && slugify(draft.name) !== draft.slug);
  const back = $('a.secondary.button[href="/projects"]');
  if (flowMode === 'edit' && back) back.href = '/projects';
}

async function hydrateRepositoryStep() {
  const draft = await ensureEditDraft();
  if (!draft.name || !draft.slug) {
    location.replace(flowPath('identity'));
    return;
  }
  $('#flow-title').textContent = flowMode === 'edit' ? `แก้ไข ${draft.name}` : 'สร้างโปรเจค';
  $('#flow-back').href = flowPath('identity');
  fillCredentialSelect(draft.credentialId || '');
  $('#repository').value = draft.repository || '';
  $('#project-directory').value = draft.directory || '/';
  setBranchOptions([draft.branch || 'main'], draft.branch || 'main');
  $('#project-port').value = draft.port || '3000';
  $('#build-script').value = draft.buildScript ?? 'build';
  $('#start-script').value = draft.startScript || 'start';
  $('#health-check-enabled').checked = draft.healthCheckEnabled !== false;
  $('#health-check-path').value = draft.healthCheckPath || '/';
  const protocol = document.querySelector(`input[name="protocol"][value="${draft.protocol || 'https'}"]`);
  if (protocol) protocol.checked = true;
  toggleCredentialReference();
  toggleHealthCheckFields();
}

async function hydrateReviewStep() {
  const draft = await ensureEditDraft();
  if (!draft.repository || !draft.name || !draft.slug) {
    location.replace(flowPath(draft.name && draft.slug ? 'repository' : 'identity'));
    return;
  }
  $('#flow-title').textContent = flowMode === 'edit' ? `แก้ไข ${draft.name}` : 'สร้างโปรเจค';
  $('#flow-back').href = flowPath('repository');
  const pairs = [
    ['องค์กร', draft.organization || '—'],
    ['ชื่อโปรเจค', draft.name || '—'],
    ['Slug', draft.slug || '—'],
    ['Repository', draft.repository || '—'],
    ['Directory', draft.directory || '/'],
    ['Branch', draft.branch || '—'],
    ['การเชื่อมต่อ', connectionLabel(draft)],
    ['Port ภายในเครื่อง', draft.port || '—'],
    ['Health check', draft.healthCheckEnabled === false ? 'Skipped' : (draft.healthCheckPath || '/')]
  ];
  const list = $('#project-review');
  list.replaceChildren(...pairs.flatMap(([term, description]) => [element('dt', '', term), element('dd', '', description)]));
}

function connectionLabel(data) {
  if (data.protocol === 'ssh') return 'SSH — ต้องมี deploy key ก่อน sync';
  if (data.credentialId) {
    const credential = state.credentials.find((item) => item.id === data.credentialId);
    return `HTTPS — ${credential?.name || 'private credential'}`;
  }
  return 'HTTPS — public repository';
}

function setBranchOptions(branches, selected) {
  const branch = $('#branch');
  branch.replaceChildren(...branches.map((name) => new Option(name, name)));
  branch.value = branches.includes(selected) ? selected : branches[0] || '';
}

function toggleHealthCheckFields() {
  const enabled = $('#health-check-enabled').checked;
  $('#health-check-path').disabled = !enabled;
  $('#health-check-path-row').classList.toggle('is-disabled', !enabled);
}

function toggleCredentialReference() {
  const selected = document.querySelector('input[name="protocol"]:checked')?.value || 'https';
  $('#https-credential').hidden = selected !== 'https';
  $('#credential-id').disabled = selected !== 'https';
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
  } catch (error) { showError(error); }
  finally { button.disabled = false; }
}

async function syncProjectDraft() {
  const draft = readDraft();
  const payload = {
    organization: draft.organization,
    name: draft.name,
    slug: draft.slug,
    repository: draft.repository,
    directory: draft.directory || '/',
    branch: draft.branch || 'main',
    port: Number(draft.port || 3000),
    buildScript: draft.buildScript ?? 'build',
    startScript: draft.startScript || 'start',
    healthCheckEnabled: draft.healthCheckEnabled !== false,
    healthCheckPath: draft.healthCheckPath || '/',
    protocol: draft.protocol || 'https',
    credentialId: draft.credentialId || ''
  };
  const result = await api('/api/projects/sync', { method: 'POST', body: payload });
  clearDraft();
  toast(result.project?.sync?.status === 'synced' ? 'บันทึกและ sync source แล้ว' : (result.project?.sync?.detail || 'บันทึกโปรเจคแล้ว'));
  location.href = '/projects';
}

function bindEvents() {
  $('#login-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const error = $('#login-error');
    error.textContent = '';
    try {
      const values = Object.fromEntries(new FormData(event.currentTarget));
      const result = await api('/api/login', { method: 'POST', body: values });
      state.csrfToken = result.csrfToken;
      state.mode = result.mode;
      state.owner = result.owner;
      await showDashboard();
    } catch (err) {
      if (err.message?.includes('bootstrap')) {
        await showBootstrap(true);
        return;
      }
      error.textContent = err.message;
    }
  });
  $('#bootstrap-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const error = $('#bootstrap-error');
    error.textContent = '';
    try {
      const values = Object.fromEntries(new FormData(event.currentTarget));
      const result = await api('/api/bootstrap', { method: 'POST', body: values });
      state.csrfToken = result.csrfToken;
      state.mode = result.mode;
      state.owner = result.owner;
      state.bootstrapRequired = false;
      await showDashboard();
    } catch (err) {
      error.textContent = err.message;
    }
  });
  $('#database-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const form = event.currentTarget;
      const values = Object.fromEntries(new FormData(form));
      values.tls = form.elements.namedItem('tls')?.checked === true;
      values.port = Number(values.port);
      await api('/api/databases', { method: 'POST', body: values });
      form.reset();
      $('#database-port').value = '5432';
      toast('บันทึก database connector แล้ว');
      await renderDatabases();
    } catch (error) { showError(error); }
  });
  $('#logout')?.addEventListener('click', async () => {
    try { await api('/api/logout', { method: 'POST', body: {} }); } catch { /* expired ok */ }
    state.csrfToken = null;
    await showLogin();
  });
  $('#refresh')?.addEventListener('click', () => refresh().catch(showError));
  $$('.range-button').forEach((button) => {
    button.addEventListener('click', () => loadMetrics(Number(button.dataset.range)).catch(showError));
  });
  window.addEventListener('resize', () => {
    if (state.metrics?.samples) drawMetricsChart(state.metrics.samples);
  });
  $('#mobile-menu')?.addEventListener('click', () => {
    const open = !document.body.classList.contains('nav-open');
    document.body.classList.toggle('nav-open', open);
    $('#mobile-menu').setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', (event) => {
    if (!document.body.classList.contains('nav-open')) return;
    if (event.target.closest('.sidebar, #mobile-menu')) return;
    document.body.classList.remove('nav-open');
    $('#mobile-menu')?.setAttribute('aria-expanded', 'false');
  });
  $('#git-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await api('/api/git-config', { method: 'POST', body: Object.fromEntries(new FormData(event.currentTarget)) });
      toast('บันทึก Git identity แล้ว');
      await refresh();
    } catch (error) { showError(error); }
  });
  $('#credential-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await api('/api/credentials', { method: 'POST', body: Object.fromEntries(new FormData(event.currentTarget)) });
      event.currentTarget.reset();
      toast('บันทึก credential แล้ว');
      await refresh();
    } catch (error) { showError(error); }
  });
  $('#password-change-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const values = new FormData(event.currentTarget);
      if (values.get('newPassword') !== values.get('confirmPassword')) throw new Error('ยืนยันรหัสผ่านใหม่ไม่ตรงกัน');
      const result = await api('/api/settings/password', { method: 'POST', body: { currentPassword: values.get('currentPassword'), newPassword: values.get('newPassword') } });
      state.csrfToken = result.csrfToken;
      event.currentTarget.reset();
      toast('เปลี่ยนรหัสผ่านแล้ว และออกจาก session อื่นทั้งหมดแล้ว');
    } catch (error) { showError(error); }
  });
  $('#copy-update-command')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($('#update-command').textContent);
      toast('คัดลอกคำสั่ง SSH แล้ว');
    } catch { toast('คัดลอกคำสั่งไม่ได้ กรุณาเลือกข้อความด้านล่าง', true); }
  });
  $('#project-search')?.addEventListener('input', () => renderProjects());
  $('#create-project')?.addEventListener('click', () => clearDraft());

  $('#project-identity-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    writeDraft(data);
    location.href = flowPath('repository');
  });
  $('#project-name')?.addEventListener('input', (event) => {
    if (state.slugManual || flowMode === 'edit') return;
    $('#project-slug').value = slugify(event.currentTarget.value);
  });
  $('#project-slug')?.addEventListener('input', () => { state.slugManual = true; });

  $('#project-repository-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    data.protocol = document.querySelector('input[name="protocol"]:checked')?.value || 'https';
    data.healthCheckEnabled = $('#health-check-enabled').checked;
    writeDraft(data);
    location.href = flowPath('review');
  });
  $('#fetch-branches')?.addEventListener('click', () => fetchBranches().catch(showError));
  $('#health-check-enabled')?.addEventListener('change', toggleHealthCheckFields);
  $$('input[name="protocol"]').forEach((input) => input.addEventListener('change', toggleCredentialReference));

  $('#project-review-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = $('#wizard-submit');
    submit.disabled = true;
    try { await syncProjectDraft(); }
    catch (error) { showError(error); }
    finally { submit.disabled = false; }
  });

  $('#deploy-form')?.addEventListener('submit', (event) => submitDeploy(event).catch(showError));
  $('#deploy-close')?.addEventListener('click', () => $('#deploy-dialog').close());
  $('#deploy-cancel')?.addEventListener('click', () => $('#deploy-dialog').close());
  $('#deployment-log-close')?.addEventListener('click', () => $('#deployment-log-dialog').close());
  $('#deployment-log-dismiss')?.addEventListener('click', () => $('#deployment-log-dialog').close());

  $('#domain-close')?.addEventListener('click', () => $('#domain-dialog').close());
  $('#domain-cancel')?.addEventListener('click', () => $('#domain-dialog').close());
  $('#domain-add-start')?.addEventListener('click', () => setDomainView('add'));
  $('#domain-back')?.addEventListener('click', () => {
    const step = Number($('[data-domain-view]').dataset.domainStep || 1);
    if (step > 1) setDomainStep(step - 1);
    else setDomainView('list');
  });
  $('#domain-check')?.addEventListener('click', () => checkDomainInput().catch(showError));
  $('#domain-recheck')?.addEventListener('click', () => checkDomainInput().catch(showError));
  $('#domain-form')?.addEventListener('submit', (event) => confirmAddDomain(event).catch(showError));
}

async function bootstrap() {
  if (location.search.includes('password=')) {
    const url = new URL(location.href);
    url.searchParams.delete('password');
    history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  }
  bindEvents();
  try {
    const session = await api('/api/session');
    state.csrfToken = session.csrfToken;
    state.mode = session.mode;
    state.bootstrapRequired = Boolean(session.bootstrapRequired);
    state.owner = session.owner;
    if (session.bootstrapRequired) await showBootstrap(Boolean(session.bootstrapRequiresInstallerPassword));
    else if (session.authenticated) await showDashboard();
    else await showLogin();
  } catch (error) {
    $('#boot-view').hidden = true;
    await showLogin();
    showError(error);
  }
}

bootstrap();
