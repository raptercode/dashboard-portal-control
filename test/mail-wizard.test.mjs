import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkDkimRecord, checkDmarcRecord, checkMailMx, checkPtrRecord, checkSpfRecord } from '../src/dns-check.mjs';
import { InputError } from '../src/core.mjs';
import { dkimSelector, generateDkimKeyPair, mailDnsRecords, smtpSubmit, spfValue, suggestMailDefaults, validateLocalPart, validateOutboundMode } from '../src/mail-service.mjs';
import { createApplication } from '../src/server.mjs';

test('mail DNS record checks classify verified, mismatch, and missing records', async () => {
  const mx = (records) => ({ resolveMx: async () => records });
  assert.equal((await checkMailMx('example.test', 'mail.example.test', mx([{ exchange: 'MAIL.example.test.', priority: 10 }]))).status, 'verified');
  assert.equal((await checkMailMx('example.test', 'mail.example.test', mx([{ exchange: 'other.example.test' }]))).status, 'mismatch');
  const notFound = { resolveMx: async () => { throw Object.assign(new Error('none'), { code: 'ENODATA' }); } };
  assert.equal((await checkMailMx('example.test', 'mail.example.test', notFound)).status, 'not_found');

  const txt = (records) => ({ resolveTxt: async () => records });
  assert.equal((await checkSpfRecord('example.test', 'include:spf.smtp2go.com', txt([['v=spf1 include:spf.smtp2go.com ~all']]))).status, 'verified');
  assert.equal((await checkSpfRecord('example.test', 'include:spf.smtp2go.com', txt([['v=spf1 mx ~all']]))).status, 'mismatch');
  assert.equal((await checkSpfRecord('example.test', 'a:mail.example.test', txt([['v=spf1 a:mail.example.test ~all'], ['v=spf1 mx ~all']]))).status, 'mismatch');
  assert.equal((await checkSpfRecord('example.test', 'mx', txt([['unrelated']]))).status, 'not_found');

  // Long DKIM keys arrive as chunked TXT strings that must be joined.
  assert.equal((await checkDkimRecord('portal2026', 'example.test', 'ABC123', txt([['v=DKIM1; k=rsa; ', 'p=ABC123']]))).status, 'verified');
  assert.equal((await checkDkimRecord('portal2026', 'example.test', 'ABC123', txt([['v=DKIM1; p=WRONG']]))).status, 'mismatch');

  assert.equal((await checkDmarcRecord('example.test', txt([['v=DMARC1; p=none; rua=mailto:x@example.test']]))).status, 'verified');
  assert.equal((await checkDmarcRecord('example.test', txt([['v=DMARC1; rua=mailto:x@example.test']]))).status, 'mismatch');

  const ptrOk = await checkPtrRecord('mail.example.test', { addresses: ['203.0.113.10'], reverse: async () => ['mail.example.test'] });
  assert.equal(ptrOk.status, 'verified');
  const ptrMiss = await checkPtrRecord('mail.example.test', { addresses: ['203.0.113.10'], reverse: async () => ['vps.provider.net'] });
  assert.equal(ptrMiss.status, 'mismatch');
});

