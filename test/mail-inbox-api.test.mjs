import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { hashPassword } from '../src/auth.mjs';
import { readMessage } from '../src/mail-message.mjs';
import { start, login, request } from './support/server.mjs';

const verified = () => ({ status: 'verified', checkedAt: new Date().toISOString(), detail: null });
const dnsStubs = (calls = []) => ({
  mailHostnameCheck: async () => ({ status: 'ok', proxied: false }),
  mailMxCheck: async (domain) => { calls.push(`mx:${domain}`); return verified(); },
  mailSpfCheck: async (domain) => { calls.push(`spf:${domain}`); return verified(); },
  mailDkimCheck: async (selector, domain) => { calls.push(`dkim:${domain}`); return verified(); },
  mailDmarcCheck: async (domain) => { calls.push(`dmarc:${domain}`); return verified(); },
  mailPtrCheck: async () => verified()
});

// The sandbox mail service, configured through the same API the interface uses.
async function sandbox(t, options = {}) {
  const calls = [];
  const { app, base } = await start({ ...dnsStubs(calls), ...options });
  t.after(() => app.close());
  const headers = await login(base);
  const post = async (path, body = {}, expected = 200) => {
    const result = await request(base, path, headers, 'POST', body);
    assert.equal(result.status, expected, `${path} → ${result.status} ${JSON.stringify(result.body)}`);
    return result.body;
  };
  await post('/api/mail/hostname', { hostname: 'mail.example.test' });
  await post('/api/mail/domains', { domain: 'example.test' });
  await post('/api/mail/outbound-mode', { mode: 'direct' });
  await post('/api/tools/mail/install', { confirm: true });
  await post('/api/mail/configure', { confirm: true });
  const hello = (await post('/api/mail/mailboxes', { domain: 'example.test', localPart: 'hello', displayName: 'สมชาย ใจดี', password: 'Mailbox-Pass-1!' }, 201)).mailbox;
  const support = (await post('/api/mail/mailboxes', { domain: 'example.test', localPart: 'support', displayName: 'Support', password: 'Mailbox-Pass-2!' }, 201)).mailbox;
  const get = (path) => request(base, path, { cookie: headers.cookie });
  return { app, base, headers, post, get, hello, support, calls };
}

