import test from 'node:test';
import assert from 'node:assert/strict';
import { composeMessage, decodeBytes, decodeHeader, extractContent, htmlToText, parseAddresses, parseMessage, parseParameterized, readMessage, summarizeMessage } from '../src/mail-message.mjs';

const message = (lines) => Buffer.from(lines.join('\r\n'), 'utf8');

test('header decoding joins encoded words, including a character split across two words', () => {
  assert.equal(decodeHeader('=?UTF-8?Q?Caf=C3=A9_?= =?UTF-8?Q?receipt?='), 'Café receipt');
  assert.equal(decodeHeader('=?utf-8?B?4Liq4Lin4Lix4Liq?= =?utf-8?B?4LiU4Li1?= ok'), 'สวัสดี ok');
  // "ส" is three bytes; a sender that cuts mid-character must not produce replacement characters.
  const bytes = Buffer.from('สวัสดี', 'utf8');
  const split = `=?UTF-8?B?${bytes.subarray(0, 4).toString('base64')}?= =?UTF-8?B?${bytes.subarray(4).toString('base64')}?=`;
  assert.equal(decodeHeader(split), 'สวัสดี');
  assert.equal(decodeHeader('=?TIS-620?B?ysfR%3D?='.replace('%3D', '=')), decodeBytes(Buffer.from([0xca, 0xc7, 0xd1]), 'tis-620'));
  // Raw 8-bit UTF-8 in a header is not standard, but common.
  assert.equal(decodeHeader(Buffer.from('ทดสอบ', 'utf8').toString('latin1')), 'ทดสอบ');
  // A decoded value is one line, whatever the sender folded or injected.
  assert.doesNotMatch(decodeHeader('line one\r\n injected: header'), /[\r\n]/);
});

test('address lists keep quoted commas, decode names and skip group labels', () => {
  assert.deepEqual(parseAddresses('"Doe, John" <John@X.com>, =?utf-8?B?4Liq4Lih?= <s@x.co.th>, plain@x.org (Plain Name), undisclosed-recipients:;'), [
    { name: 'Doe, John', address: 'john@x.com' },
    { name: 'สม', address: 's@x.co.th' },
    { name: 'Plain Name', address: 'plain@x.org' }
  ]);
  assert.deepEqual(parseAddresses(''), []);
  assert.equal(parseAddresses(Array.from({ length: 300 }, (_, index) => `u${index}@x.org`).join(', ')).length, 100);
});

test('parameters decode RFC 2231 names, continuations and encoded words', () => {
  assert.deepEqual(parseParameterized('multipart/mixed; boundary="a;b"; charset=utf-8'), { value: 'multipart/mixed', params: { boundary: 'a;b', charset: 'utf-8' } });
  assert.equal(parseParameterized("application/pdf; name*=UTF-8''%E0%B9%83%E0%B8%9A.pdf").params.name, 'ใบ.pdf');
  assert.equal(parseParameterized("attachment; filename*0*=UTF-8''%E0%B9%83; filename*1*=%E0%B8%9A; filename*2=.pdf").params.filename, 'ใบ.pdf');
  assert.equal(parseParameterized('attachment; filename="=?UTF-8?B?4LmD4Lia?=.pdf"').params.filename, 'ใบ.pdf');
});

