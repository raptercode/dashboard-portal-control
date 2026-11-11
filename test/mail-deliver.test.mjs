import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { smtpDeliver } from '../src/mail-service.mjs';
import { composeMessage, readMessage } from '../src/mail-message.mjs';

// A scripted SMTP server that records the envelope and the exact bytes of DATA.
async function smtpServer(t, { reject = null, startTls = false } = {}) {
  const session = { commands: [], data: null };
  const server = createServer((socket) => {
    socket.write('220 fake.host ESMTP\r\n');
    let buffer = Buffer.alloc(0);
    let inData = false;
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        if (inData) {
          const end = buffer.indexOf('\r\n.\r\n');
          if (end < 0) return;
          session.data = buffer.subarray(0, end + 2);
          buffer = buffer.subarray(end + 5);
          inData = false;
          socket.write('250 2.0.0 Ok: queued as TEST1\r\n');
          continue;
        }
        const boundary = buffer.indexOf('\r\n');
        if (boundary < 0) return;
        const line = buffer.subarray(0, boundary).toString('latin1');
        buffer = buffer.subarray(boundary + 2);
        session.commands.push(line);
        if (line.startsWith('EHLO')) socket.write(startTls && !session.commands.includes('STARTTLS') ? '250-fake.host\r\n250 STARTTLS\r\n' : '250 fake.host\r\n');
        else if (line === 'STARTTLS') socket.write('220 Ready to start TLS\r\n');
        else if (line.startsWith('MAIL FROM')) socket.write('250 2.1.0 Ok\r\n');
        else if (line.startsWith('RCPT TO')) socket.write(reject && line.includes(reject) ? '550 5.1.1 User unknown in virtual mailbox table\r\n' : '250 2.1.5 Ok\r\n');
        else if (line === 'DATA') { inData = true; socket.write('354 End data with <CR><LF>.<CR><LF>\r\n'); }
        else if (line === 'QUIT') { socket.write('221 Bye\r\n'); socket.end(); }
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  return { session, port: server.address().port };
}

test('a composed message reaches every recipient byte for byte, with leading dots restored by the server rules', async (t) => {
  const { session, port } = await smtpServer(t);
  const { raw } = composeMessage({ from: { name: 'สมชาย', address: 'hello@example.test' }, to: ['a@example.net'], cc: ['b@example.net'], subject: 'ทดสอบ', text: 'line one\n.starts with a dot\nสวัสดี' });
  const result = await smtpDeliver({ host: '127.0.0.1', port, from: 'hello@example.test', recipients: ['a@example.net', 'b@example.net', 'c@example.net', 'a@example.net'], message: raw });
  assert.deepEqual(result, { ok: true, reply: '250 2.0.0 Ok: queued as TEST1' });
  assert.deepEqual(session.commands.filter((line) => /^(MAIL|RCPT)/.test(line)), ['MAIL FROM:<hello@example.test>', 'RCPT TO:<a@example.net>', 'RCPT TO:<b@example.net>', 'RCPT TO:<c@example.net>']);
  assert.equal(session.commands.some((line) => line.startsWith('AUTH')), false, 'loopback submission uses no credentials');
  // Undo dot-stuffing as a receiving server does; the result must be the composed message.
  const received = Buffer.from(session.data.toString('latin1').replace(/^\.\./gm, '.'), 'latin1');
  assert.equal(received.equals(raw), true);
  assert.equal(readMessage(received).text.trim(), 'line one\n.starts with a dot\nสวัสดี');
});

test('a plain-text body with a line that is only a dot cannot end the message early', async (t) => {
  const { session, port } = await smtpServer(t);
  const { raw } = composeMessage({ from: { name: '', address: 'ops@example.test' }, to: ['a@example.net'], subject: 'dots', text: 'before\n.\nafter' });
  await smtpDeliver({ host: '127.0.0.1', port, from: 'ops@example.test', recipients: ['a@example.net'], message: raw });
  assert.match(session.data.toString('latin1'), /before\r\n\.\.\r\nafter\r\n$/);
});

test('STARTTLS verifies the configured mail hostname when SMTP connects over loopback', async (t) => {
  const { session, port } = await smtpServer(t, { startTls: true });
  const { raw } = composeMessage({ from: { address: 'ops@example.test' }, to: ['a@example.net'], subject: 'x', text: 'y' });
  await smtpDeliver({
    host: '127.0.0.1', port, tlsServername: 'mail.example.test',
    from: 'ops@example.test', recipients: ['a@example.net'], message: raw,
    upgradeTls: async (socket, servername) => {
      assert.equal(servername, 'mail.example.test');
      return socket;
    }
  });
  assert.deepEqual(session.commands.slice(0, 3), ['EHLO example.test', 'STARTTLS', 'EHLO example.test']);
});

test('one refused recipient stops the send before any message data, and bad addresses never reach the wire', async (t) => {
  const { session, port } = await smtpServer(t, { reject: 'nobody@' });
  const { raw } = composeMessage({ from: { name: '', address: 'ops@example.test' }, to: ['a@example.net'], subject: 'x', text: 'y' });
  await assert.rejects(smtpDeliver({ host: '127.0.0.1', port, from: 'ops@example.test', recipients: ['a@example.net', 'nobody@example.test'], message: raw }), /550 5\.1\.1/);
  assert.equal(session.commands.includes('DATA'), false);
  assert.equal(session.data, null);
  const before = session.commands.length;
  await assert.rejects(smtpDeliver({ host: '127.0.0.1', port, from: 'ops@example.test', recipients: ['a@example.net>\r\nRCPT TO:<victim@example.net'], message: raw }), /invalid/);
  await assert.rejects(smtpDeliver({ host: '127.0.0.1', port, from: 'ops@example.test', recipients: [], message: raw }), /recipient/);
  assert.equal(session.commands.length, before);
});
