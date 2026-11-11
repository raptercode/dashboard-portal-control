#!/usr/bin/env node
// Isolated local workspace. Nothing in this process controls the production host.
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { createApplication } from '../src/server.mjs';
import { generateDkimKeyPair } from '../src/mail-service.mjs';
import { composeMessage } from '../src/mail-message.mjs';

const port = Number(process.env.STRCKRO_PREVIEW_PORT || 4343);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid preview port.');
const directory = await mkdtemp(join(tmpdir(), 'strckro-ui-preview-'));
const app = await createApplication({
  dataPath: join(directory, 'state.json'),
  projectRoot: join(directory, 'projects'),
  password: 'Strckro-Preview-2026!',
  ownerEmail: 'preview@strckro.local',
  secretKey: randomBytes(32).toString('base64'),
  mode: 'demo', sandboxClone: false, metricsEnabled: false,
  secureCookie: false, updateConfig: {},
  portAvailability: async () => true,
  acquireMaintenanceLease: async () => ({ assertHeld() {}, async release() {} })
});
await app.store.update(state => {
  const org = state.organizations[0];
  state.git.identity = { name: 'Strckro preview', email: 'preview@strckro.local' };
  for (const tool of Object.values(state.tools)) { tool.status = 'Installed'; tool.version ||= 'Preview'; }
  const now = Date.now();
  const specs = [
    ['storefront', 'Storefront', 'next', 'node', 'active', 'shop.example.test', 3001],
    ['payments-api', 'Payments API', 'hono', 'bun', 'active', 'api.example.test', 3002],
    ['background-jobs', 'Background jobs', '', 'node', 'idle', '', 3003],
    ['docs-site', 'Documentation', 'astro', 'node', 'failed', 'docs.example.test', 3004]
  ];
  state.projects = specs.map(([slug, name, framework, runtime, phase, domain, port], index) => {
    const createdAt = new Date(now - (index * 18 + 4) * 60000).toISOString();
    const releaseId = `preview-release-${index}`;
    return {
      slug, name, framework, runtime, port, organizationId: org.id, organization: org.name,
      repository: `https://github.com/strckro-demo/${slug}.git`, protocol: 'https', branch: 'main', directory: '/',
      nodeMajor: 24, buildScript: 'build', startScript: 'start', serviceType: slug === 'background-jobs' ? 'worker' : 'web',
      healthCheckEnabled: true, healthCheckPath: '/',
      // Three storage states in the demo: live, live in a nested folder, and not deployed yet.
      ...({ storefront: { storagePath: 'uploads' }, 'payments-api': { storagePath: 'public/uploads' }, 'docs-site': { storagePath: 'data' } }[slug] ?? {}),
      sync: { status: 'synced', revision: `${index + 1}c9e6af41092d8b3`, updatedAt: createdAt },
      domains: { hosts: domain ? [domain] : [], status: domain ? 'active' : 'pending' },
      environment: { keys: ['NODE_ENV', 'API_URL'] },
      deployment: { state: phase, activeReleaseId: phase === 'active' ? releaseId : null, previousReleaseId: null,
        releases: phase === 'idle' ? [] : [{ id: releaseId, revision: `${index + 1}c9e6af41092d8b3`, status: phase, createdAt, activatedAt: phase === 'active' ? createdAt : null, events: [] }] }
    };
  });
});
await seedMail(app);
app.server.listen(port, '127.0.0.1', () => {
  console.log(`Strckro UI preview: http://127.0.0.1:${port}`);
  console.log('Demo login: preview@strckro.local / Strckro-Preview-2026!');
  console.log(`Temporary demo state: ${directory}`);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await app.close(); process.exit(0); });