test('a multipart message yields text, HTML with inline images, and attachments', () => {
  const raw = message([
    'From: "Shop, Inc." <news@shop.example>', 'To: hello@example.test, Other <other@example.test>', 'Cc: boss@example.test',
    'Subject: =?UTF-8?B?4LmD4Lia4LmA4Liq4Lij4LmH4LiI?=', 'Date: Tue, 10 Nov 2026 10:00:00 +0700 (ICT)', 'Message-ID: <m1@shop.example>',
    'References: <a@x> <b@x>', 'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="mix"', '',
    'preamble that is not content',
    '--mix', 'Content-Type: multipart/related; boundary=rel', '',
    '--rel', 'Content-Type: multipart/alternative; boundary=alt', '',
    '--alt', 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: quoted-printable', '', 'Total: 100 =E0=B8=9A=E0=B8=B2=E0=B8=97=', ' today', '',
    '--alt', 'Content-Type: text/html; charset=utf-8', 'Content-Transfer-Encoding: base64', '', Buffer.from('<p>Total <b>100</b><img src="cid:logo@x"><img src="cid:big@x"></p>').toString('base64'), '--alt--',
    '--rel', 'Content-Type: image/png', 'Content-ID: <logo@x>', 'Content-Transfer-Encoding: base64', '', 'iVBORw0KGgo=',
    '--rel', 'Content-Type: image/svg+xml', 'Content-ID: <big@x>', 'Content-Transfer-Encoding: base64', '', Buffer.from('<svg/>').toString('base64'), '--rel--',
    '--mix', "Content-Type: application/pdf; name*=UTF-8''%E0%B9%83%E0%B8%9A.pdf", 'Content-Disposition: attachment', 'Content-Transfer-Encoding: base64', '', 'JVBERi0xLjQK',
    '--mix', 'Content-Type: message/rfc822', '', 'Subject: inner', '', 'inner body', '--mix--', 'epilogue'
  ]);
  const read = readMessage(raw);
  assert.deepEqual(read.from, { name: 'Shop, Inc.', address: 'news@shop.example' });
  assert.deepEqual(read.to.map((item) => item.address), ['hello@example.test', 'other@example.test']);
  assert.equal(read.subject, 'ใบเสร็จ');
  assert.equal(read.date, '2026-11-10T03:00:00.000Z');
  assert.deepEqual(read.references, ['<a@x>', '<b@x>']);
  assert.equal(read.text.trim(), 'Total: 100 บาท today');
  assert.match(read.html, /<img src="data:image\/png;base64,iVBORw0KGgo=">/);
  // Only raster images are inlined. SVG can carry script, so it stays an attachment and its cid: reference is left inert.
  assert.match(read.html, /<img src="cid:big@x">/);
  assert.deepEqual(read.attachments.map((file) => [file.filename, file.contentType, file.size]), [
    ['attachment-2', 'image/svg+xml', 6],
    ['ใบ.pdf', 'application/pdf', 9],
    ['message.eml', 'message/rfc822', 28]
  ]);
  assert.equal(read.attachments[1].content.toString(), '%PDF-1.4\n');
});

test('an HTML-only message gets readable text, and unsafe file names are neutralised', () => {
  const read = readMessage(message([
    'From: a@x.org', 'Content-Type: multipart/mixed; boundary=b', '',
    '--b', 'Content-Type: text/html; charset=windows-874', 'Content-Transfer-Encoding: base64', '',
    Buffer.concat([Buffer.from('<style>p{color:red}</style><p>Hi&nbsp;&amp; bye<br>'), Buffer.from([0xca, 0xc7, 0xd1]), Buffer.from('</p><script>alert(1)</script>')]).toString('base64'),
    '--b', 'Content-Type: application/octet-stream', 'Content-Disposition: attachment; filename="../../etc/pass\\\\wd"', '', 'x', '--b--'
  ]));
  assert.equal(read.text, 'Hi & bye\nสวั');
  assert.equal(read.attachments[0].filename, '_.._etc_pass_wd');
  assert.equal(htmlToText('<div>a</div><div>&#3626;&#x0E27; &lt;b&gt;</div>'), 'a\nสว <b>');
});

