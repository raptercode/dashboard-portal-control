const $ = (selector, root = document) => root.querySelector(selector);
const el = (tag, className = '', content = '') => {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = content;
  return node;
};
const normalizePermissions = (items) => (items || []).map((item) => typeof item === 'string' ? { id: item, label: item, group: 'โปรเจค' } : item).filter((item) => item?.id);
const normalizeMemberships = (items) => (items || []).map((item) => ({ organizationId: item.organizationId || item.organization?.id, permissions: item.permissions || [] }));

function membershipEditor(organizations, permissions, selected = [], presets = {}) {
  const root = el('div', 'membership-editor');
  const byId = new Map(normalizeMemberships(selected).map((item) => [item.organizationId, item]));
  for (const organization of organizations) {
    const card = el('fieldset', 'membership-org');
    const title = el('legend', '', organization.name);
    const grant = el('label', 'check-row membership-toggle');
    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.dataset.organizationId = organization.id;
    toggle.checked = byId.has(organization.id);
    grant.append(toggle, el('span', '', 'ให้เข้าถึงองค์กรนี้'));
    const shortcuts = el('div', 'permission-presets');
    for (const [id, label] of [['viewer', 'ดูข้อมูล'], ['operator', 'ปฏิบัติการ'], ['maintainer', 'ดูแลระบบ']]) {
      if (!Array.isArray(presets[id])) continue;
      const button = el('button', 'secondary btn-sm', label);
      button.type = 'button';
      button.addEventListener('click', () => {
        toggle.checked = true;
        update();
        grid.querySelectorAll('.permission-choice input').forEach((input) => { input.checked = presets[id].includes(input.value); });
      });
      shortcuts.append(button);
    }
    const grid = el('div', 'permission-grid');
    const grouped = new Map();
    for (const permission of permissions) grouped.set(permission.group || 'โปรเจค', [...(grouped.get(permission.group || 'โปรเจค') || []), permission]);
    for (const [group, entries] of grouped) {
      const section = el('div', 'permission-group');
      section.append(el('strong', '', group));
      for (const permission of entries) {
        const label = el('label', 'check-row permission-choice');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = permission.id;
        checkbox.checked = byId.get(organization.id)?.permissions?.includes(permission.id) || false;
        label.append(checkbox, el('span', '', permission.label || permission.id));
        section.append(label);
      }
      grid.append(section);
    }
    const update = () => { grid.hidden = !toggle.checked; grid.querySelectorAll('input').forEach((input) => { input.disabled = !toggle.checked; }); };
    toggle.addEventListener('change', update);
    card.append(title, grant, shortcuts, grid);
    root.append(card);
    update();
  }
  return root;
}

function collectMemberships(root) {
  return [...root.querySelectorAll('.membership-org')].filter((card) => $('.membership-toggle input', card).checked).map((card) => ({
    organizationId: $('.membership-toggle input', card).dataset.organizationId,
    permissions: [...card.querySelectorAll('.permission-choice input:checked')].map((input) => input.value)
  }));
}

function formField(label, name, type = 'text', value = '') {
  const wrap = el('label', '');
  wrap.append(document.createTextNode(label));
  const input = document.createElement('input');
  input.name = name;
  input.type = type;
  input.value = value;
  input.required = true;
  if (name === 'email') input.autocomplete = 'email';
  wrap.append(input);
  return wrap;
}

function submitForm(form, button, work, onError) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    button.disabled = true;
    try { await work(); }
    catch (error) { onError(error); }
    finally { button.disabled = false; }
  });
}