// A configured mail service with two domains and a few messages, so the mailbox
// reader has something to show. Nothing is sent: the sandbox keeps mail in its temporary directory.
async function seedMail(app) {
  const now = new Date();
  const ago = (minutes) => new Date(now.getTime() - minutes * 60000);
  const verified = { status: 'verified', checkedAt: ago(12).toISOString(), detail: null };
  const missing = (detail) => ({ status: 'not_found', checkedAt: ago(3).toISOString(), detail });
  const domain = (name, dns, minutes) => {
    const key = generateDkimKeyPair();
    return { domain: name, dkim: { selectors: [{ selector: key.selector, publicKey: key.publicKey, encryptedPrivateKey: null, state: 'active' }] }, dns, createdAt: ago(minutes).toISOString() };
  };
  const mailboxes = [
    { id: randomUUID(), domain: 'example.test', localPart: 'hello', displayName: 'Strckro Preview', createdAt: ago(60 * 24 * 9).toISOString(), simulated: true },
    { id: randomUUID(), domain: 'example.test', localPart: 'support', displayName: 'Support Team', createdAt: ago(60 * 24 * 3).toISOString(), simulated: true }
  ];
  await app.store.update((state) => {
    state.mail = {
      ...state.mail,
      hostname: 'mail.example.test',
      hostnameCheck: { status: 'ok', checkedAt: ago(60 * 24 * 9).toISOString(), detail: null },
      outboundMode: 'direct',
      relay: null,
      ptr: verified,
      readiness: {
        checkedAt: ago(60 * 24 * 9).toISOString(),
        outbound: { checkedAt: ago(60 * 24 * 9).toISOString(), ports: [25, 587, 2525].map((item) => ({ port: item, status: 'open', target: 'preview', detail: null })), recommendation: { mode: 'direct', usablePorts: [25, 587, 2525], summary: 'Port 25 is open: this host can run a full mail server with direct MX delivery.', requirements: [] } },
        inbound: { scope: 'local-firewall', checkedAt: ago(60 * 24 * 9).toISOString(), externalReachability: 'unverified', ports: [25, 587, 993].map((item) => ({ port: item, status: 'allowed', source: 'preview', detail: null })) }
      },
      configure: { status: 'configured', simulated: true, at: ago(60 * 24 * 9).toISOString(), detail: 'Simulated: Postfix/Dovecot/OpenDKIM configuration was not applied to this machine.' },
      domains: [
        domain('example.test', { mx: verified, spf: verified, dkim: verified, dmarc: verified }, 60 * 24 * 9),
        domain('shop.example.test', { mx: verified, spf: missing('No SPF record was found.'), dkim: missing('No DKIM record was found for this selector.'), dmarc: { status: 'pending', checkedAt: null, detail: null } }, 45)
      ],
      mailboxes
    };
  });
  const [hello, support] = mailboxes;
  const text = (from, subject, body, minutes, to = ['hello@example.test']) =>
    ({ minutes, raw: composeMessage({ from, to, subject, text: body, date: ago(minutes) }).raw });
  const mime = (lines) => Buffer.from(lines.join('\r\n'), 'utf8');
  const receipt = { minutes: 95, raw: mime([
    'From: "Kanok Bakery" <orders@kanok-bakery.example>',
    'To: hello@example.test',
    'Subject: =?UTF-8?B?4LmD4Lia4LmA4Liq4Lij4LmH4LiI4Lij4Lix4Lia4LmA4LiH4Li04LiZ?= #INV-2041',
    `Date: ${ago(95).toUTCString().replace('GMT', '+0000')}`,
    'Message-ID: <inv-2041@kanok-bakery.example>',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="mixed-1"',
    '',
    '--mixed-1',
    'Content-Type: multipart/alternative; boundary="alt-1"',
    '',
    '--alt-1',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    'ขอบคุณสำหรับคำสั่งซื้อ',
    'ยอดรวม 1,250.00 บาท ชำระแล้วเมื่อวันนี้',
    'ใบเสร็จแนบมากับอีเมลฉบับนี้',
    '',
    '--alt-1',
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    '<div style="font-family:Arial,sans-serif;max-width:520px">',
    '<h2 style="margin:0 0 8px;color:#7a4b12">Kanok Bakery</h2>',
    '<p>ขอบคุณสำหรับคำสั่งซื้อ <b>#INV-2041</b></p>',
    '<table style="width:100%;border-collapse:collapse" cellpadding="8">',
    '<tr style="background:#f6efe4"><th align="left">รายการ</th><th align="right">ราคา</th></tr>',
    '<tr><td>ครัวซองต์เนยสด × 12</td><td align="right">900.00</td></tr>',
    '<tr><td>กาแฟดริป × 5</td><td align="right">350.00</td></tr>',
    '<tr><td><b>รวม</b></td><td align="right"><b>1,250.00 บาท</b></td></tr>',
    '</table>',
    '<p><a href="https://kanok-bakery.example/orders/2041">ดูคำสั่งซื้อ</a></p>',
    '<img src="https://kanok-bakery.example/pixel.gif" width="1" height="1" alt="">',
    '</div>',
    '--alt-1--',
    '--mixed-1',
    'Content-Type: application/pdf; name="INV-2041.pdf"',
    'Content-Disposition: attachment; filename="INV-2041.pdf"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from('%PDF-1.4\n% Strckro preview attachment\n').toString('base64'),
    '--mixed-1--',
    ''
  ]) };
  const inbox = [
    text({ name: 'Uptime Monitor', address: 'alerts@monitor.example' }, 'Resolved: storefront responded in 182 ms', 'The check for https://shop.example.test recovered after 2 minutes.\n\nNo action is needed.', 60 * 26),
    text({ name: 'ธนาคารตัวอย่าง', address: 'no-reply@bank.example' }, 'แจ้งเตือนการเข้าสู่ระบบจากอุปกรณ์ใหม่', 'มีการเข้าสู่ระบบจากอุปกรณ์ใหม่เมื่อสักครู่\nหากไม่ใช่คุณ โปรดเปลี่ยนรหัสผ่านทันที', 60 * 5),
    receipt,
    text({ name: 'Ploy Sirikul', address: 'ploy@partner.example' }, 'ขอใบเสนอราคาสำหรับโปรเจคใหม่', 'สวัสดีค่ะ\n\nรบกวนขอใบเสนอราคาสำหรับระบบร้านค้าออนไลน์ ต้องการเริ่มงานภายในเดือนหน้า\nรายละเอียดเพิ่มเติมดูได้ที่ https://partner.example/brief\n\nขอบคุณค่ะ\nพลอย', 18)
  ];
  const store = (mailbox, folder, message, flags = '') => app.mailStore.append(mailbox, folder, message.raw, flags, ago(message.minutes).getTime());
  for (const [index, message] of inbox.entries()) await store(hello, 'INBOX', message, index < 2 ? 'S' : '');
  await store(hello, 'Sent', text({ name: hello.displayName, address: 'hello@example.test' }, 'Re: นัดประชุมวันศุกร์', 'ยืนยันเวลา 14:00 ครับ เจอกันที่ห้องประชุมชั้น 3', 60 * 30, ['somchai@customer.example']), 'S');
  await store(support, 'INBOX', text({ name: 'Customer', address: 'customer@buyer.example' }, 'สอบถามสถานะคำสั่งซื้อ', 'รบกวนตรวจสอบคำสั่งซื้อเลขที่ 88231 ให้หน่อยครับ', 40, ['support@example.test']));
}
