export function domainDnsStatus(result) {
  return ({ ok: 'DNS ถูกต้อง', proxied: 'DNS ผ่าน Cloudflare', mismatch: 'DNS ยังไม่ตรง', unresolved: 'ยังไม่พบ DNS', error: 'ตรวจ DNS ไม่สำเร็จ', checking: 'กำลังตรวจ DNS' })[result?.status] || 'รอตรวจ DNS';
}

export function domainProxyStatus(result) {
  if (result?.proxy?.detected || result?.status === 'proxied') return 'Proxy: เปิด (Cloudflare)';
  if (result?.resolved?.length) return 'Proxy: ไม่พบ Cloudflare';
  return 'Proxy: ยังตรวจไม่ได้';
}

export function domainReadiness(dns, edge) {
  if (['mismatch', 'unresolved', 'error'].includes(dns?.status)) return { label: 'Invalid Configuration', variant: 'needs' };
  if (edge?.passed && edge?.tls?.status === 'valid' && ['ok', 'proxied'].includes(dns?.status)) return { label: 'Valid Configuration', variant: 'ready' };
  return { label: 'Pending Verification', variant: 'muted' };
}

export function domainDnsRecords(hostname, result) {
  return (result?.expected || []).map(value => ({ type: value.includes(':') ? 'AAAA' : 'A', name: hostname, value, optional: value.includes(':') && result.expected.some(address => !address.includes(':')) }));
}

function dnsDetail(result) {
  if (result?.status === 'proxied') return 'ตรวจพบ Cloudflare Proxy เปิดอยู่ สามารถกด Verify และออก TLS โดยเปิด Proxy ไว้ได้ เนื่องจาก Proxy ซ่อน IP ปลายทาง ให้ตรวจว่า Origin ใน Cloudflare ชี้มาที่ IP ด้านล่าง';
  if (result?.status === 'ok') return 'DNS ชี้มาที่ host นี้แล้ว กด Verify เพื่อเปิดใช้งาน Nginx และ TLS';
  if (result?.status === 'unresolved') return 'ยังไม่พบ DNS record ตั้งค่าตามตารางแล้วกด Verify อีกครั้ง การกระจาย DNS อาจใช้เวลา';
  if (result?.status === 'mismatch') return 'DNS ปัจจุบันยังไม่ตรงกับ host นี้ เปลี่ยนค่า record ตามตารางแล้วกด Verify อีกครั้ง';
  return result?.detail || 'เพิ่มโดเมนแล้ว กำลังตรวจ DNS และ TLS';
}

function domainError(error) {
  if (error.message === 'Enter a valid DNS hostname.') return new Error('กรอก hostname เช่น api.example.com โดยไม่ใส่ https:// หรือ path');
  if (/failed to fetch|networkerror/i.test(error.message)) return new Error('เชื่อมต่อ Portal ไม่สำเร็จ ลอง Refresh เพื่อตรวจว่ารายการถูกบันทึกแล้วหรือไม่');
  return error;
}

