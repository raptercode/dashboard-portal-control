// This page only receives token plaintext once; never persist it in browser storage.
export async function renderCliAccess({ api, access, projects, toast, showError }) {
  const root = document.querySelector('#cli-access');
  if (!root) return;
  const node = (tag, text) => { const item = document.createElement(tag); if (text) item.textContent = text; return item; };
  const result = await api('/api/cli/tokens');
  const master = access.user?.role === 'master';
  const allowed = result.scopes.filter(scope => master || access.organizations.some(org => org.permissions?.includes(scope)));
  const form = root.querySelector('form');
  const scopes = root.querySelector('[data-cli-scopes]');
  scopes.replaceChildren(...allowed.map(scope => {
    const label = node('label');
    const checkbox = node('input');
    checkbox.type = 'checkbox'; checkbox.name = 'scope'; checkbox.value = scope;
    checkbox.checked = scope !== 'env.read';
    label.append(checkbox, document.createTextNode(` ${scope}`));
    return label;
  }));
  const selector = form.elements.projectSlug;
  selector.replaceChildren(new Option('ทุกโปรเจคที่บัญชีเข้าถึงได้', ''), ...projects.map(project => new Option(project.slug, project.slug)));
  const output = root.querySelector('[data-cli-secret]');
  form.onsubmit = async event => {
    event.preventDefault();
    const button = form.querySelector('button'); button.disabled = true;
    try {
      const values = new FormData(form);
      const created = await api('/api/cli/tokens', { method: 'POST', body: { name: values.get('name'), projectSlug: values.get('projectSlug') || null, scopes: values.getAll('scope'), expiresInDays: Number(values.get('days')) } });
      output.hidden = false;
      output.querySelector('textarea').value = created.token;
      toast('สร้าง token แล้ว คัดลอกเก็บไว้ตอนนี้');
      await renderCliAccess({ api, access, projects, toast, showError });
    } catch (error) { showError(error); }
    finally { button.disabled = false; }
  };
  root.querySelector('[data-cli-hide-secret]').onclick = () => { output.querySelector('textarea').value = ''; output.hidden = true; };
  const list = root.querySelector('[data-cli-tokens]');
  list.replaceChildren(...result.tokens.map(token => {
    const row = node('article');
    row.className = 'notification-hook-row';
    const text = node('div');
    text.append(node('h3', token.name), node('p', `${token.projectSlug || 'ทุกโปรเจค'} · ${token.scopes.join(', ')} · หมดอายุ ${new Date(token.expiresAt).toLocaleString('th-TH')}`));
    const button = node('button', token.revokedAt ? 'ถอนสิทธิ์แล้ว' : 'ถอนสิทธิ์');
    button.type = 'button'; button.className = 'secondary danger'; button.disabled = Boolean(token.revokedAt);
    button.onclick = async () => {
      button.disabled = true;
      try { await api(`/api/cli/tokens/${encodeURIComponent(token.id)}`, { method: 'DELETE' }); await renderCliAccess({ api, access, projects, toast, showError }); }
      catch (error) { button.disabled = false; showError(error); }
    };
    row.append(text, button); return row;
  }));
  const code = new URLSearchParams(location.search).get('cli_code');
  const approval = root.querySelector('[data-cli-approval]');
  if (!code || approval.dataset.handled === code) return;
  approval.hidden = false;
  try {
    const device = await api(`/api/cli/devices/${encodeURIComponent(code)}`);
    approval.replaceChildren(node('h2', 'อนุมัติการเข้าสู่ระบบ CLI'), node('p', 'อนุมัติเฉพาะคำขอที่คุณเริ่มเอง ตรวจว่ารหัสตรงกับ terminal ก่อน'), node('code', device.userCode), node('p', `${device.name} · ${device.projectSlug || 'ทุกโปรเจคที่คุณเข้าถึงได้'} · ${device.expiresInDays} วัน`), node('p', device.scopes.join(', ')));
    for (const [approve, label] of [[true, 'อนุมัติ CLI'], [false, 'ปฏิเสธ']]) {
      const button = node('button', label); button.type = 'button';
      button.onclick = async () => {
        approval.querySelectorAll('button').forEach(item => { item.disabled = true; });
        try {
          await api(`/api/cli/devices/${encodeURIComponent(code)}`, { method: 'POST', body: { approve } });
          approval.dataset.handled = code;
          approval.replaceChildren(node('p', approve ? 'อนุมัติแล้ว กลับไปที่ terminal ได้เลย' : 'ปฏิเสธการเข้าสู่ระบบแล้ว'));
        } catch (error) { showError(error); approval.querySelectorAll('button').forEach(item => { item.disabled = false; }); }
      };
      approval.append(button);
    }
  } catch (error) { approval.replaceChildren(node('p', error.message)); }
}
