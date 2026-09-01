import { pageForPathname } from './router.js';

const DRAFT_KEY = 'hostmgr.projectDraft';
const SIDEBAR_COLLAPSED_KEY = 'hostmgr.sidebarCollapsed';
const THEME_KEY = 'hostmgr.theme';
const THEME_COLOR_LIGHT = '#f8fafc';
const THEME_COLOR_DARK = '#0b1220';
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
  deployEnvironmentVariables: [],
  domainDraft: null,
  notificationProject: null,
  slugManual: false,
  deployStep: 1
};
let deploymentProgressTimer = null;

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

function resetForm(form) {
  if (form instanceof HTMLFormElement) form.reset();
}

async function withBusy(button, work) {
  if (!button) return work();
  button.disabled = true;
  button.classList.add('is-busy');
  button.setAttribute('aria-busy', 'true');
  try { return await work(); }
  finally {
    button.disabled = false;
    button.classList.remove('is-busy');
    button.removeAttribute('aria-busy');
  }
}

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
  const status = projectDisplayStatus(project);
  if (status.key === 'released') return 'ready';
  if (status.key === 'attention') return 'down';
  return 'pause';
}

function projectDisplayStatus(project) {
  const deployment = project.deployment || {};
  const sync = project.sync || {};
  const latestRelease = deployment.releases?.[0];
  if (project.runtimeStatus?.state === 'down' || ['failed', 'needs_ssh_key'].includes(sync.status) || latestRelease?.status === 'failed' || deployment.state === 'failed') return { key: 'attention', tone: 'error', label: 'Needs attention' };
  if (['deploying', 'rolling_back', 'awaiting_activation'].includes(deployment.state)) return { key: 'deploying', tone: 'building', label: 'Deploying…' };
  if (deployment.state === 'active' && deployment.activeReleaseId) return { key: 'released', tone: 'success', label: 'Released' };
  return { key: 'synced', tone: 'muted', label: 'Ready to release' };
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
  setSidebarCollapsed(localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true');
  $$('.nav-link').forEach((link) => link.classList.toggle('active', link.dataset.nav === page));
  await refresh();
  await hydrateCurrentView();
}

function setSidebarCollapsed(collapsed) {
  document.body.classList.toggle('sidebar-collapsed', collapsed);
  const toggle = $('#sidebar-toggle');
  if (!toggle) return;
  const label = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
  toggle.setAttribute('aria-label', label);
  toggle.setAttribute('aria-pressed', String(collapsed));
  toggle.title = label;
}

function applyTheme(theme) {
  const isDark = theme === 'dark';
  document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', isDark ? THEME_COLOR_DARK : THEME_COLOR_LIGHT);
  const toggle = $('#theme-toggle');
  if (toggle) {
    const label = isDark ? 'สลับเป็นโหมดสว่าง' : 'สลับเป็นโหมดมืด';
    toggle.setAttribute('aria-label', label);
    toggle.title = label;
    const use = toggle.querySelector('use');
    if (use) use.setAttribute('href', isDark ? '#icon-sun' : '#icon-moon');
  }
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
  const modeBadge = $('#mode-badge');
  if (modeBadge) modeBadge.textContent = doctor.mode === 'host' ? 'host' : 'sandbox';
  const ownerLabel = state.owner?.email || 'owner';
  const initials = ownerLabel.split('@')[0].split(/[._-]/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'OW';
  const hostBreadcrumb = $('#host-breadcrumb');
  if (hostBreadcrumb) hostBreadcrumb.textContent = doctor.host?.hostname || '—';
  const tlsBadge = $('#tls-badge');
  if (tlsBadge?.lastChild) tlsBadge.lastChild.textContent = doctor.mode === 'host' ? ' Host connected' : ' Sandbox';
  const ownerAvatar = $('#owner-avatar');
  if (ownerAvatar) ownerAvatar.textContent = initials;
  const sidebarAvatar = $('#sidebar-avatar');
  if (sidebarAvatar) sidebarAvatar.textContent = initials;
  const sidebarOwner = $('#sidebar-owner');
  if (sidebarOwner) sidebarOwner.textContent = ownerLabel.split('@')[0] || 'Owner';
  const projectCount = $('#sidebar-project-count');
  if (projectCount) {
    projectCount.hidden = false;
    projectCount.textContent = String(state.projects.length);
  }
  const notice = $('#sandbox-notice');
  if (notice) notice.hidden = doctor.mode !== 'demo';
  if (page === 'overview') {
    renderOverview();
    await loadMetrics(state.metricsRange);
  }
  if (page === 'setup') renderSetup();
  if (view === 'projects') renderProjects();
  if (page === 'credentials') renderCredentials();
  if (page === 'databases' && view !== 'database-console') await renderDatabases();
  if (view === 'database-console') await renderDatabaseConsole();
  if (page === 'mail' && view !== 'mail-setup') renderMail();
  if (view === 'mail-setup') await renderMailSetup();
  if (page === 'activity') renderAudit();
  if (page === 'settings') renderSettings();
}

function renderOverview() {
  const { host, supportedNodeMajor, tools } = state.doctor;
  $('#host-name').textContent = host.hostname;
  $('#host-platform').textContent = `${host.platform} · ${host.arch}`;
  $('#host-name-detail').textContent = host.hostname;
  $('#host-platform-detail').textContent = `${host.platform} · ${host.arch}`;
  $('#node-version').textContent = `v${supportedNodeMajor}`;
  $('#uptime').textContent = duration(host.uptimeSeconds);
  $('#memory').textContent = `${formatBytes(host.memoryBytes)} total`;
  renderResourceCards(host);
  const counts = projectStatusCounts(state.projects);
  $('#status-total-count').textContent = String(state.projects.length);
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

function cssVar(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
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
  const bgColor = cssVar('--panel', '#ffffff');
  const gridColor = cssVar('--line-soft', '#e2e8f0');
  const textColor = cssVar('--muted', '#64748b');
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, width, height);
  const pad = { top: 16, right: 16, bottom: 28, left: 36 };
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;
  ctx.strokeStyle = gridColor;
  ctx.fillStyle = textColor;
  ctx.font = '11px Inter, Segoe UI, sans-serif';
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
    { key: 'cpuPercent', color: cssVar('--danger', '#ef4444') },
    { key: 'memoryPercent', color: cssVar('--ok', '#10b981') },
    { key: 'diskPercent', color: cssVar('--accent', '#4f46e5') }
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
    ctx.fillStyle = textColor;
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

const MAIL_PORT_STATUS = Object.freeze({
  open: { label: 'เปิด', variant: 'ready' },
  filtered: { label: 'ถูกกรอง', variant: 'needs' },
  blocked: { label: 'ถูกบล็อค', variant: 'needs' }
});

const MAIL_PLAN_GUIDE = Object.freeze({
  direct: { label: 'ส่งตรงแบบ Direct MX ได้', detail: 'พอร์ต 25 เปิด: โฮสต์นี้รัน mail server ส่งตรงถึงปลายทางได้ — ก่อนใช้งานจริงต้องตั้ง Reverse DNS (PTR), SPF, DKIM และ DMARC' },
  'relay-587': { label: 'ใช้ relay พอร์ต 587', detail: 'พอร์ต 25 ถูกบล็อค: ให้ส่งออกผ่าน relay (smarthost) พอร์ต 587 ด้วย SMTP AUTH + STARTTLS และใส่ relay ไว้ใน SPF record' },
  'relay-2525': { label: 'ใช้ relay พอร์ต 2525', detail: 'เหลือเฉพาะพอร์ต 2525: สมัคร relay ที่รองรับ 2525 (เช่น SMTP2GO, Mailgun, SendGrid) แล้วตั้ง smarthost เป็น [โฮสต์ relay]:2525 พร้อม SMTP AUTH และใช้ SPF/DKIM ของผู้ให้บริการ relay' },
  'api-only': { label: 'ต้องส่งผ่าน HTTPS API', detail: 'พอร์ต SMTP ขาออกถูกบล็อคทั้งหมด: ส่งอีเมลผ่าน HTTPS API (เช่น Resend, Amazon SES, Mailgun API) หรือขอผู้ให้บริการเครือข่ายเปิดพอร์ต' }
});

function renderMailOutboundReport(report) {
  const root = $('#mail-check-results');
  if (!root) return;
  const outbound = report.outbound ?? report;
  const rows = (outbound.ports ?? []).map((entry) => {
    const row = element('article', 'tool-row');
    const status = MAIL_PORT_STATUS[entry.status] ?? { label: entry.status, variant: 'muted' };
    const copy = element('div');
    copy.append(
      element('h3', '', `พอร์ต ${entry.port}`),
      element('p', 'muted', entry.status === 'open' ? `ตอบกลับจาก ${entry.target} · ${entry.latencyMs} ms` : (entry.detail || 'ไม่สามารถเชื่อมต่อได้'))
    );
    const side = element('div');
    side.append(statusChip(status.label, status.variant));
    row.append(copy, side);
    return row;
  });
  const plan = MAIL_PLAN_GUIDE[outbound.recommendation?.mode];
  const advice = element('article', 'tool-row');
  const adviceCopy = element('div');
  adviceCopy.append(
    element('h3', '', `คำแนะนำ: ${plan?.label ?? outbound.recommendation?.mode ?? '—'}`),
    element('p', 'muted', plan?.detail ?? outbound.recommendation?.summary ?? ''),
    element('small', '', `ตรวจเมื่อ ${new Date(outbound.checkedAt).toLocaleString()}`)
  );
  advice.append(adviceCopy);
  root.replaceChildren(...rows, advice);
  if (report.inbound?.ports) {
    root.append(element('p', 'muted', 'ขาเข้า: ตรวจ policy firewall บน host เท่านั้น ต้องยืนยันจากการรับ mail จริงภายนอก'));
    for (const entry of report.inbound.ports) {
      const row = element('article', 'tool-row');
      const status = entry.status === 'allowed' ? { label: 'อนุญาตใน firewall', variant: 'ready' } : entry.status === 'blocked' ? { label: 'ถูกบล็อค', variant: 'needs' } : { label: 'ยังไม่ยืนยัน', variant: 'muted' };
      row.append(element('div', '', `พอร์ต ${entry.port} · ${entry.detail || entry.source || 'ไม่ทราบ policy'}`), statusChip(status.label, status.variant));
      root.append(row);
    }
  }
}

function renderProjects() {
  const root = $('#projects');
  if (!root) return;
  renderProjectsHealth();
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
  $('#project-count').textContent = `${projects.length} projects`;
  $('#projects-subtitle').textContent = `${projects.length} projects · ${projectStatusCounts(projects).ready} running · ${projectStatusCounts(projects).pause} pending`;
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
  const entries = [...groups.entries()];
  root.replaceChildren(...entries.flatMap(([organization, items]) => {
    const heading = element('h2', 'organization', organization);
    const list = element('section', 'project-list');
    list.setAttribute('aria-label', organization);
    list.append(...items.map(projectRow));
    return entries.length > 1 ? [heading, list] : [list];
  }));
}

function renderProjectsHealth() {
  const root = $('#project-health-strip');
  if (!root) return;
  const tool = (id) => state.doctor?.tools?.find((item) => item.id === id);
  const installed = (id) => tool(id)?.status === 'Installed';
  const host = state.doctor?.host || {};
  const diskTotal = host.diskTotalBytes || 0;
  const diskPercent = diskTotal ? ((host.diskUsedBytes || 0) / diskTotal) * 100 : 0;
  const memoryTotal = host.memoryBytes || 0;
  const memoryUsed = host.memoryUsedBytes || 0;
  const pill = (label, warning = false) => {
    const item = element('span', `health-pill${warning ? ' warn' : ''}`);
    item.append(element('span', 'check', warning ? '⚠' : '✓'), document.createTextNode(` ${label}`));
    return item;
  };
  const items = [
    pill(`Node ${state.doctor?.supportedNodeMajor ? `v${state.doctor.supportedNodeMajor}` : '—'}`),
    pill('Bun supported'),
    pill(installed('nginx') ? 'Nginx running' : 'Nginx not installed', !installed('nginx')),
    pill(installed('certbot') ? 'Certbot ready' : 'Certbot not installed', !installed('certbot')),
    pill(diskTotal ? `Disk ${formatPercent(diskPercent)}% used` : 'Disk unavailable', diskPercent >= 80),
    pill(memoryTotal ? `Memory ${formatBytes(memoryUsed)} / ${formatBytes(memoryTotal)}` : 'Memory unavailable')
  ];
  root.replaceChildren(...items);
}

function projectRow(project) {
  const sync = project.sync || { status: 'unknown', detail: 'ยังไม่มีข้อมูลการ sync' };
  const deployment = project.deployment || { state: 'idle', activeReleaseId: null, previousReleaseId: null, releases: [] };
  const row = element('article', 'project-row project-card');
  const copy = element('div', 'project-copy');
  const headline = element('div', 'card-head project-headline');
  const cardTitle = element('div', 'card-title');
  const displayStatus = projectDisplayStatus(project);
  cardTitle.append(element('span', `status-dot ${displayStatus.tone}`), element('h3', '', project.name));
  const latestRelease = deployment.releases?.[0];
  const version = latestRelease?.revision || deployment.activeReleaseId || (deployment.state === 'active' ? 'active' : deployment.state);
  const identity = element('span', 'card-version', String(version || 'draft').slice(0, 18));
  const secondary = element('div', 'project-secondary');
  const domains = element('span', 'project-domain');
  if (project.domains?.hosts?.length) {
    project.domains.hosts.forEach((host, index) => {
      if (index) domains.append(document.createTextNode(', '));
      const domain = element('a', 'project-domain-link', host);
      domain.href = `https://${host}`;
      domain.target = '_blank';
      domain.rel = 'noopener noreferrer';
      domains.append(domain);
    });
  } else {
    domains.classList.add('muted');
    domains.textContent = 'ยังไม่ได้ตั้งค่า domain';
  }
  const repository = element('div', 'card-repo', String(project.repository || '').replace(/^https?:\/\//, '').replace(/^git@/, '').replace(/\.git$/, ''));
  const meta = element('div', 'card-meta');
  const portMeta = element('span', 'meta-item');
  portMeta.append(document.createTextNode('Port '), element('strong', '', String(project.port || 'auto')));
  const branchMeta = element('span', 'meta-item');
  branchMeta.append(document.createTextNode('Branch '), element('strong', '', project.branch));
  meta.append(portMeta, branchMeta, element('span', `project-state ${displayStatus.tone}`, displayStatus.label));
  const details = element('details', 'project-details');
  const detailSummary = element('summary', '', 'รายละเอียดการตั้งค่า');
  const detailList = element('dl', 'project-detail-list');
  const runtime = project.runtime === 'docker-compose'
    ? `Docker Compose · ${project.composeFile || 'compose.yaml'} · service=${project.composeService || 'web'}`
    : `${project.runtime === 'bun' ? 'Bun' : 'Node.js'} · ${project.buildScript === null ? 'ไม่ build' : `build=${project.buildScript || 'build'}`} · start=${project.startScript || 'start'}`;
  const values = [
    ['Repository', project.repository],
    ['Directory', project.directory || '/'],
    ['Protocol', project.protocol.toUpperCase()],
    ['Port', String(project.port)],
    ['Runtime', runtime],
    ['Environment', project.environment?.keys?.length ? `.env ${project.environment.keys.length} keys` : 'ไม่มีค่า .env']
  ];
  values.forEach(([label, value]) => detailList.append(element('dt', '', label), element('dd', '', value)));
  details.append(detailSummary, detailList);
  headline.append(cardTitle, identity);
  secondary.append(domains, details);
  copy.append(headline, repository, meta, secondary);
  const actions = element('div', 'card-actions project-actions');
  const primaryAction = element('button', 'btn btn-primary btn-sm', displayStatus.key === 'deploying' ? 'Deploying…' : (displayStatus.key === 'attention' && deployment.previousReleaseId ? 'Rollback' : 'Deploy'));
  primaryAction.type = 'button';
  primaryAction.disabled = displayStatus.key === 'deploying' || sync.status !== 'synced';
  if (displayStatus.key === 'attention' && deployment.previousReleaseId) primaryAction.addEventListener('click', () => rollbackProject(project, primaryAction));
  else primaryAction.addEventListener('click', () => openDeployDialog(project).catch(showError));
  actions.append(primaryAction);
  const logsPageLink = element('a', 'btn btn-ghost btn-sm', 'Logs');
  logsPageLink.href = `/projects/${encodeURIComponent(project.slug)}/logs`;
  actions.append(logsPageLink);
  const menu = element('details', 'project-actions-menu');
  const menuSummary = element('summary', '', '⋯');
  menuSummary.setAttribute('aria-label', `จัดการ ${project.name}`);
  const actionList = element('div', 'project-action-list');
  const closeMenu = (callback) => (...args) => {
    menu.open = false;
    return callback(...args);
  };
  menu.addEventListener('toggle', () => {
    row.classList.toggle('menu-open', menu.open);
    if (menu.open) $$('details.project-actions-menu[open]').forEach((otherMenu) => {
      if (otherMenu !== menu) otherMenu.open = false;
    });
  });
  const syncLatest = element('button', 'secondary', 'Sync latest');
  syncLatest.type = 'button';
  syncLatest.addEventListener('click', closeMenu(() => syncExistingProject(project, syncLatest).catch(showError)));
  actionList.append(syncLatest);
  const deploy = element('button', 'secondary', 'สร้าง release');
  deploy.type = 'button';
  deploy.disabled = sync.status !== 'synced';
  deploy.addEventListener('click', closeMenu(() => openDeployDialog(project).catch(showError)));
  actionList.append(deploy);
  if (latestRelease) {
    const logs = element('button', 'secondary', 'ดู log');
    logs.type = 'button';
    logs.addEventListener('click', closeMenu(() => openDeploymentLog(project, latestRelease)));
    actionList.append(logs);
  }
  const domain = element('button', 'secondary', 'จัดการ domain');
  domain.type = 'button';
  domain.addEventListener('click', closeMenu(() => openDomainDialog(project)));
  actionList.append(domain);
  const hooks = element('button', 'secondary', 'แจ้งเตือน');
  hooks.type = 'button';
  hooks.addEventListener('click', closeMenu(() => openNotificationHookDialog(project).catch(showError)));
  actionList.append(hooks);
  const logsPage = element('a', 'secondary button', 'Logs');
  logsPage.href = `/projects/${encodeURIComponent(project.slug)}/logs`;
  actionList.append(logsPage);
  const edit = element('a', 'secondary button', 'แก้ไข');
  edit.href = `/projects/${encodeURIComponent(project.slug)}/edit`;
  actionList.append(edit);
  if (deployment.previousReleaseId) {
    const rollback = element('button', 'secondary', 'ย้อนกลับ');
    rollback.type = 'button';
    rollback.addEventListener('click', closeMenu(() => rollbackProject(project, rollback)));
    actionList.append(rollback);
  }
  const divider = element('div', 'project-action-divider');
  divider.setAttribute('role', 'separator');
  const remove = element('button', 'project-action-danger', 'ลบโปรเจกต์');
  remove.type = 'button';
  remove.addEventListener('click', closeMenu(() => deleteProject(project, remove)));
  actionList.append(divider, remove);
  menu.append(menuSummary, actionList);
  actions.append(menu);
  const side = element('div', 'project-side');
  side.append(actions);
  row.append(copy, side);
  return row;
}

async function syncExistingProject(project, button) {
  const payload = {
    organization: project.organization,
    name: project.name,
    slug: project.slug,
    repository: project.repository,
    directory: project.directory || '/',
    branch: project.branch || 'main',
    port: project.port ?? null,
    runtime: project.runtime || 'node',
    healthCheckEnabled: project.healthCheckEnabled !== false,
    healthCheckPath: project.healthCheckPath || '/',
    protocol: project.protocol || 'https',
    credentialId: project.credentialId || ''
  };
  if (payload.runtime === 'docker-compose') {
    payload.composeFile = project.composeFile || 'compose.yaml';
    payload.composeService = project.composeService || '';
  } else {
    payload.buildScript = project.buildScript ?? '';
    payload.startScript = project.startScript || 'start';
  }
  await withBusy(button, async () => {
    const result = await api('/api/projects/sync', { method: 'POST', body: payload });
    toast(result.project?.sync?.status === 'synced' ? `Synced latest ${payload.branch}` : (result.project?.sync?.detail || 'Project sync queued.'));
    await refresh();
  });
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
    const actions = element('div', 'form-actions');
    actions.append(statusChip('เข้ารหัสแล้ว', 'ready'));
    const remove = element('button', 'secondary danger', 'ลบ');
    remove.type = 'button';
    remove.addEventListener('click', async () => {
      if (!await confirmAction('ลบ credential', `ลบ ${credential.name} หรือไม่? โปรเจคที่ยังเลือกใช้จะลบไม่ได้`, 'ลบ')) return;
      await withBusy(remove, async () => {
        await api(`/api/credentials/${encodeURIComponent(credential.id)}`, { method: 'DELETE', body: {} });
        toast('ลบ credential แล้ว');
        await refresh();
      });
    });
    actions.append(remove);
    row.append(copy, actions);
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
    const console_ = element('button', 'secondary', 'Console');
    console_.type = 'button';
    console_.addEventListener('click', () => { location.href = `/databases/${encodeURIComponent(connection.id)}/console`; });
    side.append(console_, check, remove);
    row.append(copy, side);
    return row;
  }));
}

const CONSOLE_HINTS = Object.freeze({
  postgresql: { hint: 'SQL เช่น SELECT * FROM users LIMIT 10 — กด Run หรือ Ctrl+Enter', placeholder: 'SELECT now();' },
  mysql: { hint: 'SQL เช่น SHOW TABLES หรือ SELECT * FROM users LIMIT 10 — กด Run หรือ Ctrl+Enter', placeholder: 'SELECT version();' },
  mongodb: { hint: 'Command JSON เช่น {"find":"users","limit":10} หรือ {"listCollections":1}', placeholder: '{"listCollections": 1}' },
  redis: { hint: 'คำสั่ง Redis เช่น GET mykey, SCAN 0, HGETALL user:1', placeholder: 'PING' }
});
const CONSOLE_DESTRUCTIVE = /\b(drop|truncate|flushall|flushdb|dropdatabase|deletemany)\b/i;

async function renderDatabaseConsole() {
  const payload = await api('/api/databases');
  state.databases = payload.connections || [];
  const connection = state.databases.find((item) => item.id === editSlug);
  if (!connection) {
    $('#console-title').textContent = 'ไม่พบ connector';
    $('#console-subtitle').textContent = 'connector นี้อาจถูกลบไปแล้ว — กลับไปหน้า Databases';
    $('#console-editor-panel').hidden = true;
    return;
  }
  const driver = payload.drivers?.[connection.provider];
  const hints = CONSOLE_HINTS[connection.provider] ?? { hint: '', placeholder: '' };
  $('#console-title').textContent = connection.name;
  $('#console-subtitle').textContent = `${connection.provider} · ${connection.host}:${connection.port}${connection.database ? ` · ${connection.database}` : ''}${connection.username ? ` · ${connection.username}` : ''}`;
  $('#console-hint').textContent = hints.hint;
  $('#console-statement').placeholder = hints.placeholder;
  if (driver && !driver.installed) {
    $('#console-driver-warning').hidden = false;
    $('#console-driver-detail').textContent = `Console ของ ${connection.provider} ต้องติดตั้ง driver "${driver.package}" ก่อน (optional dependency — core ของ Portal ไม่ต้องมีก็ทำงานได้)`;
    $('#console-driver-command').textContent = `npm install ${driver.package}`;
    $('#console-run').disabled = true;
    return;
  }
  const form = $('#console-form');
  if (form.dataset.bound) return;
  form.dataset.bound = '1';
  $('#console-statement').addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      form.requestSubmit();
    }
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const statement = $('#console-statement').value.trim();
    if (!statement) return;
    const allowWrite = $('#console-allow-write').checked;
    if (allowWrite && CONSOLE_DESTRUCTIVE.test(statement)) {
      if (!await confirmAction('คำสั่งอันตราย', 'คำสั่งนี้อาจลบหรือแก้ข้อมูลถาวร รันต่อหรือไม่?', 'รันเลย')) return;
    }
    const run = $('#console-run');
    try {
      await withBusy(run, async () => {
        const outcome = await api(`/api/databases/${encodeURIComponent(connection.id)}/query`, { method: 'POST', body: { statement, allowWrite } });
        renderConsoleResult(outcome.result);
      });
    } catch (error) {
      $('#console-meta').textContent = 'คำสั่งล้มเหลว';
      $('#console-results').replaceChildren(element('p', 'form-error', error.message || String(error)));
    }
  });
}