export async function renderMembersPage({ api, toast, showError }) {
  const root = $('#members-content');
  if (!root) return;
  const [access, data] = await Promise.all([api('/api/access'), api('/api/members')]);
  const organizations = data.organizations || [];
  const users = data.users || [];
  const permissions = normalizePermissions(access.permissions);
  const memberships = data.memberships || [];
  const invitations = data.invitations || [];
  const stack = document.createDocumentFragment();

  const organizationPanel = el('section', 'member-panel');
  organizationPanel.append(el('h2', '', 'องค์กร'), el('p', 'member-intro', 'โปรเจคและสิทธิ์ถูกจัดแยกตามองค์กร'));
  const organizationForm = el('form', 'member-inline-form');
  const organizationName = formField('ชื่อองค์กรใหม่', 'name');
  organizationName.querySelector('input').maxLength = 80;
  const createOrg = el('button', 'btn btn-primary', 'สร้างองค์กร');
  createOrg.type = 'submit';
  organizationForm.append(organizationName, createOrg);
  submitForm(organizationForm, createOrg, async () => {
    await api('/api/organizations', { method: 'POST', body: { name: organizationName.querySelector('input').value.trim() } });
    toast('สร้างองค์กรแล้ว');
    await renderMembersPage({ api, toast, showError });
  }, showError);
  organizationPanel.append(organizationForm);
  const organizationList = el('div', 'organization-list');
  if (!organizations.length) organizationList.append(el('p', 'muted', 'ยังไม่มีองค์กร'));
  for (const organization of organizations) {
    const form = el('form', 'organization-row');
    const name = formField('ชื่อองค์กร', 'name', 'text', organization.name);
    name.querySelector('input').maxLength = 80;
    const save = el('button', 'secondary btn-sm', 'เปลี่ยนชื่อ');
    save.type = 'submit';
    form.append(name, save);
    submitForm(form, save, async () => {
      await api(`/api/organizations/${encodeURIComponent(organization.id)}`, { method: 'PATCH', body: { name: name.querySelector('input').value.trim() } });
      toast('เปลี่ยนชื่อองค์กรแล้ว');
      await renderMembersPage({ api, toast, showError });
    }, showError);
    organizationList.append(form);
  }
  organizationPanel.append(organizationList);
  stack.append(organizationPanel);

  const invitePanel = el('section', 'member-panel');
  invitePanel.append(el('h2', '', 'เชิญสมาชิก'), el('p', 'member-intro', 'ลิงก์คำเชิญแสดงครั้งเดียวหลังสร้าง คัดลอกส่งให้ผู้รับด้วยช่องทางที่คุณเลือก'));
  const inviteForm = el('form', 'member-form');
  const email = formField('อีเมล', 'email', 'email');
  const roleLabel = el('label', '', 'บทบาทระบบ');
  const role = document.createElement('select');
  role.name = 'role';
  for (const [value, label] of [['user', 'User · สิทธิ์เฉพาะองค์กร'], ['master', 'Master · จัดการทั้งระบบ']]) {
    const option = document.createElement('option'); option.value = value; option.textContent = label; role.append(option);
  }
  roleLabel.append(role);
  const inviteMemberships = membershipEditor(organizations, permissions, [], access.presets);
  const inviteButton = el('button', 'btn btn-primary', 'สร้างคำเชิญ');
  inviteButton.type = 'submit';
  const reveal = el('div', 'invitation-reveal');
  reveal.id = 'invitation-reveal';
  reveal.hidden = true;
  inviteForm.append(email, roleLabel, el('h3', '', 'สิทธิ์ตามองค์กร'), inviteMemberships, inviteButton);
  role.addEventListener('change', () => { inviteMemberships.hidden = role.value === 'master'; });
  submitForm(inviteForm, inviteButton, async () => {
    const payload = { email: email.querySelector('input').value.trim(), role: role.value, memberships: role.value === 'master' ? [] : collectMemberships(inviteMemberships) };
    const result = await api('/api/invitations', { method: 'POST', body: payload });
    const link = new URL('/invite', location.origin);
    link.searchParams.set('token', result.token);
    const field = document.createElement('input');
    field.type = 'text'; field.readOnly = true; field.value = link.href; field.setAttribute('aria-label', 'ลิงก์คำเชิญ');
    const copy = el('button', 'secondary', 'คัดลอกลิงก์'); copy.type = 'button';
    copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(link.href); toast('คัดลอกลิงก์คำเชิญแล้ว'); } catch { field.select(); toast('เลือกข้อความแล้ว กรุณาคัดลอกเอง'); } });
    reveal.replaceChildren(el('strong', '', 'คัดลอกลิงก์นี้ตอนนี้ ระบบจะไม่แสดงอีก'), field, copy);
    toast('สร้างคำเชิญแล้ว');
    await renderMembersPage({ api, toast, showError });
    $('#invitation-reveal')?.replaceWith(reveal);
    reveal.hidden = false;
  }, showError);
  invitePanel.append(inviteForm, reveal);
  stack.append(invitePanel);

  const usersPanel = el('section', 'member-panel');
  usersPanel.append(el('h2', '', 'บัญชีผู้ใช้'), el('p', 'member-intro', 'แก้ไขบทบาท สถานะ และสิทธิ์ได้จากแต่ละบัญชี'));
  for (const user of users) {
    const card = el('details', 'member-user');
    const summary = el('summary', 'member-user-summary');
    summary.append(el('strong', '', user.email), el('span', `member-role member-role-${user.role}`, user.role === 'master' ? 'Master' : 'User'), el('span', `status-chip ${user.status === 'active' ? 'success' : 'warn'}`, user.status || 'active'));
    card.append(summary);
    const form = el('form', 'member-form');
    const row = el('div', 'member-fields');
    const roleField = el('label', '', 'บทบาท');
    const roleSelect = document.createElement('select');
    for (const value of ['user', 'master']) { const option = document.createElement('option'); option.value = value; option.textContent = value === 'master' ? 'Master' : 'User'; roleSelect.append(option); }
    roleSelect.value = user.role;
    roleField.append(roleSelect);
    const statusField = el('label', '', 'สถานะ');
    const statusSelect = document.createElement('select');
    for (const [value, label] of [['active', 'ใช้งาน'], ['disabled', 'ระงับ']]) { const option = document.createElement('option'); option.value = value; option.textContent = label; statusSelect.append(option); }
    statusSelect.value = user.status;
    statusField.append(statusSelect);
    row.append(roleField, statusField);
    const selected = memberships.filter((item) => item.userId === user.id);
    const editor = membershipEditor(organizations, permissions, selected, access.presets);
    const save = el('button', 'btn btn-primary', 'บันทึกสิทธิ์'); save.type = 'submit';
    roleSelect.addEventListener('change', () => { editor.hidden = roleSelect.value === 'master'; });
    editor.hidden = roleSelect.value === 'master';
    form.append(row, editor, save);
    submitForm(form, save, async () => {
      await api(`/api/members/${encodeURIComponent(user.id)}`, { method: 'PATCH', body: { role: roleSelect.value, status: statusSelect.value, memberships: roleSelect.value === 'master' ? [] : collectMemberships(editor) } });
      toast('บันทึกสิทธิ์แล้ว');
      await renderMembersPage({ api, toast, showError });
    }, showError);
    card.append(form);
    usersPanel.append(card);
  }
  stack.append(usersPanel);

  const invitationPanel = el('section', 'member-panel');
  invitationPanel.append(el('h2', '', 'คำเชิญที่สร้างแล้ว'));
  if (!invitations.length) invitationPanel.append(el('p', 'muted', 'ยังไม่มีคำเชิญ'));
  for (const invitation of invitations) {
    const row = el('div', 'invitation-row');
    const text = el('div');
    const status = invitation.acceptedAt ? 'รับแล้ว' : invitation.revokedAt ? 'ยกเลิกแล้ว' : Date.parse(invitation.expiresAt) <= Date.now() ? 'หมดอายุ' : 'รอตอบรับ';
    text.append(el('strong', '', invitation.email), el('small', '', `${invitation.role === 'master' ? 'Master' : 'User'} · ${status}${invitation.expiresAt ? ` · หมดอายุ ${new Date(invitation.expiresAt).toLocaleString('th-TH')}` : ''}`));
    row.append(text);
    if (!invitation.acceptedAt && !invitation.revokedAt && Date.parse(invitation.expiresAt) > Date.now()) {
      const revoke = el('button', 'secondary btn-sm', 'ยกเลิกคำเชิญ'); revoke.type = 'button';
      revoke.addEventListener('click', async () => {
        revoke.disabled = true;
        try { await api(`/api/invitations/${encodeURIComponent(invitation.id)}`, { method: 'DELETE' }); toast('ยกเลิกคำเชิญแล้ว'); await renderMembersPage({ api, toast, showError }); }
        catch (error) { showError(error); revoke.disabled = false; }
      });
      row.append(revoke);
    }
    invitationPanel.append(row);
  }
  stack.append(invitationPanel);
  root.replaceChildren(stack);
}

export function bindInvitationAcceptance({ api }) {
  const form = $('#invite-accept-form');
  if (!form) return;
  const token = new URL(location.href).searchParams.get('token') || '';
  if (token) history.replaceState({}, '', '/invite');
  const message = $('#invite-message');
  if (!token) { form.hidden = true; message.textContent = 'ลิงก์คำเชิญไม่ถูกต้องหรือไม่มี token'; return; }
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    const values = Object.fromEntries(new FormData(form));
    if (values.password !== values.passwordConfirmation) { message.textContent = 'รหัสผ่านทั้งสองช่องไม่ตรงกัน'; return; }
    button.disabled = true;
    message.textContent = '';
    try {
      await api('/api/invitations/accept', { method: 'POST', body: { token, ...values } });
      form.hidden = true;
      message.textContent = 'เปิดใช้งานบัญชีแล้ว เข้าสู่ระบบด้วยอีเมลและรหัสผ่านใหม่ได้เลย';
    } catch (error) { message.textContent = error.message; button.disabled = false; }
  });
}
