// Where the mailbox reader finds messages.
//
// On a real host the Portal cannot read /var/vmail: every access is a typed
// request to the root-owned helper. In the local sandbox the same Maildir code
// runs directly on a private directory, so the interface can be exercised
// without a mail server.
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  MAIL_MESSAGE_MAX_BYTES, MaildirError, appendMailMessage, deleteMailMessage, ensureMailFolder, flagMailMessage,
  listMailFolders, listMailMessages, moveMailMessage, readMailMessage, validateMailFolder, validateMessageId
} from '../scripts/maildir-store.mjs';

export class MailStoreError extends Error {
  constructor(message, code = 'invalid') {
    super(message);
    this.name = 'MailStoreError';
    this.code = code;
  }
}

function translate(error) {
  if (error instanceof MaildirError) return new MailStoreError(error.message, error.code);
  return error;
}

export function createLocalMailStore(root) {
  const maildir = (mailbox) => join(root, mailbox.domain, mailbox.localPart, 'Maildir');
  const guard = async (work) => { try { return await work(); } catch (error) { throw translate(error); } };
  return {
    kind: 'local',
    create: (mailbox) => guard(async () => {
      await mkdir(maildir(mailbox), { recursive: true });
      await ensureMailFolder(maildir(mailbox), 'INBOX');
    }),
    folders: (mailbox) => guard(async () => {
      await mkdir(maildir(mailbox), { recursive: true });
      return listMailFolders(maildir(mailbox));
    }),
    list: (mailbox, folder, page) => guard(() => listMailMessages(maildir(mailbox), folder, page)),
    read: (mailbox, folder, id) => guard(async () => {
      const chunks = [];
      let offset = 0;
      for (;;) {
        const chunk = await readMailMessage(maildir(mailbox), folder, id, offset);
        const bytes = Buffer.from(chunk.data, 'base64');
        chunks.push(bytes);
        offset += bytes.length;
        if (chunk.eof || !bytes.length) return { flags: chunk.flags, content: Buffer.concat(chunks) };
      }
    }),
    flag: (mailbox, folder, id, changes) => guard(() => flagMailMessage(maildir(mailbox), folder, id, changes)),
    move: (mailbox, folder, id, target) => guard(() => moveMailMessage(maildir(mailbox), folder, id, target)),
    remove: (mailbox, folder, id) => guard(() => deleteMailMessage(maildir(mailbox), folder, id)),
    // `now` lets the sandbox seed a mailbox with messages that arrived at different times.
    append: (mailbox, folder, content, flags = '', now = Date.now()) => guard(async () => {
      await mkdir(maildir(mailbox), { recursive: true });
      return appendMailMessage(maildir(mailbox), folder, content, { flags, now });
    })
  };
}

/**
 * `call(request)` sends one request to the helper. A message is read in
 * bounded chunks; a message to store is first written to `spoolDirectory`,
 * which the helper reads by reference, so the request itself stays small.
 */
export function createHelperMailStore({ call, spoolDirectory }) {
  const send = async (operation, mailbox, fields = {}) => {
    const result = await call({ operation, domain: mailbox.domain, localPart: mailbox.localPart, ...fields });
    if (!result?.ok) throw new MailStoreError(result?.error || 'The host could not complete the mailbox request.', result?.code === 'not_found' ? 'not_found' : 'invalid');
    return result;
  };
  const checked = (folder, id) => {
    try { return { folder: validateMailFolder(folder), ...(id === undefined ? {} : { id: validateMessageId(id) }) }; } catch (error) { throw translate(error); }
  };
  return {
    kind: 'helper',
    // The helper creates the Maildir when it creates the mailbox itself.
    create: async () => {},
    folders: async (mailbox) => (await send('mail-folders', mailbox)).folders ?? [],
    list: async (mailbox, folder, { offset = 0, limit } = {}) => {
      const result = await send('mail-list', mailbox, { ...checked(folder), offset, limit });
      return { folder: result.folder, offset: result.offset, total: result.total, unread: result.unread, messages: result.messages ?? [] };
    },
    read: async (mailbox, folder, id) => {
      const reference = checked(folder, id);
      const chunks = [];
      let offset = 0;
      for (;;) {
        const chunk = await send('mail-read', mailbox, { ...reference, offset });
        if (!Number.isInteger(chunk.size) || chunk.size > MAIL_MESSAGE_MAX_BYTES) throw new MailStoreError('Message is too large to open in the Portal. Use a mail client.', 'too_large');
        const bytes = Buffer.from(String(chunk.data ?? ''), 'base64');
        chunks.push(bytes);
        offset += bytes.length;
        if (chunk.eof || !bytes.length || offset >= chunk.size) return { flags: String(chunk.flags ?? ''), content: Buffer.concat(chunks) };
      }
    },
    flag: async (mailbox, folder, id, changes) => {
      const result = await send('mail-flag', mailbox, { ...checked(folder, id), seen: changes.seen, flagged: changes.flagged, answered: changes.answered });
      return { id: result.id, flags: result.flags };
    },
    move: async (mailbox, folder, id, target) => {
      const result = await send('mail-move', mailbox, { ...checked(folder, id), target: checked(target).folder });
      return { id: result.id, folder: result.folder };
    },
    remove: async (mailbox, folder, id) => { await send('mail-delete', mailbox, checked(folder, id)); },
    append: async (mailbox, folder, content, flags = '') => {
      if (!spoolDirectory) throw new MailStoreError('Mail spool directory is not configured.');
      const spool = randomUUID();
      const path = join(spoolDirectory, `${spool}.eml`);
      await mkdir(spoolDirectory, { recursive: true, mode: 0o700 });
      await writeFile(path, content, { mode: 0o600, flag: 'wx' });
      try {
        const result = await send('mail-store', mailbox, { ...checked(folder), spool, flags });
        return { id: result.id, folder: result.folder };
      } finally { await rm(path, { force: true }); }
    }
  };
}