function renderConsoleResult(result) {
  const meta = [`${result.rowCount} แถว`, `${result.durationMs} ms`];
  if (result.command) meta.push(result.command);
  if (result.truncated) meta.push('แสดงเฉพาะ 200 แถวแรก');
  $('#console-meta').textContent = meta.join(' · ');
  const root = $('#console-results');
  if (!result.rows?.length) {
    root.replaceChildren(element('p', 'muted', result.notice || 'คำสั่งสำเร็จ — ไม่มีแถวข้อมูลส่งกลับ'));
    return;
  }
  const table = element('table', 'console-table');
  const head = element('thead');
  const headRow = element('tr');
  (result.columns ?? []).forEach((name) => headRow.append(element('th', '', name)));
  head.append(headRow);
  const body = element('tbody');
  for (const cells of result.rows) {
    const tr = element('tr');
    cells.forEach((cell) => tr.append(element('td', cell === null ? 'muted' : '', cell === null ? 'NULL' : String(cell))));
    body.append(tr);
  }
  table.append(head, body);
  const wrap = element('div', 'console-table-wrap');
  wrap.append(table);
  root.replaceChildren(wrap);
  if (result.notice) root.append(element('p', 'muted', result.notice));
}

// Mail UI preview: simulated "after setup" data. Categories are fixed lanes;
// groups are created automatically from the sender domain (*@github.com).
const MAIL_CATEGORIES = Object.freeze([
  { id: 'inbox', label: 'Inbox', icon: 'mail' },
  { id: 'alerts', label: 'Alerts', icon: 'alert' },
  { id: 'deploys', label: 'Deploys', icon: 'zap' },
  { id: 'certs', label: 'Certificates', icon: 'shield' },
  { id: 'human', label: 'Human', icon: 'users' }
]);
const MAIL_GROUPS = Object.freeze([
  { id: 'github', label: 'GitHub', icon: 'github', match: '*@github.com' }
]);
const MAIL_DEMO = [
  {
    id: 'm1', category: 'certs', level: 'warning', chip: { text: 'CERT', tone: 'warn' }, avatar: '🔒', unread: true,
    from: "Let's Encrypt", address: 'noreply@letsencrypt.org', time: 'เมื่อสักครู่',
    subject: 'TLS certificate จะหมดอายุใน 7 วัน — docs.example.com',
    preview: 'Certificate ของ docs.example.com จะหมดอายุวันที่ 2026-08-23 ต่ออายุก่อนเพื่อเลี่ยง downtime…',
    body: [
      'สวัสดีครับ',
      'Certificate ของโดเมนด้านล่างจะหมดอายุภายใน 7 วัน (2026-08-23) กรุณาต่ออายุก่อนถึงกำหนด ไม่เช่นนั้นผู้เข้าชมเว็บไซต์จะพบข้อผิดพลาดด้านความปลอดภัย',
      'โดเมนที่ได้รับผลกระทบ: docs.example.com',
      '— The Let’s Encrypt Team'
    ],
    related: [
      { badge: 'renewed', tone: 'ready', text: 'ต่ออายุครั้งก่อน — docs.example.com', when: '2026-05-22' },
      { badge: 'nginx', tone: 'muted', text: 'Server block ใช้งานอยู่ → 127.0.0.1:3214', when: 'stable' }
    ]
  },
  {
    id: 'm2', category: 'alerts', level: 'critical', chip: { text: 'ALERT', tone: 'danger' }, avatar: '⚠️', unread: true,
    from: 'Uptime Monitor', address: 'alerts@ops.example.com', time: '4 นาที',
    subject: '[CRITICAL] auth-gateway error rate สูง — 5xx เกิน 12%',
    preview: 'Instance 127.0.0.1:3213 ตอบ HTTP 5xx จำนวน 34 จาก 60 requests ล่าสุด เริ่มตั้งแต่ 22:15…',
    body: ['Instance 127.0.0.1:3213 ตอบ HTTP 5xx จำนวน 34 จาก 60 requests ล่าสุด (12.4%)', 'เริ่ม firing ตั้งแต่ 22:15 — ตรวจสอบ log ของ service auth-gateway'],
    related: [{ badge: 'logs', tone: 'muted', text: 'ดู runtime log ของ auth-gateway ได้จากหน้า Projects', when: 'ตอนนี้' }]
  },
  {
    id: 'm3', category: 'deploys', level: 'info', chip: { text: 'DEPLOY', tone: 'info' }, avatar: '🚀', unread: true,
    from: 'Dashboard Portal', address: 'portal@ops.example.com', time: '18 นาที',
    subject: 'Deploy สำเร็จ — my-api v1.4.2 · health check ผ่านใน 4.2s',
    preview: 'Release a3f4c21 ถูก activate บนพอร์ต 3210 เก็บ release เดิม v1.4.1 ไว้สำหรับ rollback…',
    body: ['Release a3f4c21 ถูก activate บนพอร์ต 3210', 'Release เดิม v1.4.1 ยังเก็บไว้สำหรับ rollback หนึ่งคลิก'],
    related: [{ badge: 'deploy', tone: 'ready', text: 'Job สำเร็จ — candidate health check ผ่าน', when: '18 นาที' }]
  },
  {
    id: 'm4', category: 'github', level: 'info', chip: { text: 'GITHUB', tone: 'github' }, avatar: '🐙', unread: true,
    from: 'github.com', address: 'notifications@github.com', time: '1 ชม.',
    subject: '[rapter/my-api] PR #42 — Add rate limiting middleware',
    preview: 'alice เปิด pull request · 3 files changed · +142 −18 · CI ผ่าน…',
    body: ['alice เปิด pull request ใน rapter/my-api', '3 files changed · +142 −18 · CI ผ่านทุกขั้น', 'Review ได้ที่ github.com/rapter/my-api/pull/42']
  },
  {
    id: 'm5', category: 'human', level: 'normal', chip: { text: 'HUMAN', tone: 'human' }, avatar: 'AL', unread: false,
    from: 'alice@example.com', address: 'alice@example.com', time: '2 ชม.',
    subject: 'ขอเลื่อนเปิดตัว API ใหม่เป็นวันพฤหัสได้ไหม?',
    preview: 'ทีม frontend พร้อมแล้ว คิดว่าไปวันพฤหัส 14:00 UTC สำหรับ go-live…',
    body: ['สวัสดีค่ะ ทีม frontend พร้อมแล้ว', 'คิดว่าไปวันพฤหัส 14:00 UTC สำหรับ go-live ดีไหมคะ?']
  },
  {
    id: 'm6', category: 'deploys', level: 'info', chip: { text: 'DEPLOY', tone: 'info' }, avatar: '↩️', unread: false,
    from: 'Dashboard Portal', address: 'portal@ops.example.com', time: '3 ชม.',
    subject: 'Rollback สำเร็จ — landing-page → v0.8.9',
    preview: 'Candidate v0.9.1 ไม่ผ่าน health check 3 ครั้งติด ระบบย้อนกลับให้เรียบร้อย…',
    body: ['Candidate v0.9.1 ไม่ผ่าน health check 3 ครั้งติด', 'ระบบย้อนกลับเป็น v0.8.9 โดย release ที่ใช้งานอยู่ไม่สะดุด']
  },
  {
    id: 'm7', category: 'github', level: 'normal', chip: { text: 'GITHUB', tone: 'github' }, avatar: '🐙', unread: false,
    from: 'github.com', address: 'notifications@github.com', time: 'เมื่อวาน',
    subject: '[rapter/worker] Issue #17 — Memory leak in queue processor',
    preview: 'bob commented: reproduce ได้บน staging แนบ heap dump มาให้…',
    body: ['bob commented: reproduce ได้บน staging', 'แนบ heap dump ไว้ใน issue แล้ว']
  },
  {
    id: 'm8', category: 'human', level: 'normal', chip: { text: 'HUMAN', tone: 'human' }, avatar: 'SM', unread: false,
    from: 'sam@partner.io', address: 'sam@partner.io', time: 'เมื่อวาน',
    subject: 'Integration webhook — แนบ sample payload มาให้',
    preview: 'นี่คือ payload format ที่เราจะส่ง สังเกต signature header ด้วยนะครับ…',
    body: ['นี่คือ payload format ที่เราจะส่งครับ', 'สังเกต signature header X-Partner-Signature สำหรับ verify ด้วย']
  }
];
const mailState = { category: 'inbox', selected: 'm1', search: '' };