test('the sandbox mailbox sends, files a Sent copy, delivers locally and reads the message back', async (t) => {
  const { app, post, get, hello, support } = await sandbox(t);
  const folders = (await get(`/api/mail/mailboxes/${hello.id}/folders`)).body;
  assert.equal(folders.mailbox.address, 'hello@example.test');
  assert.deepEqual(folders.folders.map((folder) => [folder.id, folder.total]), [['INBOX', 0], ['Sent', 0], ['Drafts', 0], ['Junk', 0], ['Trash', 0]]);

  const sent = await post(`/api/mail/mailboxes/${hello.id}/send`, { to: 'Support <support@example.test>, outside@example.net', cc: ['copy@example.net'], bcc: 'hidden@example.net', subject: 'นัดประชุมวันศุกร์', text: 'เจอกัน 14:00 ครับ\nบรรทัดที่สอง' });
  assert.equal(sent.status, 'simulated');
  assert.equal(sent.savedToSent, true);
  assert.match(sent.messageId, /@example\.test>$/);

  const sentList = (await get(`/api/mail/mailboxes/${hello.id}/messages?folder=Sent`)).body;
  assert.equal(sentList.total, 1);
  assert.equal(sentList.unread, 0);
  const copy = sentList.messages[0];
  assert.equal(copy.seen, true);
  assert.equal(copy.subject, 'นัดประชุมวันศุกร์');
  assert.deepEqual(copy.to.map((item) => item.address), ['support@example.test', 'outside@example.net']);
  assert.match(copy.snippet, /^เจอกัน 14:00 ครับ/);

  const inbox = (await get(`/api/mail/mailboxes/${support.id}/messages`)).body;
  assert.equal(inbox.total, 1);
  assert.equal(inbox.unread, 1);
  const incoming = inbox.messages[0];
  assert.deepEqual(incoming.from, { name: 'สมชาย ใจดี', address: 'hello@example.test' });
  assert.equal(incoming.seen, false);

  const path = `/api/mail/mailboxes/${support.id}/messages/${encodeURIComponent(incoming.id)}`;
  const opened = (await get(path)).body.message;
  assert.equal(opened.text.trim(), 'เจอกัน 14:00 ครับ\nบรรทัดที่สอง');
  assert.equal(opened.html, '');
  assert.deepEqual(opened.cc.map((item) => item.address), ['copy@example.net']);
  assert.equal(opened.messageId, sent.messageId);
  // Reading does not change anything by itself; the interface marks the message explicitly.
  assert.equal(opened.seen, false);
  const raw = (await app.mailStore.read(support, 'INBOX', incoming.id)).content.toString('latin1');
  assert.doesNotMatch(raw, /hidden@example\.net/, 'a Bcc recipient is never written into the message');

  assert.deepEqual(await post(`${path}/flags`, { seen: true, flagged: true }), { ok: true, id: incoming.id, seen: true, flagged: true, answered: false, draft: false });
  assert.equal((await get(`/api/mail/mailboxes/${support.id}/folders`)).body.folders[0].unread, 0);

  // A reply marks the original as answered and threads on its Message-ID.
  await post(`/api/mail/mailboxes/${support.id}/send`, { to: 'hello@example.test', subject: 'Re: นัดประชุมวันศุกร์', text: 'รับทราบ', inReplyTo: opened.messageId, references: [opened.messageId, 'not a reference'], answered: { folder: 'INBOX', id: incoming.id } });
  assert.equal((await get(path)).body.message.answered, true);
  const reply = (await get(`/api/mail/mailboxes/${hello.id}/messages`)).body.messages[0];
  const replyMessage = (await get(`/api/mail/mailboxes/${hello.id}/messages/${encodeURIComponent(reply.id)}`)).body.message;
  assert.deepEqual(replyMessage.references, [opened.messageId]);

  // Junk is an ordinary move, and the message is then found only there.
  assert.deepEqual(await post(`${path}/move`, { to: 'Junk' }), { ok: true, id: incoming.id, folder: 'Junk' });
  const junkPath = `${path}?folder=Junk`;
  assert.equal((await get(junkPath)).status, 200);
  assert.equal((await get(path)).status, 404);
  const audit = app.store.snapshot().audit.filter((event) => event.action === 'mail.message_send');
  assert.equal(audit.length, 2);
  assert.ok(!JSON.stringify(audit).includes('เจอกัน'), 'message text never reaches the audit log');
});

