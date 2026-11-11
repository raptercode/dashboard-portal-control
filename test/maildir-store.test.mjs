import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MAIL_CHUNK_BYTES, MAIL_LIST_MAX, MaildirError, appendMailMessage, deleteMailMessage, flagMailMessage, listMailFolders,
  listMailMessages, moveMailMessage, readMailMessage, validateMailFolder, validateMessageId
} from '../scripts/maildir-store.mjs';
import { MailStoreError, createHelperMailStore, createLocalMailStore } from '../src/mail-store.mjs';

const helperSource = await readFile(new URL('../scripts/hostmgr-deploy-helper.mjs', import.meta.url), 'utf8');
const storeSource = await readFile(new URL('../scripts/maildir-store.mjs', import.meta.url), 'utf8');

async function maildir() {
  const root = join(await mkdtemp(join(tmpdir(), 'hostmgr-maildir-')), 'Maildir');
  await mkdir(root, { recursive: true });
  return root;
}
const mail = (subject, body = 'body') => Buffer.from(`Received: from mx.example by host\r\nFrom: Sender <sender@example.net>\r\nSubject: ${subject}\r\nX-Other: ignored\r\n\r\n${body}\r\n`);

test('folder and message references cannot leave the mailbox', () => {
  for (const folder of ['INBOX', 'Sent', 'Archive.2026', 'Sent Messages', '&DgIOLQ4HDg0-']) assert.equal(validateMailFolder(folder), folder);
  for (const folder of ['', '.', '..', '../x', 'a/b', 'a\\b', '.hidden', 'inbox', 'x..y', 'trail.', 'a\0b', 'x'.repeat(81), null]) assert.throws(() => validateMailFolder(folder), MaildirError, String(folder));
  assert.equal(validateMessageId('1700000000.M1P2.host,S=10,W=12'), '1700000000.M1P2.host,S=10,W=12');
  // Dovecot puts the host name in the file name, and host names may carry an underscore.
  assert.equal(validateMessageId('1700000000.M1P2.my_host-1,S=10'), '1700000000.M1P2.my_host-1,S=10');
  for (const id of ['', '../x', 'a/b', 'a:2,S', '.x', 'x..y', 'x'.repeat(221), 7]) assert.throws(() => validateMessageId(id), MaildirError, String(id));
});

test('a delivery is unread in new/, a stored copy is read in cur/, and the list is newest first', async () => {
  const root = await maildir();
  const first = await appendMailMessage(root, 'INBOX', mail('first'), { now: 1_700_000_000_000 });
  const second = await appendMailMessage(root, 'INBOX', mail('second'), { now: 1_700_000_100_000 });
  const copy = await appendMailMessage(root, 'Sent', mail('copy'), { flags: 'S', now: 1_700_000_200_000 });
  assert.deepEqual(await readdir(join(root, 'new')), [first.id, second.id].sort());
  assert.equal((await readdir(join(root, '.Sent', 'cur'))).length, 1);
  assert.ok(await stat(join(root, '.Sent', 'maildirfolder')));
  // Stored with Unix line ends, and the S= size in the name is the real size.
  const stored = await readFile(join(root, 'new', first.id));
  assert.equal(stored.includes('\r'), false);
  assert.equal(first.id.endsWith(`,S=${stored.length}`), true);

  const page = await listMailMessages(root, 'INBOX');
  assert.deepEqual(page.messages.map((item) => item.id), [second.id, first.id]);
  assert.equal(page.total, 2);
  assert.equal(page.unread, 2);
  assert.equal(page.messages[0].time, 1_700_000_100_000);
  const headers = Buffer.from(page.messages[0].headers, 'base64').toString();
  assert.match(headers, /^From: Sender <sender@example\.net>\nSubject: second$/);
  assert.doesNotMatch(headers, /Received|X-Other/);
  assert.equal(Buffer.from(page.messages[0].body, 'base64').toString(), 'body\n');

  assert.deepEqual((await listMailMessages(root, 'INBOX', { offset: 1, limit: 1 })).messages.map((item) => item.id), [first.id]);
  assert.equal((await listMailMessages(root, 'INBOX', { limit: 5000 })).messages.length, 2);
  assert.ok(MAIL_LIST_MAX <= 50);
  assert.deepEqual((await listMailFolders(root)).filter((folder) => folder.total).map(({ id, total, unread }) => [id, total, unread]), [['INBOX', 2, 2], ['Sent', 1, 0]]);
  assert.equal(copy.flags, 'S');
});