function mailMessagesFor(category) {
  const all = MAIL_DEMO.filter((message) => {
    const query = mailState.search.toLowerCase();
    if (query && !`${message.subject} ${message.preview} ${message.from}`.toLowerCase().includes(query)) return false;
    return category === 'inbox' || message.category === category;
  });
  return all;
}

async function renderMail() {
  const preview = $('#mail-preview');
  const management = $('#mail-management');
  if (!preview || !management) return;
  try {
    const settings = await api('/api/mail');
    const configured = settings.mail.configure?.status === 'configured';
    paintMailMode(configured);
    renderMailSetupNotice(settings.mail);
    if (!configured) renderMailPreview();
  } catch {
    paintMailMode(false, 'ไม่สามารถตรวจสถานะ Mail ได้');
    renderMailPreview();
  }
}

function paintMailMode(configured, unavailableMessage = '') {
  const preview = $('#mail-preview');
  const management = $('#mail-management');
  const status = $('#mail-page-status');
  preview.hidden = configured;
  management.hidden = !configured;
  if (!status) return;
  status.className = `status-chip ${configured ? 'ready' : 'needs'}`;
  status.textContent = unavailableMessage || (configured ? 'Mail service พร้อมจัดการ' : 'ตัวอย่างก่อนติดตั้ง');
}

function renderMailPreview() {
  renderMailNav();
  renderMailRows();
  renderMailReader();
  const search = $('#mail-search');
  if (search.dataset.bound) return;
  search.dataset.bound = '1';
  search.addEventListener('input', () => {
    mailState.search = search.value.trim();
    renderMailRows();
  });
  $('#mail-compose-open').addEventListener('click', () => toggleMailCompose(true));
  $('#mail-compose-close').addEventListener('click', () => toggleMailCompose(false));
  $('#mail-compose-overlay').addEventListener('click', () => toggleMailCompose(false));
  $('#mail-compose-form').addEventListener('submit', (event) => {
    event.preventDefault();
    toggleMailCompose(false);
    toast('ตัวอย่างก่อนติดตั้ง — ยังไม่ได้ส่งอีเมลจริง');
  });
}

function renderMailSetupNotice(mail) {
  const notice = $('#mail-setup-notice');
  if (!notice) return;
  const configured = mail.configure?.status === 'configured';
  renderMailMailboxCard(mail);
  const text = element('span');
  const link = element('a', 'secondary button', configured ? 'จัดการ Mail Setup' : 'เริ่มติดตั้ง →');
  link.href = configured ? '/mail/setup?step=6' : '/mail/setup';
  if (configured) {
    text.append(
      statusChip(mail.configure.simulated ? 'ติดตั้งแล้ว (จำลอง)' : 'ติดตั้งแล้ว', 'ready'),
      element('span', '', ` ${mail.hostname} · ${mail.domains.length} โดเมน · ${mail.mailboxes.length} mailbox`)
    );
  } else {
    text.append(element('span', '', 'ยังไม่ได้ติดตั้ง mail service — ด้านล่างเป็นตัวอย่าง inbox ก่อนติดตั้ง ใช้ Mail Setup เพื่อติดตั้งจริง'));
  }
  notice.replaceChildren(text, link);
  notice.hidden = false;
}

function renderMailMailboxCard(mail) {
  const name = $('#mail-mailbox-name');
  const status = $('#mail-mailbox-status');
  const manage = $('#mail-mailbox-manage');
  if (!name || !status || !manage) return;
  const mailboxes = mail.mailboxes ?? [];
  const configured = mail.configure?.status === 'configured';
  manage.href = configured ? '/mail/setup?step=6' : '/mail/setup';
  manage.textContent = configured ? 'จัดการ mailbox' : 'ตั้งค่า Mail ก่อน';
  if (!mailboxes.length) {
    name.textContent = 'ยังไม่มี mailbox';
    status.textContent = configured ? 'สร้างอีเมลใหม่ได้จาก Mail Setup' : 'ต้องติดตั้งและตั้งค่า Mail ก่อน';
    status.classList.remove('mail-mailbox-ok');
    return;
  }
  const first = mailboxes[0];
  name.textContent = mailboxes.length === 1 ? `${first.localPart}@${first.domain}` : `${first.localPart}@${first.domain} และอีก ${mailboxes.length - 1} mailbox`;
  status.textContent = `● ${mailboxes.length} mailbox พร้อมจัดการ`;
  status.classList.add('mail-mailbox-ok');
}

function toggleMailCompose(open) {
  $('#mail-compose').hidden = !open;
  $('#mail-compose-overlay').hidden = !open;
}

function renderMailNav() {
  const unreadIn = (category) => MAIL_DEMO.filter((m) => m.unread && (category === 'inbox' || m.category === category)).length;
  const item = (entry, isGroup = false) => {
    const button = element('button', `mail-nav-item${mailState.category === entry.id ? ' active' : ''}`);
    button.type = 'button';
    button.append(icon(entry.icon), element('span', '', entry.label));
    const unread = unreadIn(entry.id);
    if (unread) button.append(element('span', `count${entry.id === 'alerts' ? ' danger' : ''}`, String(unread)));
    if (isGroup) button.title = `กลุ่มอัตโนมัติจาก ${entry.match}`;
    button.addEventListener('click', () => {
      mailState.category = entry.id;
      const first = mailMessagesFor(entry.id)[0];
      mailState.selected = first?.id ?? null;
      renderMailPreview();
    });
    return button;
  };
  $('#mail-categories').replaceChildren(...MAIL_CATEGORIES.map((entry) => item(entry)));
  $('#mail-groups').replaceChildren(...MAIL_GROUPS.map((entry) => item(entry, true)));
}

function renderMailRows() {
  const messages = mailMessagesFor(mailState.category);
  const active = [...MAIL_CATEGORIES, ...MAIL_GROUPS].find((entry) => entry.id === mailState.category);
  $('#mail-list-title').textContent = active?.label ?? 'Inbox';
  $('#mail-list-count').textContent = `${messages.filter((m) => m.unread).length} ยังไม่อ่าน`;
  const root = $('#mail-rows');
  if (!messages.length) {
    root.replaceChildren(element('div', 'empty-state', 'ไม่พบอีเมลที่ตรงกับเงื่อนไข'));
    return;
  }
  root.replaceChildren(...messages.map((message) => {
    const row = element('article', `mail-row level-${message.level}${message.unread ? ' unread' : ''}${mailState.selected === message.id ? ' selected' : ''}`);
    row.tabIndex = 0;
    const body = element('div', 'mail-row-body');
    const meta = element('div', 'mail-row-meta');
    meta.append(element('span', `mail-chip ${message.chip.tone}`, message.chip.text), element('span', 'mail-from', message.from), element('span', 'mail-time', message.time));
    body.append(meta, element('div', 'mail-row-subject', message.subject), element('div', 'mail-row-preview', message.preview));
    row.append(element('div', 'mail-row-avatar', message.avatar), body);
    const select = () => {
      mailState.selected = message.id;
      message.unread = false;
      renderMailPreview();
    };
    row.addEventListener('click', select);
    row.addEventListener('keydown', (event) => { if (event.key === 'Enter') select(); });
    return row;
  }));
}

function renderMailReader() {
  const root = $('#mail-reader');
  const message = MAIL_DEMO.find((item) => item.id === mailState.selected);
  if (!message) {
    root.replaceChildren(element('div', 'mail-reader-empty', 'เลือกอีเมลจากรายการเพื่ออ่าน'));
    return;
  }
  const demoAction = (label, iconName) => {
    const button = element('button', 'secondary');
    button.type = 'button';
    button.append(icon(iconName), element('span', '', label));
    button.addEventListener('click', () => toast('ตัวอย่างก่อนติดตั้ง — ปุ่มนี้ยังไม่ทำงานจริง'));
    return button;
  };
  const actions = element('div', 'mail-reader-actions');
  actions.append(demoAction('Archive', 'archive'), demoAction('Snooze', 'clock'), demoAction('สร้าง rule', 'sliders'), demoAction('ตอบกลับ', 'send'));
  const subject = element('h2', 'mail-reader-subject');
  subject.append(element('span', `mail-chip ${message.chip.tone}`, message.chip.text), element('span', '', message.subject));
  const fromLine = element('div', 'mail-reader-from');
  const fromCopy = element('div');
  fromCopy.append(element('strong', '', message.from), element('small', '', `${message.address} · ถึง portal@ops.example.com · ${message.time}`));
  fromLine.append(element('div', 'mail-row-avatar', message.avatar), fromCopy);
  const content = element('article', 'mail-content');
  content.append(...message.body.map((paragraph) => element('p', '', paragraph)));
  root.replaceChildren(actions, subject, fromLine, content);
  if (message.related?.length) {
    const related = element('div', 'mail-related');
    related.append(element('h3', '', '🔗 เหตุการณ์ที่เกี่ยวข้องจาก Dashboard Portal'));
    for (const entry of message.related) {
      const row = element('div', 'mail-related-item');
      row.append(statusChip(entry.badge, entry.tone), element('span', '', entry.text), element('span', 'when', entry.when));
      related.append(row);
    }
    root.append(related);
  }
}

// ---- Mail Setup Wizard (7 steps per docs/design/mail-setup-wizard.md) ----
const MAIL_OUTBOUND_STORAGE = 'hostmgr.mailOutbound';
const wizard = { step: 1, settings: null, outbound: null, inbound: null, newDomain: '' };

const WIZARD_STEPS = Object.freeze([
  { id: 1, label: 'ตรวจพอร์ต mail' },
  { id: 2, label: 'Hostname + Domain' },
  { id: 3, label: 'DNS records' },
  { id: 4, label: 'โหมดส่งออก' },
  { id: 5, label: 'ติดตั้ง' },
  { id: 6, label: 'Mailbox' },
  { id: 7, label: 'ทดสอบส่ง' }
]);

const MAIL_DNS_STATUS = Object.freeze({
  pending: { label: 'ยังไม่ตรวจ', variant: 'muted' },
  checking: { label: 'กำลังตรวจ', variant: 'muted' },
  verified: { label: 'ตรวจผ่าน', variant: 'ready' },
  mismatch: { label: 'ค่าไม่ตรง', variant: 'needs' },
  not_found: { label: 'ไม่พบ record', variant: 'needs' },
  error: { label: 'ตรวจไม่สำเร็จ', variant: 'needs' },
  proxied: { label: 'โดน proxy', variant: 'needs' },
  ok: { label: 'ตรวจผ่าน', variant: 'ready' }
});