test('mail service generates DKIM keys, DNS values, and validates inputs', () => {
  const keyPair = generateDkimKeyPair('portal2026');
  assert.equal(keyPair.selector, 'portal2026');
  assert.match(keyPair.publicKey, /^[A-Za-z0-9+/]+={0,2}$/);
  assert.match(keyPair.privateKeyPem, /BEGIN PRIVATE KEY/);
  assert.match(dkimSelector(new Date('2026-08-16')), /^portal2026$/);

  const records = mailDnsRecords({ hostname: 'mail.example.test', domain: 'example.test', mode: 'relay-587', relayHost: 'mail.smtp2go.com', selector: 'portal2026', publicKey: keyPair.publicKey });
  assert.equal(records.mx.value, 'example.test.  MX  10  mail.example.test.');
  assert.deepEqual(records.mx.provider, { type: 'MX', host: '@', value: 'mail.example.test', priority: 10, ttl: 'Auto' });
  assert.equal(records.spf.value, 'v=spf1 include:spf.smtp2go.com ~all');
  assert.deepEqual(records.spf.provider, { type: 'TXT', host: '@', value: 'v=spf1 include:spf.smtp2go.com ~all', priority: null, ttl: 'Auto' });
  assert.equal(records.dkim.name, 'portal2026._domainkey.example.test');
  assert.equal(records.dkim.provider.host, 'portal2026._domainkey');
  assert.match(records.dmarc.value, /^v=DMARC1; p=none/);
  assert.equal(spfValue({ mode: 'direct', hostname: 'mail.example.test' }), 'v=spf1 mx a:mail.example.test ~all');

  assert.equal(validateLocalPart(' Portal '), 'portal');
  assert.throws(() => validateLocalPart('a..b'), InputError);
  assert.throws(() => validateLocalPart('-lead'), InputError);
  assert.equal(validateOutboundMode({ mode: 'direct' }).relay, null);
  const relay = validateOutboundMode({ mode: 'relay-587', relay: { host: 'Mail.SMTP2GO.com', port: 587, username: 'user', password: 'pw' } });
  assert.equal(relay.relay.host, 'mail.smtp2go.com');
  assert.throws(() => validateOutboundMode({ mode: 'relay-587', relay: { host: 'mail.smtp2go.com', port: 587, username: '', password: 'pw' } }), InputError);
  assert.throws(() => validateOutboundMode({ mode: 'api-only' }), InputError);

  assert.deepEqual(
    suggestMailDefaults([{ domains: { hosts: ['app.example.test', 'www.example.test'] } }, { domains: { hosts: ['other.net'] } }]),
    { hostname: 'mail.example.test', domains: ['example.test', 'other.net'] }
  );
});