test('deleting goes to Trash first, and attachments are always a download', async (t) => {
  const { app, base, headers, get, hello } = await sandbox(t);
  const pdf = Buffer.from('%PDF-1.4\nbinary\u0000data');
  const raw = Buffer.concat([
    Buffer.from(['From: Shop <shop@vendor.example>', 'To: hello@example.test', 'Subject: Invoice', 'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="b"', '',
      '--b', 'Content-Type: text/html; charset=utf-8', '', '<p onclick="steal()">Hello<script>steal()</script></p>',
      '--b', 'Content-Type: text/html; name="ใบแจ้งหนี้.html"', 'Content-Disposition: attachment; filename="ใบแจ้งหนี้.html"', 'Content-Transfer-Encoding: base64', '', Buffer.from('<script>alert(document.cookie)</script>').toString('base64'),
      '--b', 'Content-Type: application/pdf; name="invoice.pdf"', 'Content-Disposition: attachment; filename="invoice.pdf"', 'Content-Transfer-Encoding: base64', '', pdf.toString('base64'),
      '--b--', ''].join('\r\n'))
  ]);
  const { id } = await app.mailStore.append(hello, 'INBOX', raw);
  const path = `/api/mail/mailboxes/${hello.id}/messages/${encodeURIComponent(id)}`;
  const message = (await get(path)).body.message;
  // The sender's markup is passed on as data; the interface shows it only in a sandboxed frame.
  assert.match(message.html, /<script>/);
  assert.deepEqual(message.attachments, [
    { index: 0, filename: 'ใบแจ้งหนี้.html', contentType: 'text/html', size: 39 },
    { index: 1, filename: 'invoice.pdf', contentType: 'application/pdf', size: pdf.length }
  ]);
  const listed = (await get(`/api/mail/mailboxes/${hello.id}/messages`)).body.messages[0];
  assert.equal(listed.hasAttachments, true);

  for (const [index, expected] of [[0, Buffer.from('<script>alert(document.cookie)</script>')], [1, pdf]]) {
    const response = await fetch(`${base}${path}/attachments/${index}`, { headers: { cookie: headers.cookie } });
    assert.equal(response.status, 200);
    // Even an HTML attachment is never rendered on the Portal origin.
    assert.equal(response.headers.get('content-type'), 'application/octet-stream');
    assert.match(response.headers.get('content-disposition'), /^attachment; filename="/);
    assert.match(response.headers.get('content-security-policy'), /sandbox/);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(Buffer.from(await response.arrayBuffer()).equals(expected), true);
  }
  assert.match((await fetch(`${base}${path}/attachments/0`, { headers: { cookie: headers.cookie } })).headers.get('content-disposition'), /filename\*=UTF-8''%E0%B9%83/);
  assert.equal((await get(`${path}/attachments/2`)).status, 404);

  const remove = (target) => request(base, target, headers, 'DELETE', {});
  assert.deepEqual((await remove(path)).body, { ok: true, erased: false, folder: 'Trash' });
  assert.equal((await get(path)).status, 404);
  assert.equal((await get(`${path}?folder=Trash`)).status, 200);
  assert.deepEqual((await remove(`${path}?folder=Trash`)).body, { ok: true, erased: true });
  assert.equal((await get(`${path}?folder=Trash`)).status, 404);
});

test('mailbox reading is for a signed-in Master, changes need the CSRF token, and bad references are refused', async (t) => {
  const { app, base, headers, post, get, hello } = await sandbox(t);
  const { id } = await app.mailStore.append(hello, 'INBOX', Buffer.from('Subject: private\n\nsecret text\n'));
  const messages = `/api/mail/mailboxes/${hello.id}/messages`;
  const one = `${messages}/${encodeURIComponent(id)}`;

  for (const path of [`/api/mail/mailboxes/${hello.id}/folders`, messages, one, `${one}/attachments/0`]) {
    assert.equal((await request(base, path)).status, 401, `anonymous ${path}`);
  }
  assert.equal((await request(base, `/api/mail/mailboxes/${hello.id}/send`, { cookie: headers.cookie, 'content-type': 'application/json' }, 'POST', { to: 'a@example.net', subject: 'x' })).status, 403);
  assert.equal((await request(base, `${one}/flags`, { cookie: headers.cookie, 'content-type': 'application/json' }, 'POST', { seen: true })).status, 403);
  assert.equal((await request(base, one, { cookie: headers.cookie, 'content-type': 'application/json' }, 'DELETE', {})).status, 403);

  // A member with every organization permission still cannot read host mailboxes.
  const organizationId = randomUUID();
  const userId = randomUUID();
  await app.store.update((state) => {
    state.organizations.push({ id: organizationId, name: 'Members' });
    state.users.push({ id: userId, email: 'member@example.test', password: hashPassword('Member-Test-Password-739!'), role: 'user', status: 'active', authVersion: 1 });
    state.memberships.push({ userId, organizationId, permissions: ['project.view', 'project.configure', 'env.read', 'logs.read', 'audit.read', 'domains.manage'] });
  });
  const member = await login(base, 'member@example.test', 'Member-Test-Password-739!');
  for (const path of ['/api/mail', `/api/mail/mailboxes/${hello.id}/folders`, messages, one]) assert.equal((await request(base, path, member)).status, 403, `member ${path}`);
  assert.equal((await request(base, `/api/mail/mailboxes/${hello.id}/send`, member, 'POST', { to: 'a@example.net', subject: 'x' })).status, 403);

  assert.equal((await get(`/api/mail/mailboxes/${randomUUID()}/messages`)).status, 404);
  assert.equal((await get(`${messages}?folder=..%2F..%2Fetc`)).status, 400);
  assert.equal((await get(`${messages}/${encodeURIComponent('../../etc/passwd')}`)).status, 400, 'a path is not a message reference');
  assert.equal((await get(`${messages}/1700000000.M1P1.nowhere`)).status, 404);
  await post(`${one}/move`, { to: '../outside' }, 400);
  await post(`${one}/flags`, { answered: true }, 400);

  await post(`/api/mail/mailboxes/${hello.id}/send`, { subject: 'no recipient', text: 'x' }, 400);
  await post(`/api/mail/mailboxes/${hello.id}/send`, { to: 'not-an-address', subject: 'x' }, 400);
  await post(`/api/mail/mailboxes/${hello.id}/send`, { to: 'a@example.net' }, 400);
  await post(`/api/mail/mailboxes/${hello.id}/send`, { to: Array.from({ length: 51 }, (_, index) => `u${index}@example.net`), subject: 'too many' }, 400);
  // A subject cannot smuggle a header.
  await post(`/api/mail/mailboxes/${hello.id}/send`, { to: 'a@example.net', subject: 'Hi\r\nBcc: victim@example.net', text: 'x' });
  const sent = (await get(`${messages}?folder=Sent`)).body.messages[0];
  const raw = (await app.mailStore.read(hello, 'Sent', sent.id)).content.toString('latin1');
  assert.doesNotMatch(raw, /^Bcc:/m);
  assert.equal(readMessage(Buffer.from(raw, 'latin1')).subject, 'Hi Bcc: victim@example.net');
});

test('automatic DNS re-checks are audited only when a record changes state', async (t) => {
  const { app, post, calls } = await sandbox(t);
  const count = () => app.store.snapshot().audit.filter((event) => event.action === 'mail.dns_check').length;
  assert.equal(calls.length, 0, 'adding a domain does not wait for a DNS check');
  const first = await post('/api/mail/domains/example.test/dns-check', { record: 'all', background: true });
  assert.deepEqual(Object.values(first.mail.domains[0].dns).map((item) => item.status), ['verified', 'verified', 'verified', 'verified']);
  assert.equal(first.mail.domains[0].mailboxCount, 2);
  assert.equal(count(), 1);
  await post('/api/mail/domains/example.test/dns-check', { record: 'all', background: true });
  await post('/api/mail/domains/example.test/dns-check', { record: 'all', background: true });
  assert.equal(count(), 1);
  await post('/api/mail/domains/example.test/dns-check', { record: 'all' });
  assert.equal(count(), 2, 'a check the owner asked for is always recorded');
});

// A real host: every change is one typed request to the root helper. The helper here
// is a recorder; it certifies what the Portal asks for, not Postfix or Dovecot themselves.
async function host(t, { fail = () => null } = {}) {
  const requests = [];
  const delivered = [];
  let app;
  const mailHelper = async (socketPath, helperRequest) => {
    assert.equal(socketPath, '/run/test/helper.sock');
    const state = app.store.snapshot().mail;
    requests.push({ ...helperRequest, domainsAtCall: state.domains.map((item) => item.domain) });
    const failure = fail(helperRequest);
    if (failure) return { ok: false, error: failure };
    if (helperRequest.operation === 'mail-store') {
      const spool = join(dirname(started.dataPath), 'mail-outbox', `${helperRequest.spool}.eml`);
      requests[requests.length - 1].spooled = await readFile(spool);
      return { ok: true, id: '1700000000.M1P1.host,S=1', folder: helperRequest.folder };
    }
    return { ok: true };
  };
  const started = await start({
    mode: 'host', autoSyncPollingEnabled: false, projectRuntimeProbe: async () => ({ state: 'active' }), ...dnsStubs(),
    mailHelper, mailHelperSocket: '/run/test/helper.sock',
    mailDeliver: async (input) => { delivered.push(input); return { ok: true, reply: '250 2.0.0 Ok: queued as 4F1A' }; }
  });
  app = started.app;
  t.after(() => app.close());
  const headers = await login(started.base);
  const open = { ports: [25, 587, 2525].map((port) => ({ port, status: 'open' })) };
  const mailbox = { id: randomUUID(), domain: 'example.test', localPart: 'hello', displayName: 'Hello', createdAt: new Date().toISOString(), simulated: false };
  await app.store.update((state) => {
    state.tools.mail = { ...state.tools.mail, status: 'Installed', simulated: false };
    state.mail = {
      ...state.mail, hostname: 'mail.example.test', hostnameCheck: { status: 'ok' }, outboundMode: 'direct', relay: null, ptr: { status: 'verified' },
      readiness: { checkedAt: new Date().toISOString(), outbound: open, inbound: { ports: [25, 587, 993].map((port) => ({ port, status: 'allowed' })) } },
      configure: { status: 'configured', at: new Date().toISOString() },
      domains: [{ domain: 'example.test', dkim: { selectors: [{ selector: 'portal2026', publicKey: 'AAAA', encryptedPrivateKey: null, state: 'active' }] }, dns: { mx: verified(), spf: verified(), dkim: verified(), dmarc: verified() }, createdAt: new Date().toISOString() }],
      mailboxes: [mailbox]
    };
  });
  const call = (method, path, body = {}) => request(started.base, path, headers, method, method === 'GET' ? undefined : body);
  return { app, ...started, headers, requests, delivered, mailbox, call };
}

test('on a configured host a new domain is synchronised at once, without DNS evidence or a second activation', async (t) => {
  const { app, requests, call } = await host(t);
  const added = await call('POST', '/api/mail/domains', { domain: 'newbrand.test' });
  assert.equal(added.status, 200, JSON.stringify(added.body));
  assert.deepEqual(requests.map((item) => item.operation), ['sync-mail-domains']);
  // The helper reads the Portal state, so the domain must be stored before it is asked.
  assert.deepEqual(requests[0].domainsAtCall, ['example.test', 'newbrand.test']);
  const entry = added.body.mail.domains.find((item) => item.domain === 'newbrand.test');
  assert.deepEqual(Object.values(entry.dns).map((item) => item.status), ['pending', 'pending', 'pending', 'pending']);
  assert.match(entry.records.dkim.value, /^v=DKIM1; k=rsa; p=/);

  // A mailbox on a domain whose DNS is still pending is not held back either.
  const mailbox = await call('POST', '/api/mail/mailboxes', { domain: 'newbrand.test', localPart: 'sales', displayName: 'Sales', password: 'Mailbox-Pass-3!' });
  assert.equal(mailbox.status, 201, JSON.stringify(mailbox.body));
  assert.deepEqual(requests.at(-1).operation, 'create-mailbox');

  // Removing it, with its mailbox, is one request to the helper and no reconfiguration.
  assert.equal((await call('DELETE', '/api/mail/domains/newbrand.test')).status, 400, 'a domain with mailboxes needs force');
  const removed = await call('DELETE', '/api/mail/domains/newbrand.test?force=true');
  assert.equal(removed.status, 200, JSON.stringify(removed.body));
  assert.deepEqual({ operation: requests.at(-1).operation, domain: requests.at(-1).domain, force: requests.at(-1).force }, { operation: 'remove-mail-domain', domain: 'newbrand.test', force: true });
  assert.deepEqual(removed.body.mail.domains.map((item) => item.domain), ['example.test']);
  assert.equal(removed.body.mail.mailboxes.length, 1);
  assert.equal(requests.some((item) => item.operation === 'configure-mail'), false);
  assert.deepEqual(app.store.snapshot().audit.filter((event) => event.action.startsWith('mail.domain')).map((event) => `${event.action}:${event.outcome}`), ['mail.domain_remove:success', 'mail.domain_add:success'], 'newest first');
});

test('a domain the host refuses is not kept in the Portal', async (t) => {
  const { app, requests, call } = await host(t, { fail: (helperRequest) => (helperRequest.operation === 'sync-mail-domains' ? 'Postfix address map could not be rebuilt.' : null) });
  const refused = await call('POST', '/api/mail/domains', { domain: 'broken.test' });
  assert.equal(refused.status, 400);
  assert.equal(refused.body.error, 'Postfix address map could not be rebuilt.');
  assert.equal(requests.length, 1);
  assert.deepEqual(app.store.snapshot().mail.domains.map((item) => item.domain), ['example.test']);
  assert.deepEqual(app.store.snapshot().audit.filter((event) => event.action === 'mail.domain_add').map((event) => event.outcome), ['failure', 'success'], 'newest first');
});

test('host configuration no longer waits for domain DNS, but still needs the hostname and PTR evidence', async (t) => {
  const { app, requests, call } = await host(t);
  await app.store.update((state) => { for (const kind of ['mx', 'spf', 'dkim', 'dmarc']) state.mail.domains[0].dns[kind] = { status: 'not_found', checkedAt: null, detail: null }; });
  const configured = await call('POST', '/api/mail/configure', { confirm: true });
  assert.equal(configured.status, 200, JSON.stringify(configured.body));
  assert.deepEqual(requests.map((item) => item.operation), ['configure-mail']);
  await app.store.update((state) => { state.mail.ptr = { status: 'mismatch' }; });
  assert.match((await call('POST', '/api/mail/configure', { confirm: true })).body.error, /PTR/);
  await app.store.update((state) => { state.mail.ptr = { status: 'verified' }; state.mail.hostnameCheck = { status: 'unresolved' }; });
  assert.match((await call('POST', '/api/mail/configure', { confirm: true })).body.error, /hostname/i);
  assert.equal(requests.length, 1);
});

test('on a host a message goes to the local mail server and its Sent copy travels by spool reference', async (t) => {
  const { requests, delivered, mailbox, call, dataPath } = await host(t);
  const sent = await call('POST', `/api/mail/mailboxes/${mailbox.id}/send`, { to: 'a@example.net', cc: 'b@example.net', bcc: 'c@example.net', subject: 'Hello', text: 'From the Portal' });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  assert.deepEqual({ status: sent.body.status, detail: sent.body.detail, savedToSent: sent.body.savedToSent }, { status: 'queued', detail: '250 2.0.0 Ok: queued as 4F1A', savedToSent: true });
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].tlsServername, 'mail.example.test');
  assert.deepEqual({ host: delivered[0].host, port: delivered[0].port, from: delivered[0].from, recipients: delivered[0].recipients }, { host: '127.0.0.1', port: 25, from: 'hello@example.test', recipients: ['a@example.net', 'b@example.net', 'c@example.net'] });
  const message = readMessage(delivered[0].message);
  assert.deepEqual(message.from, { name: 'Hello', address: 'hello@example.test' });
  assert.doesNotMatch(delivered[0].message.toString('latin1'), /c@example\.net/);

  const store = requests.find((item) => item.operation === 'mail-store');
  assert.deepEqual({ domain: store.domain, localPart: store.localPart, folder: store.folder, flags: store.flags }, { domain: 'example.test', localPart: 'hello', folder: 'Sent', flags: 'S' });
  assert.equal(store.spooled.equals(delivered[0].message), true);
  assert.deepEqual(await readdir(join(dirname(dataPath), 'mail-outbox')), [], 'nothing is left in the spool');

  // Reading goes through the helper too, by mailbox and message reference only.
  await call('GET', `/api/mail/mailboxes/${mailbox.id}/folders`);
  const listRequest = requests.at(-1);
  assert.deepEqual({ operation: listRequest.operation, domain: listRequest.domain, localPart: listRequest.localPart }, { operation: 'mail-folders', domain: 'example.test', localPart: 'hello' });
});