test('the list summary works from header fields and a truncated body', () => {
  const headers = message(['From: Ploy <ploy@partner.example>', 'To: hello@example.test', 'Subject: Quote', 'Date: Wed, 11 Nov 2026 09:00:00 +0000', 'Content-Type: multipart/alternative; boundary="alt"']);
  const body = message(['--alt', 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '', Buffer.from('สวัสดีค่ะ รบกวนขอใบเสนอราคา').toString('base64').slice(0, 30)]);
  const summary = summarizeMessage(headers, body);
  assert.equal(summary.from.name, 'Ploy');
  assert.equal(summary.subject, 'Quote');
  assert.equal(summary.date, '2026-11-11T09:00:00.000Z');
  assert.match(summary.snippet, /^สวัสดี/);
  assert.doesNotMatch(summary.snippet, /�$/);
  assert.equal(summary.hasAttachments, false);
  assert.equal(summarizeMessage(message(['Subject: x', 'Content-Type: multipart/mixed; boundary=m'])).hasAttachments, true);
  // Nothing usable must still give a row, never an exception.
  assert.deepEqual(summarizeMessage(Buffer.alloc(0)).from, { name: '', address: '' });
});

test('parsing is bounded in depth and in the number of parts', () => {
  let nested = 'deepest';
  for (let level = 0; level < 30; level += 1) nested = `Content-Type: multipart/mixed; boundary=b${level}\r\n\r\n--b${level}\r\n${nested}\r\n--b${level}--`;
  let depth = 0;
  for (let entity = parseMessage(Buffer.from(nested)); entity.parts; entity = entity.parts[0]) depth += 1;
  assert.equal(depth, 8);
  const wide = `Content-Type: multipart/mixed; boundary=w\r\n\r\n${'--w\r\nContent-Type: text/plain\r\n\r\nx\r\n'.repeat(1000)}--w--`;
  assert.equal(parseMessage(Buffer.from(wide)).parts.length, 200);
  assert.doesNotThrow(() => extractContent(parseMessage(Buffer.from(wide))));
});

test('a composed message survives its own parser and never carries Bcc or raw line breaks', () => {
  const { raw, messageId } = composeMessage({
    from: { name: 'สมชาย, ใจดี', address: 'hello@example.test' }, to: ['a@example.net', 'b@example.net'], cc: ['c@example.net'],
    subject: 'ทดสอบหัวข้อภาษาไทยที่ยาวพอสมควรเพื่อดูการตัดบรรทัด\r\nBcc: victim@example.net', text: 'สวัสดีครับ\n.dot line\nlast',
    inReplyTo: '<q@x>', references: ['<p@x>', '<q@x>'], date: new Date('2026-11-11T09:25:17Z')
  });
  const source = raw.toString('latin1');
  assert.match(messageId, /^<[0-9a-f-]{36}@example\.test>$/);
  assert.doesNotMatch(source, /^Bcc:/m);
  for (const line of source.split('\r\n')) assert.ok(line.length <= 78, `line too long: ${line.length}`);
  assert.match(source, /^Date: Wed, 11 Nov 2026 09:25:17 \+0000$/m);
  const read = readMessage(raw);
  assert.deepEqual(read.from, { name: 'สมชาย, ใจดี', address: 'hello@example.test' });
  assert.deepEqual(read.to.map((item) => item.address), ['a@example.net', 'b@example.net']);
  assert.deepEqual(read.cc.map((item) => item.address), ['c@example.net']);
  assert.equal(read.subject, 'ทดสอบหัวข้อภาษาไทยที่ยาวพอสมควรเพื่อดูการตัดบรรทัด Bcc: victim@example.net');
  assert.equal(read.text.trim(), 'สวัสดีครับ\n.dot line\nlast');
  assert.deepEqual(read.references, ['<p@x>', '<q@x>']);
  const plain = composeMessage({ from: { name: 'Ops', address: 'ops@example.test' }, to: ['a@example.net'], subject: 'Plain', text: 'hello\nworld' }).raw.toString('latin1');
  assert.match(plain, /^From: Ops <ops@example\.test>$/m);
  assert.match(plain, /Content-Transfer-Encoding: 7bit\r\n\r\nhello\r\nworld\r\n$/);
});