function wizardStepDone(step) {
  const mail = wizard.settings?.mail;
  if (!mail) return false;
  if (step === 1) return Boolean(wizard.outbound && wizard.inbound);
  if (step === 2) return Boolean(mail.hostname && mail.domains.length);
  if (step === 3) return mail.domains.length > 0 && mail.domains.every((domain) => ['mx', 'spf', 'dkim', 'dmarc'].every((kind) => domain.dns?.[kind]?.status === 'verified'));
  if (step === 4) return Boolean(mail.outboundMode && (mail.outboundMode === 'direct' || mail.relay?.hasPassword));
  if (step === 5) return mail.configure?.status === 'configured';
  if (step === 6) return mail.mailboxes.length > 0;
  if (step === 7) return mail.lastTest?.status === 'passed';
  return false;
}

function wizardStepUnlocked(step) {
  if (step === 1) return true;
  if (step === 2) return wizardStepDone(1) || wizardStepDone(2);
  if (step === 3 || step === 4) return wizardStepDone(2);
  if (step === 5) return wizardStepDone(2) && wizardStepDone(4);
  if (step === 6) return wizardStepDone(5);
  if (step === 7) return wizardStepDone(5);
  return false;
}

async function reloadWizardSettings() {
  wizard.settings = await api('/api/mail');
}

async function renderMailSetup() {
  if (!$('#wizard-body')) return;
  try {
    const cached = JSON.parse(sessionStorage.getItem(MAIL_OUTBOUND_STORAGE) || 'null');
    wizard.outbound = cached?.outbound ?? cached;
    wizard.inbound = cached?.inbound ?? null;
  } catch { wizard.outbound = null; wizard.inbound = null; }
  await reloadWizardSettings();
  wizard.outbound ??= wizard.settings?.mail?.readiness?.outbound ?? null;
  wizard.inbound ??= wizard.settings?.mail?.readiness?.inbound ?? null;
  const firstOpen = WIZARD_STEPS.find((step) => wizardStepUnlocked(step.id) && !wizardStepDone(step.id));
  const requestedStep = Number(new URLSearchParams(window.location.search).get('step'));
  const requested = WIZARD_STEPS.find((step) => step.id === requestedStep && wizardStepUnlocked(step.id));
  wizard.step = requested?.id ?? firstOpen?.id ?? 7;
  paintWizard();
}

function paintWizard() {
  const nav = $('#wizard-steps');
  const completeCount = WIZARD_STEPS.filter((step) => wizardStepDone(step.id)).length;
  const progress = element('div', 'wizard-progress-summary');
  progress.append(
    element('span', 'wizard-progress-kicker', 'Setup progress'),
    element('strong', 'wizard-progress-count', `${wizard.step} / ${WIZARD_STEPS.length}`),
    element('span', 'wizard-progress-description', `${completeCount} ขั้นตอนเสร็จแล้ว`)
  );
  nav.replaceChildren(progress, ...WIZARD_STEPS.map((step) => {
    const chip = element('button', 'wizard-step-chip');
    chip.type = 'button';
    const complete = wizardStepDone(step.id);
    const unlocked = wizardStepUnlocked(step.id);
    const active = step.id === wizard.step;
    const state = complete ? 'done' : active ? 'active' : unlocked ? 'next' : 'locked';
    chip.dataset.state = state;
    if (active) chip.classList.add('active');
    if (complete) chip.classList.add('done');
    chip.disabled = !unlocked;
    if (active) chip.setAttribute('aria-current', 'step');
    const copy = element('span', 'wizard-step-copy');
    const status = complete ? 'เสร็จแล้ว' : active ? 'กำลังตั้งค่า' : unlocked ? 'พร้อมทำต่อ' : 'รอขั้นก่อนหน้า';
    copy.append(element('span', 'wizard-step-label', step.label), element('span', 'wizard-step-status', status));
    chip.append(element('span', 'wizard-step-number', complete ? '✓' : String(step.id)), copy);
    chip.addEventListener('click', () => { wizard.step = step.id; paintWizard(); });
    return chip;
  }));
  const body = $('#wizard-body');
  const renderers = { 1: wizardStepOutbound, 2: wizardStepIdentity, 3: wizardStepDns, 4: wizardStepMode, 5: wizardStepInstall, 6: wizardStepMailbox, 7: wizardStepTest };
  body.replaceChildren(renderers[wizard.step]());
}

function wizardPanel(step, title, subtitle) {
  const panel = element('section', 'panel wizard-panel');
  const head = element('header', 'panel-head');
  head.append(element('span', 'wizard-panel-kicker', `ขั้นตอน ${step} จาก ${WIZARD_STEPS.length}`), element('h2', '', title), element('p', '', subtitle));
  panel.append(head);
  return panel;
}

function wizardNav(panel, { back = true, next = true, nextLabel = 'ถัดไป →', nextEnabled = true, onNext = null } = {}) {
  const actions = element('div', 'form-actions wizard-actions');
  if (back && wizard.step > 1) {
    const backButton = element('button', 'secondary', '← ย้อนกลับ');
    backButton.type = 'button';
    backButton.addEventListener('click', () => { wizard.step -= 1; paintWizard(); });
    actions.append(backButton);
  }
  if (next) {
    const nextButton = element('button', '', nextLabel);
    nextButton.type = 'button';
    nextButton.disabled = !nextEnabled;
    nextButton.addEventListener('click', () => {
      if (onNext) return onNext(nextButton);
      wizard.step = Math.min(7, wizard.step + 1);
      paintWizard();
    });
    actions.append(nextButton);
  }
  panel.append(actions);
  return panel;
}

function wizardStepOutbound() {
  const panel = wizardPanel(1, 'ตรวจพอร์ต mail', 'ตรวจ outbound SMTP จริง และอ่าน policy firewall ขาเข้าของ host เพื่อเปิดเฉพาะ service ที่ได้รับอนุญาต');
  const results = element('section', 'tool-list');
  if (wizard.outbound) {
    for (const entry of wizard.outbound.ports ?? []) {
      const row = element('article', 'tool-row');
      const copy = element('div');
      const status = MAIL_PORT_STATUS[entry.status] ?? { label: entry.status, variant: 'muted' };
      copy.append(element('h3', '', `พอร์ต ${entry.port}`), element('p', 'muted', entry.status === 'open' ? `ตอบกลับจาก ${entry.target} · ${entry.latencyMs} ms` : (entry.detail || 'ไม่สามารถเชื่อมต่อได้')));
      const side = element('div');
      side.append(statusChip(status.label, status.variant));
      row.append(copy, side);
      results.append(row);
    }
    const plan = MAIL_PLAN_GUIDE[wizard.outbound.recommendation?.mode];
    const advice = element('article', 'tool-row');
    const adviceCopy = element('div');
    adviceCopy.append(element('h3', '', `คำแนะนำ: ${plan?.label ?? '—'}`), element('p', 'muted', plan?.detail ?? ''), element('small', '', `ตรวจเมื่อ ${new Date(wizard.outbound.checkedAt).toLocaleString()}`));
    advice.append(adviceCopy);
    results.append(advice);
    if ((wizard.outbound.ports ?? []).find((entry) => entry.port === 25)?.status !== 'open') {
      results.append(element('p', 'muted', '⚠ พอร์ต 25 ขาออกถูกบล็อค — มักแปลว่า inbound 25 อาจถูกบล็อคด้วย หากต้องการรับเมลเข้า ติดต่อผู้ให้บริการเครือข่ายของ host นี้'));
    }
    results.append(element('h3', 'wizard-subhead', 'ขาเข้า — policy firewall บน host'));
    for (const entry of wizard.inbound?.ports ?? []) {
      const row = element('article', 'tool-row');
      const status = entry.status === 'allowed' ? { label: 'อนุญาต', variant: 'ready' } : entry.status === 'blocked' ? { label: 'ถูกบล็อค', variant: 'needs' } : { label: 'ยังไม่ยืนยัน', variant: 'muted' };
      row.append(element('div', '', `พอร์ต ${entry.port} · ${entry.detail || entry.source || 'ไม่ทราบ policy'}`), statusChip(status.label, status.variant));
      results.append(row);
    }
    results.append(element('p', 'muted', 'ผลขาเข้าตรวจได้เพียง firewall ของเครื่องนี้; network/provider ภายนอกต้องพิสูจน์ด้วยการส่ง mail จริง และ Portal จะไม่เปิดพอร์ตที่ผลเป็น blocked หรือ unknown'));
  } else {
    results.append(element('p', 'muted', 'ยังไม่เคยตรวจ — กดปุ่มด้านล่างเพื่อทดสอบ outbound 25/587/2525 และ firewall ขาเข้า 25/587/993'));
  }
  panel.append(results);
  const check = element('button', 'secondary', 'ตรวจสอบความพร้อม mail');
  check.type = 'button';
  check.addEventListener('click', async () => {
    try {
      await withBusy(check, async () => {
        const report = await api('/api/mail/readiness-check', { method: 'POST', body: {} });
        wizard.outbound = report.outbound;
        wizard.inbound = report.inbound;
        sessionStorage.setItem(MAIL_OUTBOUND_STORAGE, JSON.stringify(report));
        paintWizard();
      });
    } catch (error) { showError(error); }
  });
  const checkRow = element('div', 'form-actions');
  checkRow.append(check);
  panel.append(checkRow);
  return wizardNav(panel, { nextEnabled: Boolean(wizard.outbound && wizard.inbound) });
}

function wizardStepIdentity() {
  const mail = wizard.settings.mail;
  const suggestions = wizard.settings.suggestions ?? { hostname: null, domains: [] };
  const panel = wizardPanel(2, 'Mail hostname และ Mail domain', 'hostname มีค่าเดียวต่อ host (PTR/HELO/TLS) ส่วน mail domain ใช้เป็น @domain ของอีเมล เพิ่มได้หลายโดเมน');
  const form = element('form', 'form-grid wizard-host-form');
  const hostLabel = element('label', '', 'Mail hostname (เช่น mail.example.com)');
  hostLabel.classList.add('wizard-primary-field');
  const hostInput = element('input');
  hostInput.value = mail.hostname ?? suggestions.hostname ?? '';
  hostInput.placeholder = 'mail.example.com';
  hostInput.maxLength = 253;
  hostLabel.append(hostInput);
  const saveHost = element('button', '', mail.hostname ? 'บันทึก hostname ใหม่' : 'บันทึก hostname');
  saveHost.type = 'submit';
  const hostActions = element('div', 'form-actions wizard-inline-actions');
  hostActions.append(saveHost);
  const hostControl = element('div', 'wizard-host-control');
  hostControl.append(hostLabel, hostActions);
  form.append(hostControl);
  if (mail.hostnameCheck) {
    const status = MAIL_DNS_STATUS[mail.hostnameCheck.status] ?? { label: mail.hostnameCheck.status, variant: 'muted' };
    const line = element('p', 'muted');
    line.append(statusChip(status.label, status.variant), element('span', '', ` A/AAAA ของ hostname ${mail.hostnameCheck.detail ? `— ${mail.hostnameCheck.detail}` : ''}`));
    form.append(line);
  }
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await withBusy(saveHost, async () => {
        wizard.settings = await api('/api/mail/hostname', { method: 'POST', body: { hostname: hostInput.value.trim() } });
        toast('บันทึก mail hostname แล้ว');
        paintWizard();
      });
    } catch (error) { showError(error); }
  });
  panel.append(form);

  const domainsHead = element('h3', 'wizard-subhead', `Mail domain(s) — เลือกแล้ว ${mail.domains.length}/${wizard.settings.maxDomains}`);
  panel.append(domainsHead);
  const list = element('section', 'tool-list wizard-domain-list');
  for (const entry of mail.domains) {
    const row = element('article', 'tool-row wizard-domain-row');
    const copy = element('div', 'wizard-domain-copy');
    copy.append(element('h3', '', entry.domain), element('p', 'muted', `DKIM selector: ${entry.dkimSelector ?? '—'}`));
    const side = element('div');
    const remove = element('button', 'secondary danger', 'ลบ');
    remove.type = 'button';
    remove.addEventListener('click', async () => {
      if (!await confirmAction('ลบ mail domain', `ลบ ${entry.domain} ออกจาก mail service หรือไม่?`, 'ลบ')) return;
      try {
        wizard.settings = await api(`/api/mail/domains/${encodeURIComponent(entry.domain)}`, { method: 'DELETE', body: {} });
        paintWizard();
      } catch (error) { showError(error); }
    });
    side.append(statusChip('พร้อม', 'ready'), remove);
    row.append(copy, side);
    list.append(row);
  }
  const known = new Set(mail.domains.map((entry) => entry.domain));
  for (const suggestion of (suggestions.domains ?? []).filter((domain) => !known.has(domain)).slice(0, 5)) {
    const row = element('article', 'tool-row wizard-domain-row wizard-domain-suggestion');
    const copy = element('div');
    copy.append(element('h3', '', suggestion), element('p', 'muted', 'แนะนำจากโดเมนโปรเจคที่มีอยู่'));
    const add = element('button', 'secondary', 'ใช้โดเมนนี้');
    add.type = 'button';
    add.addEventListener('click', () => addMailDomain(suggestion, add));
    const side = element('div');
    side.append(add);
    row.append(copy, side);
    list.append(row);
  }
  panel.append(list);

  const addForm = element('form', 'form-grid wizard-add-domain');
  const addLabel = element('label', '', 'เพิ่มโดเมนใหม่ (พิมพ์เองได้ ไม่ต้องมีโปรเจค)');
  const addInput = element('input');
  addInput.placeholder = 'example.com';
  addInput.maxLength = 253;
  addLabel.append(addInput);
  const addButton = element('button', 'secondary', '+ เพิ่มโดเมน');
  addButton.type = 'submit';
  const addActions = element('div', 'form-actions');
  addActions.append(addButton);
  addForm.append(addLabel, addActions);
  addForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (addInput.value.trim()) addMailDomain(addInput.value.trim(), addButton);
  });
  panel.append(addForm);
  return wizardNav(panel, { nextEnabled: wizardStepDone(2) });
}

async function addMailDomain(domain, button) {
  try {
    await withBusy(button, async () => {
      wizard.settings = await api('/api/mail/domains', { method: 'POST', body: { domain } });
      toast(`เพิ่ม ${domain} พร้อม DKIM key แล้ว`);
      paintWizard();
    });
  } catch (error) { showError(error); }
}