test('a message the mail server refuses is reported, audited and not filed as sent', async (t) => {
  const requests = [];
  const { app, base } = await start({
    mode: 'host', autoSyncPollingEnabled: false, projectRuntimeProbe: async () => ({ state: 'active' }),
    mailHelper: async (socketPath, helperRequest) => { requests.push(helperRequest); return { ok: true }; }, mailHelperSocket: '/run/test/helper.sock',
    mailDeliver: async () => { throw new Error('SMTP command failed: 550 5.1.1 <nobody@example.test>: Recipient address rejected'); }
  });
  t.after(() => app.close());
  const headers = await login(base);
  const mailbox = { id: randomUUID(), domain: 'example.test', localPart: 'hello', displayName: 'Hello', createdAt: new Date().toISOString() };
  await app.store.update((state) => { state.mail = { ...state.mail, configure: { status: 'configured' }, mailboxes: [mailbox] }; });
  const result = await request(base, `/api/mail/mailboxes/${mailbox.id}/send`, headers, 'POST', { to: 'nobody@example.test', subject: 'x', text: 'y' });
  assert.equal(result.status, 400);
  assert.match(result.body.error, /550 5.1.1/);
  assert.equal(requests.some((item) => item.operation === 'mail-store'), false);
  assert.deepEqual(app.store.snapshot().audit.filter((event) => event.action === 'mail.message_send').map((event) => event.outcome), ['failure']);
});