test('flags, moves and deletes rename files the way other Maildir clients expect', async () => {
  const root = await maildir();
  const { id } = await appendMailMessage(root, 'INBOX', mail('flag me'), { now: 1_700_000_000_000 });
  assert.deepEqual(await flagMailMessage(root, 'INBOX', id, { seen: true, flagged: true }), { id, flags: 'FS' });
  assert.deepEqual(await readdir(join(root, 'new')), []);
  assert.match((await readdir(join(root, 'cur')))[0], /[:;]2,FS$/);
  // An unknown flag letter set by another client survives a change.
  await flagMailMessage(root, 'INBOX', id, { answered: true });
  assert.deepEqual(await flagMailMessage(root, 'INBOX', id, { seen: false }), { id, flags: 'FR' });
  assert.equal((await listMailMessages(root, 'INBOX')).unread, 1);

  assert.deepEqual(await moveMailMessage(root, 'INBOX', id, 'Trash'), { id, folder: 'Trash' });
  assert.equal((await listMailMessages(root, 'INBOX')).total, 0);
  assert.equal((await listMailMessages(root, 'Trash')).messages[0].flags, 'FR');
  await assert.rejects(readMailMessage(root, 'INBOX', id), (error) => error instanceof MaildirError && error.code === 'not_found');
  await deleteMailMessage(root, 'Trash', id);
  await assert.rejects(deleteMailMessage(root, 'Trash', id), (error) => error.code === 'not_found');
  await assert.rejects(listMailMessages(join(root, 'missing'), 'INBOX'), (error) => error.code === 'not_found');
});

test('a large message is read in bounded chunks and reassembled by either store', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hostmgr-mailstore-'));
  const mailbox = { domain: 'example.test', localPart: 'hello' };
  const local = createLocalMailStore(root);
  await local.create(mailbox);
  const big = Buffer.concat([Buffer.from('Subject: big\n\n'), Buffer.alloc(MAIL_CHUNK_BYTES * 2 + 123, 0x61)]);
  const { id } = await local.append(mailbox, 'INBOX', big);
  assert.equal((await local.read(mailbox, 'INBOX', id)).content.equals(big), true);

  // The helper store speaks to the same Maildir code through typed requests, as the root helper does.
  const requests = [];
  const maildirRoot = join(root, 'example.test', 'hello', 'Maildir');
  const spoolDirectory = join(root, 'spool');
  const call = async (request) => {
    requests.push(request);
    try {
      if (request.operation === 'mail-read') return { ok: true, ...await readMailMessage(maildirRoot, request.folder, request.id, request.offset) };
      if (request.operation === 'mail-list') return { ok: true, ...await listMailMessages(maildirRoot, request.folder, { offset: request.offset, limit: request.limit }) };
      if (request.operation === 'mail-store') return { ok: true, ...await appendMailMessage(maildirRoot, request.folder, await readFile(join(spoolDirectory, `${request.spool}.eml`)), { flags: request.flags }) };
      if (request.operation === 'mail-delete') return { ok: false, error: 'Message was not found.', code: 'not_found' };
    } catch (error) { return { ok: false, error: error.message, code: error.code }; }
    return { ok: false, error: 'Unsupported helper operation.' };
  };
  const helper = createHelperMailStore({ call, spoolDirectory });
  const read = await helper.read(mailbox, 'INBOX', id);
  assert.equal(read.content.equals(big), true);
  assert.deepEqual(requests.filter((item) => item.operation === 'mail-read').map((item) => item.offset), [0, MAIL_CHUNK_BYTES, MAIL_CHUNK_BYTES * 2]);
  for (const request of requests) assert.ok(JSON.stringify(request).length < 16 * 1024, 'a helper request must stay under the socket limit');

  // Storing goes through a spool file named by a random reference; the request carries no content.
  const stored = await helper.append(mailbox, 'Sent', big, 'S');
  const storeRequest = requests.find((item) => item.operation === 'mail-store');
  assert.match(storeRequest.spool, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
  assert.equal('content' in storeRequest, false);
  assert.deepEqual(await readdir(spoolDirectory), [], 'the spool file is removed after the helper answered');
  assert.equal((await local.read(mailbox, 'Sent', stored.id)).content.equals(big), true);

  await assert.rejects(helper.remove(mailbox, 'Trash', id), (error) => error instanceof MailStoreError && error.code === 'not_found');
  // A bad reference is refused before anything is sent to the root helper.
  const before = requests.length;
  await assert.rejects(helper.read(mailbox, '../../etc', id), MailStoreError);
  await assert.rejects(helper.read(mailbox, 'INBOX', '../../shadow'), MailStoreError);
  assert.equal(requests.length, before);
});