function dnsRecordRow(domainName, kind, title, record, state) {
  const row = element('article', 'tool-row wizard-record');
  const copy = element('div', 'wizard-record-copy');
  const status = MAIL_DNS_STATUS[state?.status ?? 'pending'] ?? MAIL_DNS_STATUS.pending;
  const provider = record.provider ?? dnsProviderRecord(record, domainName);
  const fields = [
    ['Type', provider.type ?? record.type],
    ['Name / Host', provider.host ?? '@'],
    [record.type === 'MX' ? 'Value / Target' : 'Value', provider.value ?? record.value],
    ...(provider.priority === null || provider.priority === undefined ? [] : [['Priority', String(provider.priority)]]),
    ['TTL', provider.ttl ?? 'Auto']
  ];
  const fieldList = element('dl', 'wizard-dns-fields');
  for (const [label, value] of fields) {
    const field = element('div', 'wizard-dns-field');
    if (String(value).length > 90) field.classList.add('wide');
    field.append(element('dt', '', label), element('dd', '', value));
    fieldList.append(field);
  }
  copy.append(element('h3', '', title), element('p', 'muted', `สร้าง record ใหม่ใน DNS zone ของ ${domainName} แล้วกรอกตามช่องด้านล่าง`), fieldList);
  if (state?.detail) copy.append(element('p', 'muted', state.detail));
  const side = element('div', 'wizard-record-side');
  const copyButton = element('button', 'secondary', 'คัดลอก Value');
  copyButton.type = 'button';
  copyButton.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(String(provider.value ?? record.value)); toast('คัดลอก Value แล้ว'); }
    catch { toast('คัดลอกไม่สำเร็จ — เลือกข้อความเองได้', true); }
  });
  const verify = element('button', 'secondary', 'ตรวจสอบ');
  verify.type = 'button';
  verify.addEventListener('click', async () => {
    try {
      await withBusy(verify, async () => {
        wizard.settings = await api(`/api/mail/domains/${encodeURIComponent(domainName)}/dns-check`, { method: 'POST', body: { record: kind } });
        paintWizard();
      });
    } catch (error) { showError(error); }
  });
  side.append(statusChip(status.label, status.variant), copyButton, verify);
  row.append(copy, side);
  return row;
}

function dnsProviderRecord(record, domainName) {
  const name = String(record.name ?? '').replace(/\.$/, '').toLowerCase();
  const domain = String(domainName ?? '').replace(/\.$/, '').toLowerCase();
  const host = name === domain ? '@' : name.endsWith(`.${domain}`) ? name.slice(0, -(domain.length + 1)) : name;
  const mx = record.type === 'MX' ? String(record.value ?? '').match(/\bMX\s+(\d+)\s+(\S+)/i) : null;
  return {
    type: record.type,
    host,
    value: mx ? mx[2].replace(/\.$/, '') : record.value,
    priority: mx ? Number(mx[1]) : null,
    ttl: 'Auto'
  };
}

function wizardStepDns() {
  const mail = wizard.settings.mail;
  const panel = wizardPanel(3, 'DNS records', 'copy ค่าไปวางที่ DNS provider ของโดเมน แล้วกดตรวจสอบทีละรายการ — DNS ใหม่อาจใช้เวลา propagate เป็นชั่วโมง ข้ามไปก่อนแล้วกลับมาตรวจทีหลังได้');
  const guide = element('aside', 'mail-dns-guide');
  guide.append(
    element('strong', '', 'กรอกตามชื่อช่องได้เลย'),
    element('span', '', 'DNS provider บางรายเรียก Name ว่า Host หรือ Record name — เป็นช่องเดียวกัน ใช้ TTL = Auto ได้')
  );
  panel.append(guide);
  for (const entry of mail.domains) {
    panel.append(element('h3', 'wizard-subhead', entry.domain));
    const list = element('section', 'tool-list');
    if (entry.records) {
      list.append(
        dnsRecordRow(entry.domain, 'mx', 'MX', entry.records.mx, entry.dns.mx),
        dnsRecordRow(entry.domain, 'spf', 'SPF', entry.records.spf, entry.dns.spf),
        dnsRecordRow(entry.domain, 'dkim', `DKIM (${entry.dkimSelector})`, entry.records.dkim, entry.dns.dkim),
        dnsRecordRow(entry.domain, 'dmarc', 'DMARC', entry.records.dmarc, entry.dns.dmarc)
      );
    }
    const checkAll = element('button', 'secondary', `ตรวจสอบทั้งหมดของ ${entry.domain}`);
    checkAll.type = 'button';
    checkAll.addEventListener('click', async () => {
      try {
        await withBusy(checkAll, async () => {
          wizard.settings = await api(`/api/mail/domains/${encodeURIComponent(entry.domain)}/dns-check`, { method: 'POST', body: { record: 'all' } });
          paintWizard();
        });
      } catch (error) { showError(error); }
    });
    const actions = element('div', 'form-actions');
    actions.append(checkAll);
    panel.append(list, actions);
  }

  panel.append(element('h3', 'wizard-subhead', 'แนะนำเพิ่มเติม — PTR / rDNS (ตั้งที่ผู้ให้บริการ IP ไม่ใช่ DNS ของโดเมน)'));
  const ptrList = element('section', 'tool-list');
  const ptrRow = element('article', 'tool-row');
  const ptrCopy = element('div');
  const ptrStatus = MAIL_DNS_STATUS[mail.ptr?.status ?? 'pending'] ?? MAIL_DNS_STATUS.pending;
  ptrCopy.append(element('h3', '', 'PTR / rDNS'), element('p', 'muted', mail.ptr?.detail || `IP ของ host ต้องชี้กลับมาที่ ${mail.hostname ?? 'mail hostname'} — ไม่บังคับ แต่ช่วยเรื่อง deliverability มาก`));
  const ptrSide = element('div');
  const ptrCheck = element('button', 'secondary', 'ตรวจสอบ');
  ptrCheck.type = 'button';
  ptrCheck.addEventListener('click', async () => {
    try {
      await withBusy(ptrCheck, async () => {
        wizard.settings = await api('/api/mail/ptr-check', { method: 'POST', body: {} });
        paintWizard();
      });
    } catch (error) { showError(error); }
  });
  ptrSide.append(statusChip(ptrStatus.label, ptrStatus.variant), ptrCheck);
  ptrRow.append(ptrCopy, ptrSide);
  ptrList.append(ptrRow);
  panel.append(ptrList);
  return wizardNav(panel, { nextLabel: wizardStepDone(3) ? 'ถัดไป →' : 'ข้ามไปก่อน →' });
}

function wizardStepMode() {
  const mail = wizard.settings.mail;
  const recommended = wizard.outbound?.recommendation?.mode ?? null;
  const port25Open = (wizard.outbound?.ports ?? []).find((entry) => entry.port === 25)?.status === 'open';
  const panel = wizardPanel(4, 'เลือกโหมดส่งออก', recommended ? `ผลตรวจ step 1 แนะนำ: ${MAIL_PLAN_GUIDE[recommended]?.label ?? recommended}` : 'เลือกวิธีส่งอีเมลขาออกของ host นี้');
  const form = element('form', 'form-grid');
  const modes = [
    { id: 'direct', label: 'Direct MX', detail: port25Open ? 'ส่งตรงถึงปลายทาง (พอร์ต 25 เปิด)' : 'ต้องพอร์ต 25 เปิด — ผลตรวจล่าสุดยังถูกบล็อค เลือกได้แต่มีความเสี่ยงส่งไม่ออก' },
    { id: 'relay-587', label: 'Relay :587', detail: 'ส่งผ่าน relay ด้วย SMTP AUTH + STARTTLS' },
    { id: 'relay-2525', label: 'Relay :2525', detail: 'สำหรับเครือข่ายที่เหลือแค่พอร์ต 2525 (SMTP2GO, Mailgun, SendGrid)' }
  ];
  let selected = mail.outboundMode ?? recommended ?? 'relay-587';
  const relayWrap = element('div', 'form-grid wizard-relay');
  const radios = element('div', 'wizard-mode-list');
  const paintRelayVisibility = () => { relayWrap.hidden = selected === 'direct'; };
  for (const modeOption of modes) {
    const card = element('label', 'wizard-mode-card');
    const radio = element('input');
    radio.type = 'radio';
    radio.name = 'outbound-mode';
    radio.value = modeOption.id;
    radio.checked = selected === modeOption.id;
    radio.addEventListener('change', () => { selected = modeOption.id; paintRelayVisibility(); });
    const copy = element('span');
    const title = element('b', '', modeOption.label);
    copy.append(title, element('small', '', modeOption.detail));
    if (recommended === modeOption.id) title.append(element('span', 'mail-chip info wizard-recommend', 'แนะนำ'));
    card.append(radio, copy);
    radios.append(card);
  }
  form.append(radios);

  const relayHost = element('input');
  relayHost.placeholder = 'mail.smtp2go.com';
  relayHost.value = mail.relay?.host ?? '';
  const relayPort = element('input');
  relayPort.type = 'number';
  relayPort.min = '1';
  relayPort.max = '65535';
  relayPort.value = mail.relay?.port ?? '';
  const relayUser = element('input');
  relayUser.value = mail.relay?.username ?? '';
  const relayPass = element('input');
  relayPass.type = 'password';
  relayPass.placeholder = mail.relay?.hasPassword ? '(ใช้รหัสผ่านเดิม — พิมพ์ใหม่เพื่อเปลี่ยน)' : '';
  const labelled = (text, input) => { const label = element('label', '', text); label.append(input); return label; };
  relayWrap.append(labelled('Relay host', relayHost), labelled('Port', relayPort), labelled('Username', relayUser), labelled('Password', relayPass));
  form.append(relayWrap);
  paintRelayVisibility();

  const save = element('button', '', 'บันทึกโหมดส่งออก');
  save.type = 'submit';
  const actions = element('div', 'form-actions');
  actions.append(save);
  form.append(actions);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const body = { mode: selected };
    if (selected !== 'direct') {
      body.relay = {
        host: relayHost.value.trim(),
        port: Number(relayPort.value || (selected === 'relay-587' ? 587 : 2525)),
        username: relayUser.value.trim(),
        password: relayPass.value
      };
    }
    try {
      await withBusy(save, async () => {
        wizard.settings = await api('/api/mail/outbound-mode', { method: 'POST', body });
        toast('บันทึกโหมดส่งออกแล้ว');
        paintWizard();
      });
    } catch (error) { showError(error); }
  });
  panel.append(form);
  return wizardNav(panel, { nextEnabled: wizardStepDone(4) });
}

function wizardStepInstall() {
  const mail = wizard.settings.mail;
  const tool = wizard.settings.tool;
  const panel = wizardPanel(5, 'ติดตั้ง Mail Server', 'mail service ผูกพอร์ตของตัวเอง (25/587/993) ไม่ผ่าน Nginx — ไม่กระทบเว็บโปรเจคที่รันอยู่');
  panel.append(element('p', 'muted', `สรุป: ${mail.hostname} · ${mail.domains.length} โดเมน (${mail.domains.map((entry) => entry.domain).join(', ')}) · โหมด ${mail.outboundMode}`));
  const list = element('section', 'tool-list');
  const stepRow = (title, done, detail) => {
    const row = element('article', 'tool-row');
    const copy = element('div');
    copy.append(element('h3', '', title), element('p', 'muted', detail));
    const side = element('div');
    side.append(statusChip(done ? 'พร้อม' : 'รอดำเนินการ', done ? 'ready' : 'muted'));
    row.append(copy, side);
    return row;
  };
  const installed = tool?.status === 'Installed';
  const configured = mail.configure?.status === 'configured';
  list.append(
    stepRow('Package: Postfix + Dovecot + OpenDKIM', installed, installed ? (tool.version ?? 'ติดตั้งแล้ว') : 'ติดตั้งผ่าน allowlisted installer'),
    stepRow('Configure: hostname, โดเมน, DKIM, TLS, โหมดส่งออก', configured, configured ? mail.configure.detail : 'เขียน config + เปิด services หลังติดตั้ง package')
  );
  panel.append(list);
  if (wizard.settings.mode === 'demo') panel.append(element('p', 'muted', '⚠ DEMO MODE — การติดตั้งถูกจำลอง ไม่เปลี่ยนแปลงเครื่องจริง'));
  const unverified = mail.domains.filter((entry) => ['mx', 'spf', 'dkim'].some((kind) => entry.dns?.[kind]?.status !== 'verified'));
  if (unverified.length) panel.append(element('p', 'muted', `⚠ ${unverified.map((entry) => entry.domain).join(', ')} ยังมี DNS record ที่ไม่ผ่าน — ติดตั้งได้ แต่ step 7 จะยังส่งไม่ผ่านจนกว่า DNS จะพร้อม`));

  const actions = element('div', 'form-actions');
  if (!installed) {
    const install = element('button', '', 'ติดตั้ง package');
    install.type = 'button';
    install.addEventListener('click', async () => {
      if (!await confirmAction('ติดตั้ง Mail Server', 'จะติดตั้ง Postfix, Dovecot และ OpenDKIM ผ่าน allowlisted installer', 'ยืนยัน')) return;
      try {
        await withBusy(install, async () => {
          await api('/api/tools/mail/install', { method: 'POST', body: { confirm: true } });
          await reloadWizardSettings();
          toast('ติดตั้ง package แล้ว');
          paintWizard();
        });
      } catch (error) { showError(error); }
    });
    actions.append(install);
  } else if (!configured) {
    const configure = element('button', '', 'Configure mail service');
    configure.type = 'button';
    configure.addEventListener('click', async () => {
      if (!await confirmAction('ยืนยันการตั้งค่า Mail Server', 'จะเขียน config ของ Postfix/Dovecot/OpenDKIM และเปิดพอร์ต 25/587/993 ให้ทำงาน', 'ยืนยัน')) return;
      try {
        await withBusy(configure, async () => {
          wizard.settings = await api('/api/mail/configure', { method: 'POST', body: { confirm: true } });
          toast('ตั้งค่า mail service แล้ว');
          paintWizard();
        });
      } catch (error) { showError(error); }
    });
    actions.append(configure);
  }
  panel.append(actions);
  return wizardNav(panel, { nextEnabled: configured });
}

