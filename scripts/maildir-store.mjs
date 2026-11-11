// Maildir++ access for the Portal mailbox reader.
//
// The root-owned helper uses this module on /var/vmail; the local sandbox uses
// it on a temporary directory. It only moves bytes and file names: decoding a
// message (MIME, charsets, HTML) belongs to the unprivileged Portal process.
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';

export const MAIL_STANDARD_FOLDERS = Object.freeze(['INBOX', 'Sent', 'Drafts', 'Junk', 'Trash']);
export const MAIL_LIST_LIMIT = 30;
export const MAIL_LIST_MAX = 50;
// One helper response carries at most this many message bytes (base64 keeps it under the socket cap).
export const MAIL_CHUNK_BYTES = 256 * 1024;
export const MAIL_MESSAGE_MAX_BYTES = 30 * 1024 * 1024;

const HEADER_SCAN_BYTES = 64 * 1024;
const SUMMARY_HEADER_BYTES = 4 * 1024;
const SUMMARY_FIELD_BYTES = 1024;
const SUMMARY_BODY_BYTES = 2 * 1024;
const SUMMARY_FIELDS = new Set(['from', 'to', 'cc', 'reply-to', 'subject', 'date', 'message-id', 'content-type', 'content-transfer-encoding']);
// ':' cannot appear in a Windows file name. Only the local sandbox runs there.
const INFO_SEPARATOR = process.platform === 'win32' ? ';' : ':';
const INFO_PATTERN = /[:;]2,([A-Za-z]*)$/;
const NO_FOLLOW = constants.O_NOFOLLOW ?? 0;

export class MaildirError extends Error {
  constructor(message, code = 'invalid') {
    super(message);
    this.name = 'MaildirError';
    this.code = code;
  }
}

export function validateMailFolder(value) {
  const folder = typeof value === 'string' ? value : '';
  if (folder === 'INBOX') return folder;
  // IMAP names of non-ASCII folders are modified UTF-7, hence '&', '+', ',' and '-'.
  if (!/^[A-Za-z0-9&][A-Za-z0-9 _.&+,-]{0,79}$/.test(folder) || folder.includes('..') || /[. ]$/.test(folder) || folder.toUpperCase() === 'INBOX') {
    throw new MaildirError('Mail folder is invalid.');
  }
  return folder;
}

export function validateMessageId(value) {
  const id = typeof value === 'string' ? value : '';
  if (!/^[A-Za-z0-9][A-Za-z0-9._,=+_-]{0,219}$/.test(id) || id.includes('..')) throw new MaildirError('Message reference is invalid.');
  return id;
}

export async function listMailFolders(root) {
  await assertDirectory(root);
  const names = new Set(MAIL_STANDARD_FOLDERS);
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('.')) continue;
    try { names.add(validateMailFolder(entry.name.slice(1))); } catch { /* A folder this reader cannot address stays hidden. */ }
  }
  const folders = [];
  for (const id of names) {
    const entries = await scan(root, id).catch(() => []);
    folders.push({ id, standard: MAIL_STANDARD_FOLDERS.includes(id), total: entries.length, unread: entries.filter((item) => !item.flags.includes('S')).length });
  }
  return folders;
}

export async function listMailMessages(root, folderName, { offset = 0, limit = MAIL_LIST_LIMIT } = {}) {
  const folder = validateMailFolder(folderName);
  await assertDirectory(root);
  const start = Number.isInteger(offset) && offset >= 0 ? offset : 0;
  const size = Number.isInteger(limit) && limit > 0 ? Math.min(limit, MAIL_LIST_MAX) : MAIL_LIST_LIMIT;
  const entries = await scan(root, folder);
  const messages = [];
  for (const entry of entries.slice(start, start + size)) {
    const summary = await summarize(entry.path).catch(() => null);
    // Another mail client may move or delete a message between the listing and the read.
    if (summary) messages.push({ id: entry.id, flags: entry.flags, time: entry.time || summary.modified, size: summary.size, headers: summary.headers, body: summary.body });
  }
  return { folder, offset: start, total: entries.length, unread: entries.filter((item) => !item.flags.includes('S')).length, messages };
}