test('SMTP submission performs EHLO, AUTH, and DATA against a scripted server', async (t) => {
  const exchanges = [];
  const server = createServer((socket) => {
    socket.setEncoding('utf8');
    socket.write('220 fake.relay ESMTP\r\n');
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk;
      let boundary;
      while ((boundary = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        exchanges.push(line);
        if (line.startsWith('EHLO')) socket.write('250-fake.relay\r\n250 AUTH PLAIN\r\n');
        else if (line.startsWith('AUTH PLAIN')) socket.write('235 2.7.0 accepted\r\n');
        else if (line.startsWith('MAIL FROM')) socket.write('250 sender ok\r\n');
        else if (line.startsWith('RCPT TO')) socket.write('250 recipient ok\r\n');
        else if (line === 'DATA') socket.write('354 go ahead\r\n');
        else if (line === '.') socket.write('250 2.0.0 queued as demo123\r\n');
        else if (line === 'QUIT') { socket.write('221 bye\r\n'); socket.end(); }
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());

  const result = await smtpSubmit({
    host: '127.0.0.1',
    port: server.address().port,
    username: 'user',
    password: 'pw',
    from: 'portal@example.test',
    to: 'owner@gmail.test',
    subject: 'Test',
    body: 'hello\n.leading dot line'
  });
  assert.equal(result.ok, true);
  assert.match(result.reply, /^250 2\.0\.0 queued/);
  assert.ok(exchanges.some((line) => line.startsWith('AUTH PLAIN ')));
  assert.ok(exchanges.includes('..leading dot line'));

  await assert.rejects(smtpSubmit({ host: '127.0.0.1', port: server.address().port, username: 'user', password: 'pw', from: 'x@example.test', to: 'fail@example.test', subject: 's', body: 'b', connect: () => { throw new Error('boom'); } }));
});

test('mail wizard API walks hostname → domain → dns → mode → install → configure → mailbox → test send in demo mode', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'hostmgr-mailwiz-'));
  const dnsCalls = [];
  const verified = () => ({ status: 'verified', checkedAt: new Date().toISOString(), detail: null });
  const sent = [];
  const app = await createApplication({
    dataPath: join(dir, 'state.sqlite'),
    password: 'correct-horse-battery-staple',
    secretKey: Buffer.alloc(32, 7).toString('base64'),
    mode: 'demo',
    sandboxClone: false,
    metricsEnabled: false,
    mailHostnameCheck: async (hostname) => { dnsCalls.push(`hostname:${hostname}`); return { status: 'ok', proxied: false }; },
    mailMxCheck: async (domain) => { dnsCalls.push(`mx:${domain}`); return verified(); },
    mailSpfCheck: async (domain, token) => { dnsCalls.push(`spf:${domain}:${token}`); return verified(); },
    mailDkimCheck: async (selector, domain) => { dnsCalls.push(`dkim:${selector}:${domain}`); return verified(); },
    mailDmarcCheck: async (domain) => { dnsCalls.push(`dmarc:${domain}`); return verified(); },
    mailPtrCheck: async (hostname) => { dnsCalls.push(`ptr:${hostname}`); return { status: 'mismatch', checkedAt: new Date().toISOString(), detail: 'No PTR resolves to mail.example.test.' }; },
    mailSend: async (input) => { sent.push(input); return { ok: true, reply: '250 2.0.0 queued as fake' }; }
  });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;

  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'owner@local.test', password: 'correct-horse-battery-staple' }) });
  const session = await login.json();
  const headers = { cookie: login.headers.get('set-cookie').split(';')[0], 'content-type': 'application/json', 'x-csrf-token': session.csrfToken };
  const post = async (path, body, expected = 200) => {
    const response = await fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
    assert.equal(response.status, expected, `${path} → ${response.status}`);
    return response.json();
  };

  assert.equal((await fetch(`${base}/api/mail`, { method: 'GET' })).status, 401);

  const afterHostname = await post('/api/mail/hostname', { hostname: 'Mail.Example.Test' });
  assert.equal(afterHostname.mail.hostname, 'mail.example.test');

  const afterDomain = await post('/api/mail/domains', { domain: 'example.test' });
  assert.equal(afterDomain.mail.domains.length, 1);
  const domainView = afterDomain.mail.domains[0];
  assert.equal(domainView.dkimSelector, dkimSelector());
  assert.match(domainView.records.dkim.value, /^v=DKIM1; k=rsa; p=/);
  assert.ok(!JSON.stringify(afterDomain).includes('PRIVATE KEY'), 'private key must never reach the browser');

  await post('/api/mail/outbound-mode', { mode: 'relay-587', relay: { host: 'mail.smtp2go.com', port: 587, username: 'relay-user', password: 'relay-pass-123' } });
  const dnsChecked = await post('/api/mail/domains/example.test/dns-check', { record: 'all' });
  assert.deepEqual(Object.values(dnsChecked.mail.domains[0].dns).map((item) => item.status), ['verified', 'verified', 'verified', 'verified']);
  assert.ok(dnsCalls.includes('spf:example.test:include:spf.smtp2go.com'));

  const ptr = await post('/api/mail/ptr-check', {});
  assert.equal(ptr.mail.ptr.status, 'mismatch');

  // Configure must be blocked until the mail packages are installed.
  const blocked = await fetch(`${base}/api/mail/configure`, { method: 'POST', headers, body: JSON.stringify({ confirm: true }) });
  assert.equal(blocked.status, 400);
  await post('/api/tools/mail/install', { confirm: true });
  const configured = await post('/api/mail/configure', { confirm: true });
  assert.equal(configured.mail.configure.status, 'configured');
  assert.equal(configured.mail.configure.simulated, true);

  const mailbox = await post('/api/mail/mailboxes', { domain: 'example.test', localPart: 'portal', displayName: 'Portal Ops', password: 'Mailbox-Pass-1!' }, 201);
  assert.equal(mailbox.mailbox.domain, 'example.test');
  await post('/api/mail/mailboxes', { domain: 'example.test', localPart: 'portal', displayName: '', password: 'Mailbox-Pass-1!' }, 400);

  const testSend = await post('/api/mail/test/send', { mailboxId: mailbox.mailbox.id, to: 'owner@example.net' });
  assert.equal(testSend.test.status, 'passed');
  assert.match(testSend.test.detail, /^250/);
  assert.equal(sent[0].host, 'mail.smtp2go.com');
  assert.equal(sent[0].password, 'relay-pass-123');
  assert.equal(sent[0].from, 'portal@example.test');

  // Reload from disk: the whole mail state must survive, without plaintext secrets.
  const settings = await (await fetch(`${base}/api/mail`, { headers })).json();
  assert.equal(settings.mail.relay.hasPassword, true);
  assert.ok(!JSON.stringify(settings).includes('relay-pass-123'));

  const audit = await (await fetch(`${base}/api/audit`, { headers })).json();
  const actions = audit.events.map((event) => event.action);
  for (const expected of ['mail.hostname_configure', 'mail.domain_add', 'mail.outbound_mode_configure', 'mail.dns_check', 'mail.configure', 'mail.mailbox_create', 'mail.test_send']) {
    assert.ok(actions.includes(expected), `missing audit ${expected}`);
  }
  assert.ok(!JSON.stringify(audit).includes('relay-pass-123'));
  assert.ok(!JSON.stringify(audit).includes('Mailbox-Pass-1!'));
});