function wizardStepMailbox() {
  const mail = wizard.settings.mail;
  const panel = wizardPanel(6, 'สร้าง mailbox แรก', 'สร้างกล่องจดหมายแรกของ mail service — ข้ามได้ แล้วมาสร้างทีหลัง');
  const list = element('section', 'tool-list');
  for (const mailbox of mail.mailboxes) {
    const row = element('article', 'tool-row');
    const copy = element('div');
    copy.append(element('h3', '', `${mailbox.localPart}@${mailbox.domain}`), element('p', 'muted', mailbox.displayName || '—'));
    const side = element('div');
    const remove = element('button', 'secondary danger', 'ลบ');
    remove.type = 'button';
    remove.addEventListener('click', async () => {
      if (!await confirmAction('ลบ mailbox', `ลบ ${mailbox.localPart}@${mailbox.domain} หรือไม่?`, 'ลบ')) return;
      try {
        await api(`/api/mail/mailboxes/${encodeURIComponent(mailbox.id)}`, { method: 'DELETE', body: {} });
        await reloadWizardSettings();
        paintWizard();
      } catch (error) { showError(error); }
    });
    side.append(statusChip('พร้อมใช้งาน', 'ready'), remove);
    row.append(copy, side);
    list.append(row);
  }
  if (!mail.mailboxes.length) list.append(element('p', 'muted', 'ยังไม่มี mailbox'));
  panel.append(list);

  const form = element('form', 'form-grid');
  const domainSelect = element('select');
  for (const entry of mail.domains) domainSelect.append(new Option(`@${entry.domain}`, entry.domain));
  const localInput = element('input');
  localInput.placeholder = 'portal';
  localInput.maxLength = 63;
  const nameInput = element('input');
  nameInput.placeholder = 'Portal Ops';
  nameInput.maxLength = 100;
  const passwordInput = element('input');
  passwordInput.type = 'password';
  passwordInput.autocomplete = 'new-password';
  const labelled = (text, input) => { const label = element('label', '', text); label.append(input); return label; };
  form.append(labelled('Local part', localInput), labelled('Mail domain', domainSelect), labelled('ชื่อที่แสดง', nameInput), labelled('Password (อย่างน้อย 12 ตัว มีตัวใหญ่/เล็ก/เลข/สัญลักษณ์)', passwordInput));
  const create = element('button', '', 'สร้าง mailbox');
  create.type = 'submit';
  const actions = element('div', 'form-actions');
  actions.append(create);
  form.append(actions);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await withBusy(create, async () => {
        await api('/api/mail/mailboxes', { method: 'POST', body: { domain: domainSelect.value, localPart: localInput.value.trim(), displayName: nameInput.value.trim(), password: passwordInput.value } });
        await reloadWizardSettings();
        toast('สร้าง mailbox แล้ว');
        paintWizard();
      });
    } catch (error) { showError(error); }
  });
  panel.append(form);
  return wizardNav(panel, { nextLabel: mail.mailboxes.length ? 'ถัดไป →' : 'ข้ามตอนนี้ →' });
}

function wizardStepTest() {
  const mail = wizard.settings.mail;
  const panel = wizardPanel(7, 'ทดสอบส่งจริง', 'ส่งอีเมลทดสอบไปที่อีเมลภายนอกของคุณ (เช่น Gmail) — การทดสอบรับเข้าอัตโนมัติจะมาใน Phase 2');
  if (!mail.mailboxes.length) {
    panel.append(element('p', 'muted', 'ต้องมี mailbox อย่างน้อย 1 กล่องก่อน — ย้อนกลับไป step 6'));
    return wizardNav(panel, { next: false });
  }
  const form = element('form', 'form-grid');
  const fromSelect = element('select');
  for (const mailbox of mail.mailboxes) fromSelect.append(new Option(`${mailbox.localPart}@${mailbox.domain}`, mailbox.id));
  const toInput = element('input');
  toInput.type = 'email';
  toInput.placeholder = 'you@gmail.com';
  const labelled = (text, input) => { const label = element('label', '', text); label.append(input); return label; };
  form.append(labelled('ส่งจาก', fromSelect), labelled('ส่งถึง (อีเมลภายนอกของคุณ)', toInput));
  const send = element('button', '', 'ส่งอีเมลทดสอบ');
  send.type = 'submit';
  const actions = element('div', 'form-actions');
  actions.append(send);
  form.append(actions);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await withBusy(send, async () => {
        const result = await api('/api/mail/test/send', { method: 'POST', body: { mailboxId: fromSelect.value, to: toInput.value.trim() } });
        wizard.settings.mail.lastTest = result.test;
        paintWizard();
      });
    } catch (error) {
      showError(error);
      await reloadWizardSettings();
      paintWizard();
    }
  });
  panel.append(form);
  if (mail.lastTest) {
    const status = mail.lastTest.status === 'passed' ? { label: 'ผ่าน', variant: 'ready' } : mail.lastTest.status === 'simulated' ? { label: 'จำลอง', variant: 'muted' } : { label: 'ไม่ผ่าน', variant: 'needs' };
    const line = element('p', '');
    line.append(statusChip(status.label, status.variant), element('span', 'muted', ` ${mail.lastTest.from} → ${mail.lastTest.to} · ${mail.lastTest.detail}`));
    panel.append(line);
    if (mail.lastTest.status === 'passed') panel.append(element('p', 'muted', '☑ อย่าลืมเช็คใน inbox ปลายทางว่า SPF/DKIM/DMARC = PASS (ดูใน "Show original" ของ Gmail)'));
  }
  const finish = element('div', 'form-actions wizard-actions');
  const backButton = element('button', 'secondary', '← ย้อนกลับ');
  backButton.type = 'button';
  backButton.addEventListener('click', () => { wizard.step = 6; paintWizard(); });
  const done = element('button', '', 'เสร็จสิ้น — ไปหน้า Mail');
  done.type = 'button';
  done.addEventListener('click', () => { location.href = '/mail'; });
  finish.append(backButton, done);
  panel.append(finish);
  return panel;
}

function fillCredentialSelect(selected = '') {
  const select = $('#credential-id');
  if (!select) return;
  select.replaceChildren(new Option('Public repository — ไม่ต้องใช้ credential', ''), ...state.credentials.map((credential) => new Option(credential.name, credential.id)));
  select.value = [...select.options].some((option) => option.value === selected) ? selected : '';
}

function renderAudit() {
  const root = $('#audit');
  if (!root) return;
  const toneFor = (outcome) => outcome === 'success' ? 'success' : (outcome === 'failed' || outcome === 'error' ? 'error' : outcome === 'warning' ? 'warning' : 'info');
  if (!state.audit.length) {
    root.replaceChildren(element('div', 'empty-state', 'No activity recorded yet.'));
    return;
  }
  root.replaceChildren(...state.audit.map((event) => {
    const row = element('article', 'tl-event');
    const tone = toneFor(event.outcome);
    const marker = element('div', `tl-icon ${tone}`);
    marker.append(icon(tone === 'success' ? 'check' : tone === 'error' ? 'close' : tone === 'warning' ? 'alert' : 'clock'));
    const title = element('div', 'tl-title', event.action);
    if (event.target) title.append(element('span', 'tag', event.target));
    row.append(marker, title, element('div', 'tl-desc', event.detail || `Outcome: ${event.outcome || 'recorded'}`));
    const meta = element('div', 'tl-meta');
    meta.append(element('span', '', event.actor || 'system'), element('span', '', '·'), element('span', '', new Date(event.at).toLocaleString('th-TH')));
    row.append(meta);
    return row;
  }));
}

function renderSettings() {
  renderSoftwareUpdate();
  renderMonitorTokens().catch(showError);
  $('#settings-mode').textContent = state.mode === 'host' ? 'host' : 'sandbox';
  $('#mode-description').textContent = state.mode === 'host'
    ? 'โหมด host — คำสั่งติดตั้งและ deploy ทำงานบนเครื่องจริงผ่าน privileged helper'
    : 'โหมด sandbox — การติดตั้งถูกจำลองและไม่แก้ host จริง';
}

async function openNotificationHookDialog(project) {
  state.notificationProject = project;
  $('#notification-hook-project-label').textContent = `${project.name} · ${project.slug}`;
  $('#project-notification-hook-form').reset();
  $('#notification-hook-dialog').showModal();
  await renderProjectNotificationHooks();
}

async function renderProjectNotificationHooks() {
  const root = $('#project-notification-hook-list');
  const project = state.notificationProject;
  if (!root || !project) return;
  root.replaceChildren(element('div', 'empty-state', 'กำลังโหลด webhooks…'));
  const payload = await api('/api/notification-hooks');
  if (state.notificationProject !== project) return;
  const createPanel = $('#notification-hook-create-panel');
  const submit = $('#notification-hook-submit');
  if (!payload.vaultReady) {
    createPanel.hidden = true;
    submit.hidden = true;
    root.replaceChildren(element('div', 'empty-state', 'Credential vault ยังไม่พร้อม จึงยังบันทึก webhook ไม่ได้'));
    return;
  }
  createPanel.hidden = false;
  submit.hidden = false;
  const hooks = (payload.hooks || []).filter((hook) => hook.projectSlug === project.slug);
  root.replaceChildren(...(hooks.length ? hooks.map((hook) => {
    const row = element('article', 'notification-hook-row');
    const copy = element('div');
    const last = hook.lastDelivery
      ? ` · ล่าสุด ${hook.lastDelivery.status} ${new Date(hook.lastDelivery.at).toLocaleString('th-TH')}`
      : ' · ยังไม่เคยส่ง';
    const events = hook.events.map((event) => event === 'deployment.succeeded' ? 'success' : 'failed').join(', ');
    copy.append(element('h3', '', hook.name), element('p', 'muted', `${hook.provider} · ${events}${last}`));
    const remove = element('button', 'secondary danger', 'ลบ');
    remove.type = 'button';
    remove.addEventListener('click', async () => {
      if (!await confirmAction('ลบ webhook', `ลบ ${hook.name} ออกจาก ${project.name} หรือไม่?`, 'ลบ')) return;
      await withBusy(remove, async () => {
        await api(`/api/notification-hooks/${encodeURIComponent(hook.id)}`, { method: 'DELETE', body: {} });
        toast('ลบ webhook แล้ว');
        await renderProjectNotificationHooks();
      });
    });
    row.append(copy, remove);
    return row;
  }) : [element('div', 'empty-state', 'ยังไม่มี webhook สำหรับโปรเจกต์นี้')]));
}

async function renderMonitorTokens() {
  const payload = await api('/api/monitor-tokens');
  const select = $('#monitor-token-project');
  if (!select) return;
  select.replaceChildren(...state.projects.map((project) => {
    const option = document.createElement('option');
    option.value = project.slug;
    option.textContent = `${project.name} · ${project.slug}`;
    return option;
  }));
  const list = $('#monitor-token-list');
  list.replaceChildren(...(payload.tokens?.length ? payload.tokens.map((token) => {
    const row = element('div', 'token-row');
    row.append(element('span', '', `${token.name} · ${token.projectSlug}${token.revokedAt ? ' · revoked' : ''}`));
    if (!token.revokedAt) {
      const remove = element('button', 'secondary danger', 'Revoke');
      remove.type = 'button';
      remove.addEventListener('click', async () => {
        if (!await confirmAction('Revoke Monitor Logs Token', `ยกเลิก token ${token.name} หรือไม่? จะใช้งานต่อไม่ได้ทันที`, 'Revoke')) return;
        await withBusy(remove, async () => {
          await api(`/api/monitor-tokens/${encodeURIComponent(token.id)}`, { method: 'DELETE', body: {} });
          toast('ยกเลิก Monitor Logs Token แล้ว');
          await renderMonitorTokens();
        });
      });
      row.append(remove);
    }
    return row;
  }) : [element('span', '', 'No Monitor Logs Tokens')]));
}

function renderSoftwareUpdate() {
  const update = state.softwareUpdate;
  const root = $('#software-update');
  const command = $('#update-command');
  const copy = $('#copy-update-command');
  if (!update?.configured) {
    root.replaceChildren(element('h2', '', 'อัปเดตซอฟต์แวร์'), element('p', '', 'ตัวติดตั้งรุ่นปัจจุบันจะเชื่อมช่อง stable ที่เซ็นลายเซ็นให้โดยอัตโนมัติ เครื่องนี้ยังไม่มีการตั้งค่านั้น'));
    command.textContent = 'sudo dashboard-portal update';
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
  command.textContent = update.channel === 'stable'
    ? 'sudo dashboard-portal update'
    : `sudo dashboard-portal update --channel=${update.channel}`;
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
  if (!await confirmProjectDeletion(project)) return;
  button.disabled = true;
  try {
    await api(`/api/projects/${encodeURIComponent(project.slug)}`, { method: 'DELETE', body: {} });
    toast(`ลบ ${project.name} แล้ว`);
    await refresh();
  } catch (error) { showError(error); }
  finally { button.disabled = false; }
}

function confirmProjectDeletion(project) {
  const dialog = $('#project-delete-dialog');
  const form = $('#project-delete-form');
  const projectName = $('#project-delete-name');
  const input = $('#project-delete-confirmation');
  const accept = $('#project-delete-accept');
  projectName.textContent = project.name;
  input.value = '';
  input.placeholder = project.name;
  accept.disabled = true;
  const updateAcceptance = () => { accept.disabled = input.value !== project.name; };
  input.addEventListener('input', updateAcceptance);
  dialog.showModal();
  requestAnimationFrame(() => input.focus());
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => {
      input.removeEventListener('input', updateAcceptance);
      resolve(dialog.returnValue === 'confirm' && input.value === project.name);
    }, { once: true });
  });
}

async function rollbackProject(project, button) {
  if (!await confirmAction('ย้อนกลับ release', `ย้อน ${project.name} ไปยัง release ก่อนหน้าหรือไม่?`, 'ย้อนกลับ')) return;
  button.disabled = true;
  try {
    const result = await api(`/api/projects/${encodeURIComponent(project.slug)}/rollback`, { method: 'POST', body: {} });
    toast(result.activation === 'queued' || result.activation === 'pending' ? 'จัดคิว rollback แล้ว' : 'rollback สำเร็จ');
    if (result.job?.id) showDeploymentProgress(project, result.job);
    else await refresh();
  } catch (error) { showError(error); }
  finally { button.disabled = false; }
}