export async function readMailMessage(root, folderName, messageId, offset = 0) {
  const entry = await find(root, validateMailFolder(folderName), validateMessageId(messageId));
  const start = Number.isInteger(offset) && offset >= 0 ? offset : 0;
  const handle = await open(entry.path, constants.O_RDONLY | NO_FOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new MaildirError('Message was not found.', 'not_found');
    if (info.size > MAIL_MESSAGE_MAX_BYTES) throw new MaildirError('Message is too large to open in the Portal. Use a mail client.', 'too_large');
    const buffer = Buffer.alloc(Math.max(0, Math.min(MAIL_CHUNK_BYTES, info.size - start)));
    const { bytesRead } = buffer.length ? await handle.read(buffer, 0, buffer.length, start) : { bytesRead: 0 };
    return { id: entry.id, flags: entry.flags, size: info.size, offset: start, data: buffer.subarray(0, bytesRead).toString('base64'), eof: start + bytesRead >= info.size };
  } finally { await handle.close(); }
}

/** Set or clear the seen (S), flagged (F) and answered (R) flags; any other flag letter is kept. */
export async function flagMailMessage(root, folderName, messageId, changes = {}) {
  const folder = validateMailFolder(folderName);
  const entry = await find(root, folder, validateMessageId(messageId));
  const flags = new Set(entry.flags);
  for (const [key, letter] of [['seen', 'S'], ['flagged', 'F'], ['answered', 'R']]) {
    if (changes[key] === true) flags.add(letter);
    else if (changes[key] === false) flags.delete(letter);
  }
  const next = [...flags].sort().join('');
  // A message with flags lives in cur/; this also takes a new delivery out of new/.
  const target = join(folderPath(root, folder), 'cur', `${entry.id}${INFO_SEPARATOR}2,${next}`);
  if (target !== entry.path) await rename(entry.path, target);
  return { id: entry.id, flags: next };
}

export async function moveMailMessage(root, folderName, messageId, targetName, options = {}) {
  const folder = validateMailFolder(folderName);
  const target = validateMailFolder(targetName);
  const entry = await find(root, folder, validateMessageId(messageId));
  if (target === folder) return { id: entry.id, folder };
  await ensureMailFolder(root, target, options);
  await rename(entry.path, join(folderPath(root, target), 'cur', `${entry.id}${INFO_SEPARATOR}2,${entry.flags}`));
  return { id: entry.id, folder: target };
}

export async function deleteMailMessage(root, folderName, messageId) {
  const entry = await find(root, validateMailFolder(folderName), validateMessageId(messageId));
  await unlink(entry.path);
  return { id: entry.id };
}

/**
 * Store one message. With flags it lands in cur/ (a copy the owner already
 * knows, such as Sent); without flags it lands in new/ like a delivery.
 * `own(path)` lets the root helper hand new files to the mail account.
 */
export async function appendMailMessage(root, folderName, content, { flags = '', own, now = Date.now() } = {}) {
  const folder = validateMailFolder(folderName);
  if (!Buffer.isBuffer(content) || !content.length) throw new MaildirError('Message content is empty.');
  if (content.length > MAIL_MESSAGE_MAX_BYTES) throw new MaildirError('Message is too large.', 'too_large');
  if (!/^[A-Za-z]{0,8}$/.test(flags)) throw new MaildirError('Message flags are invalid.');
  await ensureMailFolder(root, folder, { own });
  // Maildir keeps Unix line ends, the same form Dovecot's own delivery writes.
  const stored = Buffer.from(content.toString('latin1').replace(/\r\n/g, '\n'), 'latin1');
  const host = hostname().replace(/[^A-Za-z0-9.-]/g, '_').slice(0, 64) || 'portal';
  const id = `${Math.floor(now / 1000)}.M${String(now % 1000).padStart(3, '0')}P${process.pid}R${randomBytes(6).toString('hex')}.${host},S=${stored.length}`;
  const base = folderPath(root, folder);
  const temporary = join(base, 'tmp', id);
  await writeFile(temporary, stored, { mode: 0o640, flag: 'wx' });
  await own?.(temporary);
  const sorted = [...new Set(flags)].sort().join('');
  await rename(temporary, sorted ? join(base, 'cur', `${id}${INFO_SEPARATOR}2,${sorted}`) : join(base, 'new', id));
  return { id, folder, flags: sorted };
}