test('a link planted in a mailbox is not followed', { skip: process.platform === 'win32' && 'Creating symlinks needs elevation on Windows; covered on Linux' }, async () => {
  const root = await maildir();
  const outside = join(await mkdtemp(join(tmpdir(), 'hostmgr-outside-')), 'secret');
  await writeFile(outside, 'Subject: secret\n\nroot only\n');
  await mkdir(join(root, 'cur'), { recursive: true });
  await symlink(outside, join(root, 'cur', '1700000000.M1P1.host:2,S'));
  await assert.rejects(readMailMessage(root, 'INBOX', '1700000000.M1P1.host'));
  assert.deepEqual((await listMailMessages(root, 'INBOX')).messages, []);
  await symlink(join(root, 'cur'), join(root, '.Linked'));
  await assert.rejects(appendMailMessage(root, 'Linked', mail('x')), MaildirError);
});

test('the helper only opens mailboxes the Portal created, through Maildir operations', () => {
  const operation = helperSource.slice(helperSource.indexOf('async function mailboxOperation('), helperSource.indexOf('async function storeSpooledMessage('));
  assert.match(operation, /validateMailDomain\(request\.domain\)/);
  assert.match(operation, /validateMailLocalPart\(request\.localPart\)/);
  assert.match(operation, /readTextOrEmpty\(MAIL_USERS\)/);
  assert.match(operation, /lstat\(path\)/);
  // Every mailbox request is routed through that gate.
  const routes = [...helperSource.matchAll(/request\.operation === 'mail-(folders|list|read|flag|move|delete|store)'\) return (\w+)\(/g)];
  assert.equal(routes.length, 7);
  for (const route of routes) assert.equal(route[2], 'mailboxOperation', `mail-${route[1]}`);
  const spool = helperSource.slice(helperSource.indexOf('async function storeSpooledMessage('), helperSource.indexOf('async function assertMailInstallation('));
  assert.match(spool, /O_RDONLY \| fsConstants\.O_NOFOLLOW/);
  assert.match(spool, /info\.uid !== portalUid \|\| info\.nlink !== 1/);
  assert.match(spool, /info\.size > MAIL_MESSAGE_MAX_BYTES/);
  // The Maildir module never follows a link when it opens a message.
  assert.equal([...storeSource.matchAll(/await open\(([^)]*)\)/g)].every((match) => match[1].includes('NO_FOLLOW')), true);
  assert.doesNotMatch(storeSource, /(?<![.\w])stat\(/, 'use lstat so a link is seen as a link');
});

test('adding or removing a domain does not depend on DNS evidence or a second activation', () => {
  const validate = helperSource.slice(helperSource.indexOf('function validateMailState('), helperSource.indexOf('function assertMailActivationReady('));
  assert.doesNotMatch(validate, /dns\?\./);
  assert.doesNotMatch(validate, /hostnameCheck|ptr/);
  const activation = helperSource.slice(helperSource.indexOf('function assertMailActivationReady('), helperSource.indexOf('function validatedMailPlan('));
  assert.match(activation, /hostnameCheck\?\.status !== 'ok'/);
  assert.match(activation, /ptr\?\.status !== 'verified'/);
  const configure = helperSource.slice(helperSource.indexOf('async function configureMail('), helperSource.indexOf('async function createMailbox('));
  assert.match(configure, /assertMailActivationReady\(mail\);/);
  const sync = helperSource.slice(helperSource.indexOf('async function syncMailDomains('), helperSource.indexOf('let vmailIdentity'));
  assert.match(sync, /writeMailMaps\(mail\)/);
  assert.match(sync, /writeDkimMaterial\(mail\)/);
  assert.match(sync, /\['reload', 'opendkim', 'postfix'\]/);
  assert.doesNotMatch(sync, /certbot|restart|assertMailActivationReady|validatedMailPlan/);
  // A new mailbox no longer re-reads the port plan either.
  const mailbox = helperSource.slice(helperSource.indexOf('async function createMailbox('), helperSource.indexOf('async function deleteMailbox('));
  assert.doesNotMatch(mailbox, /validatedMailPlan/);
});