async function openDeployDialog(project) {
  state.activeProject = project;
  const latestRelease = project.deployment?.releases?.[0];
  $('#deploy-dialog-title').textContent = `Deploy ${project.name}`;
  $('#deploy-project-label').textContent = `Release candidate · ${latestRelease?.revision || project.branch || 'latest source'}`;
  $('#deploy-release-project').textContent = project.name;
  $('#deploy-release-source').textContent = `${project.branch || 'main'} · ${latestRelease?.revision || 'latest sync'}`;
  const [payload, configurationPayload] = await Promise.all([
    api(`/api/projects/${encodeURIComponent(project.slug)}/environment`),
    api(`/api/projects/${encodeURIComponent(project.slug)}/deploy-configuration`)
  ]);
  const configuration = configurationPayload.configuration;
  $('#deploy-runtime').textContent = configuration.runtime;
  $('#deploy-branch').textContent = project.branch || 'main';
  $('#deploy-start-script').textContent = configuration.startScript;
  $('#deploy-package-manager').textContent = configuration.packageManager;
  $('#deploy-node-version').textContent = configuration.nodeVersion;
  $('#deploy-build-script').textContent = configuration.buildScript;
  const lockfile = $('#deploy-lockfile');
  lockfile.textContent = configuration.lockfile.valid === true ? `✓ ${configuration.lockfile.name} valid` : configuration.lockfile.valid === false ? `${configuration.lockfile.name} Not valid` : configuration.lockfile.name;
  lockfile.classList.toggle('deploy-lock-valid', configuration.lockfile.valid === true);
  lockfile.classList.toggle('deploy-lock-invalid', configuration.lockfile.valid === false);
  $('#deploy-skip-build-toggle').classList.toggle('on', configuration.skipBuild);
  $('#deploy-build-note').textContent = configuration.lockfile.valid === false
    ? `No ${configuration.lockfile.name} found — deployment will use ${configuration.packageManager}, not npm ci.`
    : configuration.skipBuild
      ? 'Build step is skipped by this project configuration; dependencies and health checks still run.'
      : 'The build plan uses the configuration shown in the Environment step.';
  state.deployEnvironmentVariables = payload.environment?.variables || [];
  renderDeployEnvironment(state.deployEnvironmentVariables);
  const keyCount = state.deployEnvironmentVariables.length;
  $('#deploy-saved-env-message').textContent = keyCount
    ? 'ค่าที่ไม่ sensitive แสดงในช่องแก้ไขได้ ส่วน sensitive key จะปกปิดค่าไว้'
    : 'เพิ่ม environment variable ก่อนสร้าง release';
  $('#deploy-env-hint').textContent = keyCount
    ? 'ช่องค่าที่เว้นว่างจะคงค่าเดิมไว้; key ใหม่ต้องระบุค่า'
    : 'เพิ่มอย่างน้อยหนึ่งตัวแปรก่อน deploy';
  $('#deploy-release-environment').textContent = keyCount ? `${keyCount} configured keys` : 'New .env required';
  setDeployStep(1);
  const dialog = $('#deploy-dialog');
  dialog.showModal();
  requestAnimationFrame(() => dialog.classList.add('open'));
}

function renderDeployEnvironment(variables) {
  const root = $('#deploy-environment-rows');
  root.replaceChildren(...variables.map((variable) => deployEnvironmentRow(variable)));
}

function deployEnvironmentRow(variable = { key: '', value: '', sensitive: true, isNew: true }) {
  const row = element('div', `env-row deploy-env-row${variable.isNew ? ' deploy-env-row--new' : ''}`);
  row.dataset.existing = variable.isNew ? 'false' : 'true';
  const key = element('input', 'input');
  key.value = variable.key || '';
  key.placeholder = 'VARIABLE_NAME';
  key.autocomplete = 'off';
  key.spellcheck = false;
  key.readOnly = !variable.isNew;
  key.setAttribute('aria-label', 'Environment variable name');
  const value = element('input', 'input');
  const sensitive = variable.sensitive !== false;
  value.type = sensitive ? 'password' : 'text';
  value.value = sensitive ? '' : (variable.value || '');
  value.placeholder = sensitive ? 'Sensitive — leave blank to keep' : 'Leave blank to keep current value';
  value.autocomplete = 'off';
  value.spellcheck = false;
  value.setAttribute('aria-label', `Value for ${variable.key || 'new variable'}`);
  const toggle = element('button', 'env-sensitivity');
  toggle.type = 'button';
  const refreshSensitivity = () => {
    const isSensitive = row.dataset.sensitive === 'true';
    value.type = isSensitive ? 'password' : 'text';
    value.classList.toggle('secret', isSensitive);
    value.placeholder = isSensitive ? 'Sensitive — leave blank to keep' : 'Leave blank to keep current value';
    toggle.setAttribute('aria-pressed', String(isSensitive));
    toggle.setAttribute('aria-label', isSensitive ? 'Sensitive value: keep masked' : 'Non-sensitive value: may be shown');
    toggle.replaceChildren(icon(isSensitive ? 'lock' : 'unlock'));
  };
  row.dataset.sensitive = String(sensitive);
  refreshSensitivity();
  toggle.addEventListener('click', () => {
    row.dataset.sensitive = String(row.dataset.sensitive !== 'true');
    if (row.dataset.sensitive === 'true') value.value = '';
    refreshSensitivity();
  });
  row.append(key, value, toggle);
  if (variable.isNew) {
    const remove = element('button', 'close-btn deploy-env-remove');
    remove.type = 'button';
    remove.setAttribute('aria-label', 'Remove environment variable');
    remove.append(icon('close'));
    remove.addEventListener('click', () => row.remove());
    row.append(remove);
  }
  return row;
}

function collectDeployEnvironmentVariables() {
  const variables = [];
  for (const row of $$('.deploy-env-row')) {
    const [keyInput, valueInput] = $$('input', row);
    const key = keyInput.value.trim();
    const value = valueInput.value;
    const existing = row.dataset.existing === 'true';
    if (!key && !value) continue;
    if (!key) throw new Error('กรุณาระบุชื่อ environment variable');
    if (!existing && !value) throw new Error(`กรุณาระบุค่าสำหรับ key ใหม่ ${key}`);
    variables.push({ key, value, sensitive: row.dataset.sensitive === 'true' });
  }
  if (!variables.length) throw new Error('ต้องมีอย่างน้อยหนึ่ง environment variable ก่อน deploy');
  return variables;
}

function setDeployStep(step) {
  state.deployStep = step;
  $$('[data-deploy-pane]').forEach((pane) => { pane.hidden = Number(pane.dataset.deployPane) !== step; });
  $$('[data-deploy-step]').forEach((item) => {
    const itemStep = Number(item.dataset.deployStep);
    item.classList.toggle('active', itemStep === step);
    item.classList.toggle('done', itemStep < step);
  });
  const back = $('#deploy-back');
  back.hidden = step === 1;
  $('#deploy-submit').textContent = step === 1 ? 'Next: Build' : step === 2 ? 'Next: Release' : 'Create release';
}

function closeDeployDialog() {
  const dialog = $('#deploy-dialog');
  dialog.classList.remove('open');
  window.setTimeout(() => {
    if (!dialog.classList.contains('open') && dialog.open) dialog.close();
  }, 250);
}

async function submitDeploy(event) {
  event.preventDefault();
  const project = state.activeProject;
  const variables = collectDeployEnvironmentVariables();
  if (state.deployStep === 1) {
    $('#deploy-release-environment').textContent = `${variables.length} configured keys`;
    setDeployStep(2);
    return;
  }
  if (state.deployStep === 2) {
    setDeployStep(3);
    return;
  }
  const submit = $('#deploy-submit');
  submit.disabled = true;
  try {
    await api(`/api/projects/${encodeURIComponent(project.slug)}/environment`, { method: 'POST', body: { variables } });
    const result = await api(`/api/projects/${encodeURIComponent(project.slug)}/deploy`, { method: 'POST', body: {} });
    closeDeployDialog();
    toast(result.activation === 'queued' ? 'จัดคิว deploy แล้ว' : 'สร้าง release แล้ว');
    if (result.job?.id) showDeploymentProgress(project, result.job);
    else await refresh();
  } catch (error) { showError(error); }
  finally { submit.disabled = false; }
}

function openDeploymentLog(project, release) {
  $('#deployment-log-title').textContent = `${project.name} · ${release.id || 'release'}`;
  $('#deployment-log-summary').textContent = `${release.status || 'unknown'} · ${release.createdAt ? new Date(release.createdAt).toLocaleString('th-TH') : ''}`;
  const list = $('#deployment-log-events');
  const events = release.events || [];
  list.replaceChildren(...(events.length ? events.map(deploymentEventItem) : [element('li', 'deployment-event waiting', 'ยังไม่มีเหตุการณ์')]));
  $('#deployment-log-dialog').showModal();
}

function deploymentEventItem(event) {
  const status = event.status || 'pending';
  const item = element('li', `deployment-event ${status}`);
  const dot = element('span', 'deployment-event-dot');
  dot.setAttribute('aria-hidden', 'true');
  const copy = element('div', 'deployment-event-copy');
  copy.append(element('strong', '', event.phase || status || 'event'), element('span', '', event.message || 'Deployment event recorded.'), element('small', '', event.at ? new Date(event.at).toLocaleString('th-TH') : ''));
  item.append(dot, copy);
  return item;
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

function showDeploymentProgress(project, initialJob) {
  clearTimeout(deploymentProgressTimer);
  $('#deployment-log-title').textContent = `${project.name} · กำลัง deploy`;
  $('#deployment-log-dialog').showModal();
  const render = (job) => {
    $('#deployment-log-summary').textContent = `${job.status} · ${job.releaseId || ''}`;
    const list = $('#deployment-log-events');
    const events = job.events || [];
    list.replaceChildren(...(events.length ? events.map(deploymentEventItem) : [element('li', 'deployment-event waiting', 'กำลังรอคิว')]));
  };
  const poll = async () => {
    try {
      const { job } = await api(`/api/jobs/${encodeURIComponent(initialJob.id)}`);
      render(job);
      if (job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled' || job.status === 'interrupted') {
        await refresh();
        toast(job.status === 'succeeded' ? `งานของ ${project.slug} สำเร็จ` : `งานของ ${project.slug} สิ้นสุดด้วยสถานะ ${job.status}`, job.status !== 'succeeded');
        if (job.status === 'succeeded' && project.domains?.hosts?.length) {
          try {
            const edge = await api(`/api/projects/${encodeURIComponent(project.slug)}/edge/check`, { method: 'POST', body: {} });
            if (!edge.passed) toast(edge.checks?.find((item) => !item.ok)?.detail || 'Release สำเร็จแต่ Nginx ยังไม่ reverse proxy โดเมนนี้', true);
          } catch { /* DNS/Nginx follow-up is best-effort after a successful job. */ }
        }
        return;
      }
      deploymentProgressTimer = setTimeout(poll, 1500);
    } catch (error) {
      $('#deployment-log-summary').textContent = error.message || 'โหลดสถานะ release ไม่สำเร็จ';
      deploymentProgressTimer = setTimeout(poll, 2500);
    }
  };
  render(initialJob);
  void poll();
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
  state.domainDraft = { hosts: [...(project.domains?.hosts || [])], pending: null, check: null, checks: {}, edge: null };
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
    const result = state.domainDraft?.checks?.[host];
    const row = element('article', 'domain-row');
    const header = element('div', 'domain-row-head');
    header.append(element('span', 'domain-hostname', host), domainStatusChip(result));
    const actions = element('div', 'domain-row-actions');
    const refresh = element('button', 'secondary', 'Refresh');
    refresh.type = 'button';
    refresh.disabled = result?.status === 'checking';
    refresh.addEventListener('click', () => refreshDomainStatuses([host]));
    const remove = element('button', 'secondary', 'ลบ');
    remove.type = 'button';
    remove.addEventListener('click', () => removeDomainHost(host));
    actions.append(refresh, remove);
    header.append(actions);
    row.append(header, element('p', 'domain-row-detail', domainStatusDetail(result)));
    if (result?.resolved?.length || result?.expected?.length) {
      row.append(element('p', 'domain-records', `DNS: ${result.resolved?.join(', ') || '—'} · Origin: ${result.expected?.join(', ') || 'not configured'}`));
    }
    return row;
  }));
  renderDomainEdge();
}

function domainStatusLabel(status) {
  if (status === 'ok') return 'Ready';
  if (status === 'proxied') return 'Proxy detected';
  if (status === 'mismatch') return 'ชี้ผิดเครื่อง';
  if (status === 'unresolved') return 'ยังไม่ resolve';
  if (status === 'checking') return 'Checking';
  return 'ตรวจไม่ได้';
}

function domainStatusChip(result) {
  const status = result?.status || 'checking';
  const variant = status === 'ok' ? 'ready' : status === 'checking' ? 'muted' : 'needs';
  return statusChip(domainStatusLabel(status), variant);
}

function domainStatusDetail(result) {
  if (!result || result.status === 'checking') return 'กำลังตรวจ DNS และสถานะ proxy…';
  if (result.status === 'ok') return 'DNS ชี้เข้าเครื่องนี้แล้ว พร้อมออก certificate และเปิดใช้งานโดเมน';
  if (result.status === 'proxied') return `${result.proxy?.provider || 'CDN'} Proxy กำลังรับ traffic อยู่ — ตั้ง DNS only และปิด forced HTTPS ชั่วคราวก่อนออก certificate แบบ HTTP-01 แล้วกด Refresh`;
  if (result.status === 'mismatch') return 'DNS ยังไม่ชี้มาที่ origin ของ Dashboard Portal';
  if (result.status === 'unresolved') return 'ไม่พบ DNS record ที่ใช้งานได้ รอ propagation แล้วกด Refresh';
  return result.detail || 'ตรวจ DNS ไม่สำเร็จ ลอง Refresh อีกครั้ง';
}

function renderDomainEdge() {
  const panel = $('#domain-edge');
  if (!panel) return;
  const edge = state.domainDraft?.edge;
  const hosts = state.domainDraft?.hosts || [];
  if (!hosts.length) {
    panel.hidden = true;
    panel.replaceChildren();
    return;
  }
  panel.hidden = false;
  if (!edge || edge.status === 'checking') {
    panel.replaceChildren(element('p', 'domain-row-detail', 'กำลังตรวจ Nginx reverse proxy และ reload…'));
    return;
  }
  const head = element('div', 'domain-row-head');
  head.append(element('span', 'domain-hostname', 'Nginx / reverse proxy'), edgeStatusChip(edge));
  const list = element('ul', 'edge-check-list');
  for (const item of edge.checks || []) {
    const row = element('li', item.ok ? 'ok' : 'fail');
    row.append(element('span', 'edge-check-mark', item.ok ? 'ผ่าน' : 'ไม่ผ่าน'), document.createTextNode(` ${item.detail}`));
    list.append(row);
  }
  panel.replaceChildren(head, list);
}

