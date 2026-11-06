const mounted = new WeakMap();
const node = (tag, className, text) => { const element = document.createElement(tag); if (className) element.className = className; if (text !== undefined) element.textContent = text; return element; };
const isRunning = status => ['queued', 'running'].includes(status);
const statusText = row => row.current ? 'Active release' : ({ queued: 'Queued', running: 'Building', succeeded: 'Succeeded', failed: 'Failed' }[row.status] || row.status);
const when = value => value ? new Date(value).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

export function mountDeploymentFeed({ api, root, compact = false }) {
  if (!root) return Promise.resolve();
  const existing = mounted.get(root);
  if (existing) return existing.refresh();
  let payload;
  let timer;
  let loading = false;
  const project = root.querySelector('[data-delivery-project]');
  const status = root.querySelector('[data-delivery-status]');
  function render() {
    if (!payload) return;
    for (const key of ['total', 'active', 'succeeded', 'failed']) {
      const element = root.querySelector(`[data-delivery-${key}]`);
      if (element) element.textContent = payload.summary[key];
    }
    const selected = payload.projects.some(item => item.slug === project?.value) ? project.value : '';
    if (project) project.replaceChildren(new Option('ทุกโปรเจค', ''), ...payload.projects.map(item => new Option(item.name || item.slug, item.slug)));
    if (project) project.value = selected;
    const filtered = payload.deployments.filter(row => (!selected || row.projectSlug === selected) && (!status?.value || (status.value === 'running' ? isRunning(row.status) : row.status === status.value)));
    const rows = compact ? filtered.slice(0, 4) : filtered;
    const list = root.querySelector('[data-delivery-list]');
    list.replaceChildren(...rows.map(row => {
      const link = node('a', `delivery-row is-${row.status}`);
      link.href = `/projects#${encodeURIComponent(row.projectSlug)}`;
      const marker = node('span', `delivery-marker ${row.current ? 'is-current' : ''}`, row.status === 'failed' ? '!' : row.status === 'succeeded' ? '✓' : '↗');
      marker.setAttribute('aria-hidden', 'true');
      const identity = node('div', 'delivery-identity');
      identity.append(node('strong', '', row.projectName || row.projectSlug), node('span', '', `${row.kind === 'release' ? 'Release' : 'Deployment'} · ${(row.revision || row.releaseId || row.id).slice(0, 8)}`));
      const source = node('div', 'delivery-source');
      source.append(node('span', '', row.branch), node('small', '', row.runtime || 'application'));
      const state = node('span', `delivery-status ${row.current ? 'is-current' : ''}`, statusText(row));
      const time = node('time', 'delivery-time', when(row.createdAt));
      if (row.createdAt) time.dateTime = row.createdAt;
      link.append(marker, identity, source, state, time, node('span', 'delivery-open', '↗'));
      return link;
    }));
    if (!rows.length) {
      const empty = node('div', 'delivery-empty');
      empty.append(node('span', 'delivery-empty-symbol', '↗'), node('h3', '', payload.deployments.length ? 'ยังไม่มีรายการตรงกับตัวกรอง' : 'Your next release starts here.'), node('p', '', payload.deployments.length ? 'ลองเลือกโปรเจคหรือสถานะอื่น' : 'เชื่อม repository แล้ว deploy โปรเจคแรก ประวัติจะปรากฏที่นี่'));
      const action = node('a', 'btn btn-secondary', 'ไปที่ Projects'); action.href = '/projects'; empty.append(action); list.append(empty);
    }
    const updated = root.querySelector('[data-delivery-updated]');
    if (updated) updated.textContent = `อัปเดต ${when(payload.updatedAt)} · ${filtered.length} รายการ`;
  }
  async function refresh() {
    if (loading) return;
    loading = true;
    clearTimeout(timer);
    try {
      payload = await api('/api/deployments');
      const error = root.querySelector('[data-delivery-error]'); if (error) error.hidden = true;
      render();
    } catch (failure) {
      const error = root.querySelector('[data-delivery-error]');
      if (error) { error.textContent = failure.message; error.hidden = false; }
    } finally {
      loading = false;
      timer = setTimeout(() => {
        if (root.isConnected && !document.hidden && document.body.dataset.shell === 'dashboard') void refresh();
      }, payload?.summary.active ? 4000 : 15000);
    }
  }
  project?.addEventListener('change', render);
  status?.addEventListener('change', render);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && root.isConnected && document.body.dataset.shell === 'dashboard') void refresh(); });
  mounted.set(root, { refresh });
  return refresh();
}