export function createDomainSettings({ $, element, statusChip, api, showDialog, clearDialogError, showError, toast, confirmAction, refreshCards, onProjectChanged, copyText }) {
  let current = null;
  let bound = false;
  const dialog = () => $('#domain-dialog');
  const busy = ctx => Boolean(ctx.busy || ctx.refreshing);

  function report(error, ctx) { if (current === ctx) showError(domainError(error)); }

  function render() {
    const ctx = current;
    if (!ctx) return;
    const disabled = busy(ctx);
    for (const id of ['domain-hostname', 'domain-submit', 'domain-refresh', 'domain-verify-all', 'domain-retry-cleanup']) $('#' + id).disabled = disabled;
    $('#domain-submit').disabled ||= ctx.hosts.length >= 10;
    $('#domain-verify-all').disabled ||= !ctx.hosts.length;
    $('#domain-form').setAttribute('aria-busy', String(disabled));
    $('#domain-submit').textContent = ctx.busy === 'add' ? 'กำลังเพิ่ม…' : 'Add';
    $('#domain-count').textContent = `${ctx.hosts.length}/10 โดเมน`;
    $('#domain-list-empty').hidden = Boolean(ctx.hosts.length);
    const notice = $('#domain-sync-status');
    notice.textContent = ctx.project.domains?.syncError || ctx.notice || '';
    notice.hidden = !notice.textContent;
    notice.setAttribute('role', ctx.project.domains?.syncError ? 'alert' : 'status');
    $('#domain-retry-cleanup').hidden = !ctx.project.domains?.syncError || !(ctx.project.domains?.activeHosts || []).some(host => !ctx.hosts.includes(host));
    $('#domain-list').replaceChildren(...ctx.hosts.map(host => renderHost(ctx, host)));
  }

  function renderHost(ctx, host) {
    const dns = ctx.checks[host];
    const edge = ctx.edges[host];
    const readiness = domainReadiness(dns, edge);
    if (ctx.project.domains?.syncError && !edge?.passed && ['ok', 'proxied'].includes(dns?.status)) {
      readiness.label = 'Configuration Error';
      readiness.variant = 'needs';
    }
    const row = element('article', 'domain-row');
    const head = element('div', 'domain-row-head');
    const link = element('a', 'domain-hostname', host);
    link.href = `https://${host}`;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    head.append(link, statusChip(ctx.busy === 'verify' && (!ctx.target || ctx.target === host) ? 'Verifying…' : readiness.label, readiness.variant));
    const actions = element('div', 'domain-row-actions');
    const verify = element('button', 'secondary', 'Verify');
    verify.type = 'button';
    verify.disabled = busy(ctx);
    verify.addEventListener('click', () => verifyHosts(host).catch(error => report(error, ctx)));
    const remove = element('button', 'secondary', 'ลบ');
    remove.type = 'button';
    remove.disabled = busy(ctx);
    remove.addEventListener('click', () => removeHost(host).catch(error => report(error, ctx)));
    actions.append(verify, remove);
    head.append(actions);
    const statuses = element('div', 'domain-statuses');
    statuses.append(statusChip(domainDnsStatus(dns), dns?.status === 'ok' ? 'ready' : 'muted'), statusChip(domainProxyStatus(dns), 'muted'));
    const tls = edge?.tls;
    const tlsText = tls?.status === 'valid' ? 'TLS: พร้อม' : edge?.status === 'not-loaded' ? 'TLS: รอ Verify' : tls?.status === 'invalid' ? 'TLS: certificate ไม่ผ่าน' : tls?.status === 'unreachable' ? 'TLS: ต่อ origin ไม่ได้' : edge?.status === 'checking' ? 'TLS: กำลังตรวจ' : 'TLS: ยังไม่พร้อม';
    statuses.append(statusChip(tlsText, tls?.status === 'valid' ? 'ready' : 'muted'));
    row.append(head, statuses);
    if (readiness.label === 'Configuration Error') {
      const error = element('p', 'dialog-error', ctx.project.domains.syncError);
      error.setAttribute('role', 'alert');
      row.append(error);
    }
    if (tls?.expiresAt) row.append(element('p', 'domain-row-detail', `Origin certificate หมดอายุ ${new Date(tls.expiresAt).toLocaleDateString('th-TH')}`));
    const details = element('details', 'domain-dns-details');
    details.open = ctx.expanded.has(host) ? ctx.expanded.get(host) : readiness.variant !== 'ready';
    const summary = element('summary', '', 'DNS configuration และรายละเอียด');
    details.append(summary, element('p', 'domain-row-detail', dnsDetail(dns)));
    summary.addEventListener('click', () => ctx.expanded.set(host, !details.open));
    const records = domainDnsRecords(host, dns);
    if (records.length) {
      const table = element('table', 'domain-dns-table');
      const thead = element('thead');
      const titles = element('tr');
      for (const title of ['Type', 'Name', 'Value']) titles.append(element('th', '', title));
      thead.append(titles);
      const tbody = element('tbody');
      for (const record of records) {
        const tr = element('tr');
        tr.append(element('td', '', record.type + (record.optional ? ' (ทางเลือก)' : '')), element('td', '', record.name));
        const value = element('td');
        const copy = element('button', 'secondary domain-copy', 'คัดลอก');
        copy.type = 'button';
        copy.setAttribute('aria-label', `คัดลอก ${record.type} ${record.value}`);
        copy.addEventListener('click', () => copyText(record.value).then(() => toast('คัดลอกค่า DNS แล้ว')).catch(error => report(error, ctx)));
        value.append(element('code', '', record.value), copy);
        tr.append(value);
        tbody.append(tr);
      }
      table.append(thead, tbody);
      const scroll = element('div', 'domain-dns-scroll');
      scroll.append(table);
      details.append(scroll, element('p', 'domain-row-detail', 'ตั้ง A ตาม IP ของ host; AAAA เป็นทางเลือกเมื่อ origin รับ IPv6 ได้ ใส่ Name เป็น hostname เต็ม หรือชื่อย่อยตามรูปแบบของผู้ให้บริการ DNS'));
    } else details.append(element('p', 'domain-row-detail', dns?.status === 'checking' || !dns ? 'กำลังอ่าน IP ของ host…' : 'ยังอ่าน IP สาธารณะของ host ไม่ได้ ตรวจการตั้งค่า IP ของเครื่องแล้วกด Refresh'));
    if (dns?.resolved?.length) details.append(element('p', 'domain-records', `DNS ที่พบ: ${dns.resolved.join(', ')}`));
    details.append(element('p', 'domain-row-detail', 'สถานะ Cloudflare Proxy อนุมานจาก DNS สาธารณะ ส่วน TLS ตรวจ certificate ของ origin แยกจาก certificate ที่ CDN แสดงให้ผู้เข้าชม'));
    if (edge?.checks?.length) {
      const diagnostics = element('details', 'domain-edge-details');
      diagnostics.append(element('summary', '', 'รายละเอียด Nginx / TLS'));
      const list = element('ul', 'edge-check-list');
      for (const item of edge.checks) {
        const li = element('li', item.ok ? 'ok' : 'fail');
        li.append(element('span', 'edge-check-mark', item.ok ? 'ผ่าน' : 'ไม่ผ่าน'), element('span', '', item.detail));
        list.append(li);
      }
      diagnostics.append(list);
      details.append(diagnostics);
    }
    row.append(details);
    return row;
  }

  async function refreshStatuses(hosts = current?.hosts || []) {
    const ctx = current;
    if (!ctx || busy(ctx) || !hosts.length) return;
    ctx.refreshing = true;
    for (const host of hosts) { ctx.checks[host] = { status: 'checking' }; ctx.edges[host] = { status: 'checking' }; }
    render();
    try {
      await Promise.all(hosts.map(async hostname => {
        const base = `/api/projects/${encodeURIComponent(ctx.project.slug)}`;
        const [dns, edge] = await Promise.all([
          api(`${base}/domains/check`, { method: 'POST', body: { hostname } }).catch(error => ({ status: 'error', detail: error.message })),
          api(`${base}/edge/check`, { method: 'POST', body: { hostname } }).catch(error => ({ status: 'error', checks: [{ id: 'host', ok: false, detail: error.message }] }))
        ]);
        if (current !== ctx) return;
        ctx.checks[hostname] = dns;
        ctx.edges[hostname] = edge;
        render();
      }));
    } finally { ctx.refreshing = false; if (current === ctx) render(); }
  }

  async function mutate(operation, body, { action, hostname } = {}) {
    const ctx = current;
    if (!ctx || busy(ctx)) return;
    ctx.busy = action;
    ctx.target = hostname;
    clearDialogError(dialog());
    render();
    try {
      const result = await api(`/api/projects/${encodeURIComponent(ctx.project.slug)}/${operation}`, { method: 'POST', body });
      if (result.project) onProjectChanged(result.project);
      if (current !== ctx) return;
      ctx.project = result.project;
      ctx.hosts = [...result.project.domains.hosts];
      ctx.notice = result.domainSync?.detail;
      if (action === 'add') { $('#domain-hostname').value = ''; ctx.expanded.set(hostname, true); }
      if (result.checks) Object.assign(ctx.checks, result.checks);
      toast(result.domainSync?.detail || 'บันทึกโดเมนแล้ว', result.domainSync?.status === 'failed');
    } catch (error) { report(error, ctx); return; }
    finally { ctx.busy = false; if (current === ctx) render(); }
    if (current !== ctx) return;
    await refreshStatuses();
    await refreshCards().catch(() => toast('โหลดรายการโปรเจคใหม่ไม่สำเร็จ กด Refresh เพื่อตรวจรายการ', true));
  }

  async function addHost(event) {
    event.preventDefault();
    const ctx = current;
    if (!ctx || busy(ctx)) return;
    const hostname = $('#domain-hostname').value.trim().toLowerCase().replace(/\.$/, '');
    if (!hostname) return report(new Error('กรุณากรอกโดเมน'), ctx);
    if (ctx.hosts.includes(hostname)) return report(new Error('โดเมนนี้อยู่ในโปรเจคแล้ว กด Verify ที่โดเมนนั้นได้เลย'), ctx);
    if (ctx.hosts.length >= 10) return report(new Error('เพิ่มได้ไม่เกิน 10 โดเมน'), ctx);
    await mutate('domains', { domains: [...ctx.hosts, hostname], sync: false }, { action: 'add', hostname });
  }

  async function verifyHosts(hostname) {
    await mutate('domains/verify', hostname ? { hostname } : {}, { action: 'verify', hostname });
  }

  async function removeHost(hostname) {
    const ctx = current;
    if (!ctx || busy(ctx)) return;
    if (!await confirmAction('ลบโดเมน', `ลบ ${hostname} ออกจากโปรเจคและ Nginx หรือไม่? แอปยังทำงานที่พอร์ตเดิม`, 'ลบ')) return;
    if (current !== ctx) return;
    await mutate('domains', { domains: ctx.hosts.filter(host => host !== hostname) }, { action: 'remove', hostname });
  }

  return {
    bind() {
      if (bound) return;
      bound = true;
      $('#domain-form')?.addEventListener('submit', event => addHost(event).catch(error => report(error, current)));
      $('#domain-refresh')?.addEventListener('click', () => refreshStatuses().catch(error => report(error, current)));
      $('#domain-verify-all')?.addEventListener('click', () => verifyHosts().catch(error => report(error, current)));
      $('#domain-retry-cleanup')?.addEventListener('click', () => mutate('domains', { domains: current?.hosts || [] }, { action: 'remove' }).catch(error => report(error, current)));
    },
    open(project) {
      current = { project, hosts: [...(project.domains?.hosts || [])], checks: { ...project.domains?.verification }, edges: {}, expanded: new Map(), busy: false, refreshing: false };
      $('#domain-project-label').textContent = `${project.name} · ${project.slug}`;
      $('#domain-hostname').value = '';
      render();
      showDialog(dialog());
      void refreshStatuses();
    },
    close() { current = null; }
  };
}