function edgeStatusChip(edge) {
  if (!edge || edge.status === 'checking') return statusChip('Checking', 'muted');
  if (edge.passed || edge.status === 'ok') return statusChip('Proxy พร้อม', 'ready');
  if (edge.status === 'default-site') return statusChip('ขึ้นหน้า Nginx default', 'needs');
  if (edge.status === 'not-loaded') return statusChip('ยังไม่โหลด vhost', 'needs');
  if (edge.status === 'upstream-down') return statusChip('แอปไม่ตอบพอร์ต', 'needs');
  if (edge.status === 'unavailable') return statusChip('ต้องตรวจบน host', 'muted');
  return statusChip('Nginx ยังไม่พร้อม', 'needs');
}

async function refreshDomainStatuses(hosts = state.domainDraft?.hosts || []) {
  const project = state.activeProject;
  if (!project || !hosts.length || !state.domainDraft) return;
  const button = $('#domain-refresh');
  if (button) button.disabled = true;
  for (const host of hosts) state.domainDraft.checks[host] = { status: 'checking' };
  renderDomainList();
  for (const host of hosts) {
    try {
      state.domainDraft.checks[host] = await api(`/api/projects/${encodeURIComponent(project.slug)}/domains/check`, { method: 'POST', body: { hostname: host } });
    } catch (error) {
      state.domainDraft.checks[host] = { hostname: host, status: 'error', detail: error.message };
    }
    renderDomainList();
  }
  try {
    state.domainDraft.edge = { status: 'checking' };
    renderDomainList();
    state.domainDraft.edge = await api(`/api/projects/${encodeURIComponent(project.slug)}/edge/check`, { method: 'POST', body: {} });
  } catch (error) {
    state.domainDraft.edge = { passed: false, status: 'error', checks: [{ id: 'host', ok: false, detail: error.message }] };
  }
  renderDomainList();
  if (button) button.disabled = false;
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
  state.domainDraft.checks = {};
  toast(`เพิ่ม ${hostname} แล้ว`);
  setDomainView('list');
  renderDomainList();
  await refresh();
}

async function removeDomainHost(host) {
  const project = state.activeProject;
  const domains = (state.domainDraft.hosts || []).filter((item) => item !== host);
  if (!await confirmAction('ลบ domain', domains.length ? `ลบ ${host} ออกจาก ${project.name} หรือไม่?` : `ลบ ${host} ซึ่งเป็น domain สุดท้ายหรือไม่? Nginx ที่ Portal จัดการให้จะถูกถอดออก แต่ service จะยังทำงานภายในเครื่อง`, 'ลบ')) return;
  const result = await api(`/api/projects/${encodeURIComponent(project.slug)}/domains`, { method: 'POST', body: { domains } });
  state.domainDraft.hosts = result.project?.domains?.hosts || domains;
  delete state.domainDraft.checks?.[host];
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
    port: project.port ? String(project.port) : '',
    autoPort: false,
    buildScript: project.buildScript ?? 'build',
    skipBuild: project.buildScript === null,
    startScript: project.startScript || 'start',
    runtime: project.runtime || 'node',
    composeFile: project.composeFile || 'compose.yaml',
    composeService: project.composeService || '',
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
  $('#project-port').value = draft.port || '';
  $('#auto-project-port').checked = draft.autoPort === true || draft.autoPort === 'on' || (!draft.port && flowMode !== 'edit');
  $('#build-script').value = draft.buildScript ?? 'build';
  $('#skip-build').checked = draft.skipBuild === true || draft.buildScript === null;
  $('#start-script').value = draft.startScript || 'start';
  setProjectRuntime(draft.runtime || 'node');
  $('#compose-file').value = draft.composeFile || 'compose.yaml';
  $('#compose-service').value = draft.composeService || '';
  $('#health-check-enabled').checked = draft.healthCheckEnabled !== false;
  $('#health-check-path').value = draft.healthCheckPath || '/';
  const protocol = document.querySelector(`input[name="protocol"][value="${draft.protocol || 'https'}"]`);
  if (protocol) protocol.checked = true;
  toggleCredentialReference();
  toggleHealthCheckFields();
  toggleRuntimeFields();
  toggleProjectPort();
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
    ['Runtime', draft.runtime === 'docker-compose' ? `Docker Compose · ${draft.composeFile || 'compose.yaml'} · service ${draft.composeService || '—'}` : (draft.runtime === 'bun' ? 'Bun / systemd' : 'Node.js / systemd')],
    ['Build', draft.skipBuild === true || draft.buildScript === null ? 'Skipped' : (draft.buildScript || 'build')],
    ['การเชื่อมต่อ', connectionLabel(draft)],
    ['Port ภายในเครื่อง', draft.autoPort === true || draft.autoPort === 'on' || !draft.port ? 'สุ่มพอร์ตว่างตอนบันทึก' : draft.port],
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

function runtimeValue() {
  return $('#project-runtime')?.value || 'node';
}

function setProjectRuntime(value) {
  const runtime = ['node', 'bun', 'docker-compose'].includes(value) ? value : 'node';
  const choices = {
    node: { label: 'Node.js', detail: 'build และ run ด้วย npm script ใน systemd', icon: 'node' },
    bun: { label: 'Bun', detail: 'ติดตั้ง dependencies และ run package script ด้วย Bun ใน systemd', icon: 'bun' },
    'docker-compose': { label: 'Docker Compose', detail: 'Compose ที่ผ่าน policy check ก่อน activate', icon: 'docker' }
  };
  const input = $('#project-runtime');
  if (!input) return;
  input.value = runtime;
  $('#runtime-selection-label').textContent = choices[runtime].label;
  $('#runtime-selection-detail').textContent = choices[runtime].detail;
  $('#runtime-selection-icon').replaceChildren(icon(choices[runtime].icon));
  $$('[data-runtime-option]').forEach((option) => option.setAttribute('aria-selected', String(option.dataset.runtimeOption === runtime)));
  $('#runtime-menu')?.removeAttribute('open');
  toggleRuntimeFields();
}

function toggleRuntimeFields() {
  const runtime = runtimeValue();
  const docker = runtime === 'docker-compose';
  $('#docker-compose-fields').hidden = !docker;
  $('#skip-build-row').hidden = docker;
  $('#build-script-row').hidden = docker;
  $('#start-script-row').hidden = docker;
  $('#skip-build').disabled = docker;
  $('#build-script').disabled = docker;
  $('#start-script').disabled = docker;
  $('#start-script').required = !docker;
  $('#compose-file').disabled = !docker;
  $('#compose-service').disabled = !docker;
  $('#compose-service').required = docker;
  toggleBuildFields();
}

function toggleBuildFields() {
  const skip = $('#skip-build').checked;
  const docker = runtimeValue() === 'docker-compose';
  $('#build-script-row').hidden = docker || skip;
  $('#build-script').disabled = docker || skip;
}

function toggleProjectPort() {
  const automatic = $('#auto-project-port').checked;
  $('#project-port').disabled = automatic;
  $('#project-port-row').classList.toggle('is-disabled', automatic);
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
    await detectProjectRuntimeFromRepository({ quiet: true });
  } catch (error) { showError(error); }
  finally { button.disabled = false; }
}

async function detectProjectRuntimeFromRepository({ quiet = false } = {}) {
  const repository = $('#repository');
  if (!repository?.reportValidity()) return;
  const button = $('#detect-project-runtime');
  const note = $('#runtime-detection-note');
  const protocol = document.querySelector('input[name="protocol"]:checked')?.value || 'https';
  const original = button?.textContent;
  if (button) button.disabled = true;
  if (note) note.textContent = 'กำลังอ่าน metadata ของ repository…';
  try {
    const result = await api('/api/projects/runtime-detect', {
      method: 'POST',
      body: {
        repository: repository.value,
        branch: $('#branch').value || 'main',
        directory: $('#project-directory').value || '/',
        protocol,
        credentialId: $('#credential-id').value
      }
    });
    const detection = result.detection;
    if (detection?.recommendedRuntime) setProjectRuntime(detection.recommendedRuntime);
    if (detection?.buildScript) $('#build-script').value = detection.buildScript;
    if (detection?.startScript) $('#start-script').value = detection.startScript;
    if (detection?.composeFile) $('#compose-file').value = detection.composeFile;
    if (detection?.composeService) $('#compose-service').value = detection.composeService;
    if (note) {
      const evidence = (detection?.evidence || []).map((item) => item.path).join(' · ');
      note.textContent = [detection?.notice, evidence].filter(Boolean).join(' — ') || 'ยังตรวจ runtime ไม่ได้';
    }
    if (!quiet && detection?.recommendedRuntime) toast(`เลือก ${detection.recommendedRuntime === 'docker-compose' ? 'Docker Compose' : detection.recommendedRuntime === 'bun' ? 'Bun' : 'Node.js'} ให้แล้ว`);
  } catch (error) {
    if (note) note.textContent = `ตรวจอัตโนมัติไม่สำเร็จ: ${error.message}`;
    if (!quiet) throw error;
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = original || 'ตรวจ App อัตโนมัติ';
    }
  }
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
    port: draft.autoPort === true || draft.autoPort === 'on' || !draft.port ? null : Number(draft.port),
    buildScript: draft.skipBuild === true || draft.buildScript === null ? '' : (draft.buildScript ?? 'build'),
    startScript: draft.startScript || 'start',
    runtime: draft.runtime || 'node',
    composeFile: draft.composeFile || 'compose.yaml',
    composeService: draft.composeService || '',
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
  $('#sidebar-toggle')?.addEventListener('click', () => {
    const collapsed = !document.body.classList.contains('sidebar-collapsed');
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
    setSidebarCollapsed(collapsed);
  });
  applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');
  $('#theme-toggle')?.addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
    if (state.metrics?.samples) drawMetricsChart(state.metrics.samples);
  });
  document.addEventListener('click', (event) => {
    if (document.body.classList.contains('nav-open') && !event.target.closest('.sidebar, #mobile-menu')) {
      document.body.classList.remove('nav-open');
      $('#mobile-menu')?.setAttribute('aria-expanded', 'false');
    }
    if (!event.target.closest('.project-actions-menu')) {
      $$('details.project-actions-menu[open]').forEach((menu) => { menu.open = false; });
    }
  });
  $('#mail-check-run')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const root = $('#mail-check-results');
    root?.replaceChildren(element('p', 'muted', 'กำลังตรวจ outbound และ policy firewall ขาเข้า… (อาจใช้เวลาราว 10 วินาที)'));
    try {
      await withBusy(button, async () => {
        renderMailOutboundReport(await api('/api/mail/readiness-check', { method: 'POST', body: {} }));
      });
    } catch (error) {
      root?.replaceChildren(element('p', 'muted', 'ตรวจสอบไม่สำเร็จ — ลองใหม่อีกครั้ง'));
      showError(error);
    }
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
    const form = event.currentTarget;
    try {
      await api('/api/credentials', { method: 'POST', body: Object.fromEntries(new FormData(form)) });
      resetForm(form);
      toast('บันทึก credential แล้ว');
      await refresh();
    } catch (error) { showError(error); }
  });
  $('#password-change-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      const values = new FormData(form);
      if (values.get('newPassword') !== values.get('confirmPassword')) throw new Error('ยืนยันรหัสผ่านใหม่ไม่ตรงกัน');
      const result = await api('/api/settings/password', { method: 'POST', body: { currentPassword: values.get('currentPassword'), newPassword: values.get('newPassword') } });
      state.csrfToken = result.csrfToken;
      resetForm(form);
      toast('เปลี่ยนรหัสผ่านแล้ว และออกจาก session อื่นทั้งหมดแล้ว');
    } catch (error) { showError(error); }
  });
  $('#monitor-token-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      const result = await api('/api/monitor-tokens', { method: 'POST', body: Object.fromEntries(new FormData(form)) });
      $('#monitor-token-value').hidden = false;
      $('#monitor-token-value').textContent = `Copy this token now: ${result.token}`;
      resetForm(form);
      await renderMonitorTokens();
    } catch (error) { showError(error); }
  });
  $('#project-notification-hook-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      const data = Object.fromEntries(new FormData(form));
      data.events = $$('input[name="events"]:checked', form).map((input) => input.value);
      data.projectSlug = state.notificationProject?.slug;
      if (!data.projectSlug) throw new Error('ไม่พบโปรเจกต์สำหรับ webhook นี้');
      await api('/api/notification-hooks', { method: 'POST', body: data });
      resetForm(form);
      $$('input[name="events"]', form).forEach((input) => { input.checked = true; });
      toast('บันทึก webhook แล้ว');
      await renderProjectNotificationHooks();
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
    data.runtime = runtimeValue();
    data.autoPort = $('#auto-project-port').checked;
    if (data.autoPort) data.port = '';
    data.skipBuild = $('#skip-build').checked;
    if (data.skipBuild) data.buildScript = '';
    data.healthCheckEnabled = $('#health-check-enabled').checked;
    writeDraft(data);
    location.href = flowPath('review');
  });
  $('#fetch-branches')?.addEventListener('click', () => fetchBranches().catch(showError));
  $('#detect-project-runtime')?.addEventListener('click', () => detectProjectRuntimeFromRepository().catch(showError));
  $('#branch')?.addEventListener('change', () => detectProjectRuntimeFromRepository({ quiet: true }));
  $('#project-directory')?.addEventListener('change', () => detectProjectRuntimeFromRepository({ quiet: true }));
  $('#health-check-enabled')?.addEventListener('change', toggleHealthCheckFields);
  $('#auto-project-port')?.addEventListener('change', toggleProjectPort);
  $('#skip-build')?.addEventListener('change', toggleBuildFields);
  $$('[data-runtime-option]').forEach((option) => option.addEventListener('click', () => setProjectRuntime(option.dataset.runtimeOption)));
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
  $('#deploy-close')?.addEventListener('click', closeDeployDialog);
  $('#deploy-cancel')?.addEventListener('click', closeDeployDialog);
  $('#deploy-back')?.addEventListener('click', () => setDeployStep(Math.max(1, state.deployStep - 1)));
  $('#deploy-add-variable')?.addEventListener('click', () => $('#deploy-environment-rows').append(deployEnvironmentRow()));
  $('#deploy-dialog')?.addEventListener('cancel', (event) => { event.preventDefault(); closeDeployDialog(); });
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
  $('#domain-refresh')?.addEventListener('click', () => refreshDomainStatuses().catch(showError));
  $('#domain-form')?.addEventListener('submit', (event) => confirmAddDomain(event).catch(showError));
  $('#notification-hook-close')?.addEventListener('click', () => $('#notification-hook-dialog').close());
  $('#notification-hook-cancel')?.addEventListener('click', () => $('#notification-hook-dialog').close());
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