export async function ensureMailFolder(root, folderName, { own } = {}) {
  const folder = validateMailFolder(folderName);
  await assertDirectory(root);
  const base = folderPath(root, folder);
  for (const path of [base, join(base, 'cur'), join(base, 'new'), join(base, 'tmp')]) {
    const existing = await lstat(path).catch(() => null);
    if (existing) {
      if (!existing.isDirectory()) throw new MaildirError('Mail folder is not a directory.');
      continue;
    }
    await mkdir(path, { mode: 0o750 });
    await own?.(path);
  }
  if (folder !== 'INBOX') {
    // Maildir++ marks a sub-folder with this empty file.
    const marker = join(base, 'maildirfolder');
    if (!await lstat(marker).catch(() => null)) {
      await writeFile(marker, '', { mode: 0o640, flag: 'wx' });
      await own?.(marker);
    }
  }
  return folder;
}

function folderPath(root, folder) {
  return folder === 'INBOX' ? root : join(root, `.${folder}`);
}

async function assertDirectory(path) {
  const item = await lstat(path).catch(() => null);
  // lstat, not stat: a link planted inside a mailbox must never redirect this reader.
  if (!item?.isDirectory()) throw new MaildirError('Mailbox storage was not found.', 'not_found');
}

async function scan(root, folder) {
  const base = folderPath(root, folder);
  const entries = [];
  for (const part of ['new', 'cur']) {
    const directory = join(base, part);
    if (!(await lstat(directory).catch(() => null))?.isDirectory()) continue;
    for (const name of await readdir(directory)) {
      if (name.startsWith('.')) continue;
      const info = name.match(INFO_PATTERN);
      const id = info ? name.slice(0, info.index) : name;
      if (!/^[A-Za-z0-9][A-Za-z0-9._,=+_-]{0,219}$/.test(id) || id.includes('..')) continue;
      const seconds = Number(id.match(/^(\d{9,11})\./)?.[1] ?? 0);
      entries.push({ id, path: join(directory, name), flags: info?.[1] ?? '', time: seconds * 1000 });
    }
  }
  // Newest first; the name breaks ties so paging stays stable.
  return entries.sort((left, right) => right.time - left.time || (left.id < right.id ? 1 : -1));
}

async function find(root, folder, id) {
  await assertDirectory(root);
  const entry = (await scan(root, folder)).find((item) => item.id === id);
  if (!entry) throw new MaildirError('Message was not found.', 'not_found');
  return entry;
}

// The list needs a few header fields and the first lines of the body, not the
// whole message: mail carries kilobytes of trace headers before From and Subject.
async function summarize(path) {
  const handle = await open(path, constants.O_RDONLY | NO_FOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile()) return null;
    const buffer = Buffer.alloc(Math.min(HEADER_SCAN_BYTES, info.size));
    const { bytesRead } = buffer.length ? await handle.read(buffer, 0, buffer.length, 0) : { bytesRead: 0 };
    const head = buffer.subarray(0, bytesRead);
    let end = head.indexOf('\r\n\r\n');
    let gap = 4;
    const unix = head.indexOf('\n\n');
    if (unix >= 0 && (end < 0 || unix < end)) { end = unix; gap = 2; }
    const headerText = (end < 0 ? head : head.subarray(0, end)).toString('latin1');
    const kept = [];
    const seen = new Set();
    let keeping = false;
    let fieldBytes = 0;
    let total = 0;
    for (const line of headerText.split(/\r?\n/)) {
      if (/^[ \t]/.test(line)) {
        if (!keeping || fieldBytes + line.length > SUMMARY_FIELD_BYTES) { keeping = false; continue; }
      } else {
        const name = line.slice(0, Math.max(0, line.indexOf(':'))).trim().toLowerCase();
        keeping = SUMMARY_FIELDS.has(name) && !seen.has(name);
        if (!keeping) continue;
        seen.add(name);
        fieldBytes = 0;
      }
      const text = line.slice(0, SUMMARY_FIELD_BYTES - fieldBytes);
      if (total + text.length + 1 > SUMMARY_HEADER_BYTES) break;
      kept.push(text);
      fieldBytes += text.length;
      total += text.length + 1;
    }
    return {
      size: info.size,
      modified: Math.floor(info.mtimeMs),
      headers: Buffer.from(kept.join('\n'), 'latin1').toString('base64'),
      body: end < 0 ? '' : head.subarray(end + gap, end + gap + SUMMARY_BODY_BYTES).toString('base64')
    };
  } finally { await handle.close(); }
}
