// Reading and writing Internet mail (RFC 5322 + MIME) for the mailbox reader.
//
// Everything here runs in the unprivileged Portal process on untrusted input:
// it never executes or fetches anything, it only turns bytes into text and a
// list of attachments. Depth, part count and output sizes are all bounded.
import { randomUUID } from 'node:crypto';

const MAX_DEPTH = 8;
const MAX_PARTS = 200;
const MAX_ADDRESSES = 100;
const MAX_TEXT_CHARS = 1024 * 1024;
const MAX_HTML_CHARS = 2 * 1024 * 1024;
const INLINE_IMAGE_BYTES = 300 * 1024;
const INLINE_TOTAL_BYTES = 3 * 1024 * 1024;
const SNIPPET_CHARS = 160;

const CHARSET_ALIASES = Object.freeze({
  utf8: 'utf-8', 'us-ascii': 'utf-8', ascii: 'utf-8', 'ansi_x3.4-1968': 'utf-8',
  'tis-620': 'windows-874', tis620: 'windows-874', cp874: 'windows-874', 'iso-8859-11': 'windows-874',
  cp1252: 'windows-1252', latin1: 'windows-1252', cp1250: 'windows-1250', cp1251: 'windows-1251',
  cp932: 'shift_jis', 'ks_c_5601-1987': 'euc-kr', gb2312: 'gbk'
});

export function decodeBytes(buffer, charset) {
  const requested = String(charset ?? '').trim().toLowerCase().replace(/^["']|["']$/g, '');
  const label = CHARSET_ALIASES[requested] ?? (requested || 'utf-8');
  if (label === 'utf-8') {
    const strict = new TextDecoder('utf-8', { fatal: true });
    // A list preview is cut at a byte count, so its last character may be incomplete: drop only that.
    for (let trim = 0; trim <= 3 && trim <= buffer.length; trim += 1) {
      try { return strict.decode(buffer.subarray(0, buffer.length - trim)); } catch { /* try a shorter tail */ }
    }
    // Mail that claims ASCII or UTF-8 but carries other bytes is usually Windows-1252.
    return new TextDecoder('windows-1252').decode(buffer);
  }
  try { return new TextDecoder(label).decode(buffer); } catch { return new TextDecoder('utf-8').decode(buffer); }
}

/** Split one entity into its header block and body at the first empty line. */
export function splitEntity(buffer) {
  if (buffer[0] === 0x0a) return { head: Buffer.alloc(0), body: buffer.subarray(1) };
  if (buffer[0] === 0x0d && buffer[1] === 0x0a) return { head: Buffer.alloc(0), body: buffer.subarray(2) };
  const dos = buffer.indexOf('\r\n\r\n');
  const unix = buffer.indexOf('\n\n');
  if (dos < 0 && unix < 0) return { head: buffer, body: Buffer.alloc(0) };
  if (unix >= 0 && (dos < 0 || unix < dos)) return { head: buffer.subarray(0, unix), body: buffer.subarray(unix + 2) };
  return { head: buffer.subarray(0, dos), body: buffer.subarray(dos + 4) };
}

/** Header fields as [lower-case name, raw value] pairs; raw values keep their bytes as Latin-1. */
export function parseHeaders(head) {
  const fields = [];
  for (const line of head.toString('latin1').split(/\r?\n/)) {
    if (/^[ \t]/.test(line)) {
      if (fields.length) fields[fields.length - 1][1] += ` ${line.trim()}`;
      continue;
    }
    const colon = line.indexOf(':');
    if (colon > 0) fields.push([line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim()]);
  }
  return {
    fields,
    get: (name) => fields.find((field) => field[0] === name)?.[1] ?? null
  };
}

/** Decode a header value: RFC 2047 encoded words, and raw 8-bit text some senders still emit. */
export function decodeHeader(raw) {
  let value = String(raw ?? '');
  if (/[\x80-\xff]/.test(value)) value = decodeBytes(Buffer.from(value, 'latin1'), 'utf-8');
  const word = /=\?([^?\s]+)\?([bBqQ])\?([^?\s]*)\?=/g;
  const pieces = [];
  let last = 0;
  for (const match of value.matchAll(word)) {
    const between = value.slice(last, match.index);
    const previous = pieces[pieces.length - 1];
    // White space between two encoded words is not part of the text.
    if (between && !(previous?.encoded && /^\s+$/.test(between))) pieces.push({ text: between });
    const charset = match[1].split('*')[0].toLowerCase();
    const bytes = match[2].toLowerCase() === 'b'
      ? Buffer.from(match[3], 'base64')
      : Buffer.from(match[3].replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16))), 'latin1');
    const joined = pieces[pieces.length - 1];
    // A character may be split across two words of the same charset: join the bytes first.
    if (joined?.encoded && joined.charset === charset) joined.bytes = Buffer.concat([joined.bytes, bytes]);
    else pieces.push({ encoded: true, charset, bytes });
    last = match.index + match[0].length;
  }
  if (last < value.length) pieces.push({ text: value.slice(last) });
  return pieces.map((piece) => piece.encoded ? decodeBytes(piece.bytes, piece.charset) : piece.text).join('').replace(/[\0\r\n]+/g, ' ').trim();
}

export function parseAddresses(raw) {
  const tokens = [];
  let current = '';
  let quoted = false;
  let angle = false;
  let comment = 0;
  const source = String(raw ?? '');
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '\\' && index + 1 < source.length) { current += character + source[index + 1]; index += 1; continue; }
    if (character === '"' && !comment) quoted = !quoted;
    else if (!quoted && character === '(') comment += 1;
    else if (!quoted && character === ')' && comment) comment -= 1;
    else if (!quoted && !comment && character === '<') angle = true;
    else if (!quoted && !comment && character === '>') angle = false;
    if (!quoted && !comment && !angle && (character === ',' || character === ';')) { tokens.push(current); current = ''; continue; }
    current += character;
  }
  tokens.push(current);
  const addresses = [];
  for (const token of tokens) {
    if (addresses.length >= MAX_ADDRESSES) break;
    const text = token.trim();
    if (!text) continue;
    const bracket = text.match(/^([\s\S]*)<([^<>]*)>\s*(?:\([^)]*\))?\s*$/);
    let name = bracket ? bracket[1] : '';
    // A group label ("undisclosed-recipients:") precedes its members and is not an address.
    let address = (bracket ? bracket[2] : text.replace(/\([^)]*\)/g, '')).trim().replace(/^[^:]*:\s*/, '');
    if (!bracket) {
      const comment = text.match(/\(([^)]*)\)/);
      if (comment) name = comment[1];
    }
    name = decodeHeader(name.trim().replace(/^"([\s\S]*)"$/, '$1').replace(/\\(.)/g, '$1'));
    address = address.replace(/[\s<>"]/g, '').slice(0, 254);
    if (!address.includes('@')) {
      if (!bracket) continue;
      address = '';
    }
    addresses.push({ name: name.slice(0, 200), address: address.toLowerCase() });
  }
  return addresses;
}

/** A value with parameters such as Content-Type, including RFC 2231 encoded and continued parameters. */
export function parseParameterized(raw) {
  const segments = [];
  let current = '';
  let quoted = false;
  const source = String(raw ?? '');
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '\\' && quoted && index + 1 < source.length) { current += source[index + 1]; index += 1; continue; }
    if (character === '"') { quoted = !quoted; continue; }
    if (character === ';' && !quoted) { segments.push(current); current = ''; continue; }
    current += character;
  }
  segments.push(current);
  const value = (segments.shift() ?? '').trim();
  const plain = {};
  const extended = {};
  for (const segment of segments) {
    const equals = segment.indexOf('=');
    if (equals < 1) continue;
    const key = segment.slice(0, equals).trim().toLowerCase();
    const text = segment.slice(equals + 1).trim();
    const star = key.match(/^([^*]+)(?:\*(\d+))?(\*)?$/);
    if (!star || (star[2] === undefined && !star[3])) { if (!(key in plain)) plain[key] = text; continue; }
    (extended[star[1]] ??= []).push({ index: Number(star[2] ?? 0), encoded: Boolean(star[3]), text });
  }
  const params = {};
  for (const [key, text] of Object.entries(plain)) params[key] = decodeHeader(text);
  for (const [key, parts] of Object.entries(extended)) {
    parts.sort((left, right) => left.index - right.index);
    let charset = 'utf-8';
    const chunks = parts.map((part, position) => {
      if (!part.encoded) return Buffer.from(part.text, 'latin1');
      let text = part.text;
      if (position === 0) {
        const prefix = text.match(/^([^']*)'[^']*'([\s\S]*)$/);
        if (prefix) { charset = prefix[1] || 'utf-8'; text = prefix[2]; }
      }
      return Buffer.from(text.replace(/%([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16))), 'latin1');
    });
    params[key] = decodeBytes(Buffer.concat(chunks), charset).replace(/[\0\r\n]+/g, ' ');
  }
  return { value, params };
}

function decodeTransfer(raw, encoding) {
  if (encoding === 'base64') return Buffer.from(raw.toString('latin1').replace(/[^A-Za-z0-9+/=]/g, ''), 'base64');
  if (encoding === 'quoted-printable') {
    return Buffer.from(raw.toString('latin1').replace(/=\r?\n/g, '').replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16))), 'latin1');
  }
  return raw;
}

function splitMultipart(body, boundary, budget) {
  const marker = Buffer.from(`--${boundary}`, 'latin1');
  const parts = [];
  let position = 0;
  let start = -1;
  while (position <= body.length) {
    const index = body.indexOf(marker, position);
    if (index < 0) break;
    if (index !== 0 && body[index - 1] !== 0x0a) { position = index + marker.length; continue; }
    if (start >= 0) {
      let end = index;
      if (end > start && body[end - 1] === 0x0a) end -= 1;
      if (end > start && body[end - 1] === 0x0d) end -= 1;
      parts.push(body.subarray(start, end));
      start = -1;
    }
    const after = index + marker.length;
    if (body[after] === 0x2d && body[after + 1] === 0x2d) return parts;
    const lineEnd = body.indexOf(0x0a, after);
    if (lineEnd < 0 || (budget.parts -= 1) < 0) return parts;
    start = lineEnd + 1;
    position = start;
  }
  // A message cut short (or a list preview) still yields its last, unterminated part.
  if (start >= 0) parts.push(body.subarray(start));
  return parts;
}

/** Parse a message into a tree of entities. Leaves keep their undecoded body. */
export function parseMessage(buffer) {
  const budget = { parts: MAX_PARTS };
  const parse = (bytes, depth) => {
    const { head, body } = splitEntity(bytes);
    const headers = parseHeaders(head);
    const type = parseParameterized(headers.get('content-type') ?? 'text/plain');
    const mediaType = (type.value || 'text/plain').toLowerCase();
    if (mediaType.startsWith('multipart/') && type.params.boundary && depth < MAX_DEPTH) {
      return { headers, mediaType, params: type.params, parts: splitMultipart(body, type.params.boundary, budget).map((part) => parse(part, depth + 1)) };
    }
    return { headers, mediaType, params: type.params, encoding: String(headers.get('content-transfer-encoding') ?? '7bit').trim().toLowerCase(), body };
  };
  return parse(buffer, 0);
}

function safeFilename(value, fallback) {
  const name = String(value ?? '').replace(/[\0-\x1f\x7f]/g, '').replace(/[\\/:*?"<>|]/g, '_').replace(/^\.+/, '').trim().slice(0, 150);
  return name || fallback;
}

/**
 * The readable content of a parsed message: plain text, HTML (untrusted: show
 * it only inside a sandboxed frame) and attachments with their decoded bytes.
 */
export function extractContent(root) {
  const collect = (entity, out) => {
    if (entity.parts) {
      if (entity.mediaType === 'multipart/alternative') {
        // Alternatives are the same content in several forms: keep one text and one HTML.
        let text = null;
        let html = null;
        for (const part of entity.parts) {
          const option = { texts: [], htmls: [], files: out.files };
          collect(part, option);
          if (option.htmls.length) html = option.htmls;
          else if (option.texts.length && !text) text = option.texts;
        }
        out.texts.push(...(text ?? []));
        out.htmls.push(...(html ?? []));
      } else for (const part of entity.parts) collect(part, out);
      return;
    }
    const disposition = parseParameterized(entity.headers.get('content-disposition') ?? '');
    const filename = disposition.params.filename ?? entity.params.name ?? '';
    const attached = disposition.value.toLowerCase() === 'attachment' || (filename && !disposition.value);
    const inlineText = !attached && ['text/plain', 'text/html'].includes(entity.mediaType);
    if (inlineText) {
      const text = decodeBytes(decodeTransfer(entity.body, entity.encoding), entity.params.charset);
      (entity.mediaType === 'text/html' ? out.htmls : out.texts).push(text);
      return;
    }
    const nested = entity.mediaType === 'message/rfc822';
    const content = nested ? entity.body : decodeTransfer(entity.body, entity.encoding);
    out.files.push({
      filename: safeFilename(filename, nested ? 'message.eml' : `attachment-${out.files.length + 1}`),
      contentType: /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(entity.mediaType) ? entity.mediaType : 'application/octet-stream',
      contentId: String(entity.headers.get('content-id') ?? '').trim().replace(/^<|>$/g, ''),
      size: content.length,
      content
    });
  };
  const out = { texts: [], htmls: [], files: [] };
  collect(root, out);
  let html = out.htmls.join('<hr>');
  const referenced = new Set();
  let inlineBytes = 0;
  if (html) {
    // Images sent inside the message (cid:) are inlined, so nothing is fetched to show them.
    html = html.replace(/\bcid:([^"'\s>)]+)/gi, (match, id) => {
      const file = out.files.find((item) => item.contentId && item.contentId === decodeURIComponentSafe(id));
      if (!file || !/^image\/(?:png|jpeg|gif|webp|bmp)$/.test(file.contentType) || file.size > INLINE_IMAGE_BYTES || inlineBytes + file.size > INLINE_TOTAL_BYTES) return match;
      if (!referenced.has(file)) inlineBytes += file.size;
      referenced.add(file);
      return `data:${file.contentType};base64,${file.content.toString('base64')}`;
    });
  }
  const text = out.texts.length ? out.texts.join('\n\n') : (html ? htmlToText(html) : '');
  return {
    text: text.slice(0, MAX_TEXT_CHARS),
    html: html.length > MAX_HTML_CHARS ? '' : html,
    attachments: out.files.filter((file) => !referenced.has(file))
  };
}

function decodeURIComponentSafe(value) {
  try { return decodeURIComponent(value); } catch { return value; }
}

const ENTITIES = Object.freeze({ nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", zwnj: '', shy: '' });

export function htmlToText(html) {
  return String(html ?? '')
    .replace(/<(style|script|head|title)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|tr|li|h[1-6]|blockquote|table)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (match, name) => {
      const key = name.toLowerCase();
      if (key in ENTITIES) return ENTITIES[key];
      if (key.startsWith('#')) {
        const code = key[1] === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1));
        return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '';
      }
      return match;
    })
    .replace(/[ \t\u00a0\u200b-\u200d\u034f\ufeff]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function messageDate(raw) {
  const time = Date.parse(String(raw ?? '').replace(/\([^)]*\)/g, '').trim());
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function envelope(headers) {
  return {
    from: parseAddresses(headers.get('from'))[0] ?? { name: '', address: '' },
    to: parseAddresses(headers.get('to')),
    cc: parseAddresses(headers.get('cc')),
    replyTo: parseAddresses(headers.get('reply-to')),
    subject: decodeHeader(headers.get('subject')).slice(0, 500),
    date: messageDate(headers.get('date')),
    messageId: String(headers.get('message-id') ?? '').trim().slice(0, 300)
  };
}

/**
 * One row of the message list, from the header fields and the first bytes of
 * the body that the store returns. The preview line is a best effort.
 */
export function summarizeMessage(headerBytes, bodyBytes = Buffer.alloc(0)) {
  const root = parseMessage(Buffer.concat([headerBytes, Buffer.from('\n\n'), bodyBytes]));
  let snippet = '';
  let attachments = root.mediaType === 'multipart/mixed';
  try {
    const content = extractContent(root);
    attachments ||= content.attachments.length > 0;
    snippet = content.text.replace(/\ufffd+$/, '').replace(/\s+/g, ' ').trim().slice(0, SNIPPET_CHARS);
  } catch { /* A preview must never make the list fail. */ }
  return { ...envelope(root.headers), snippet, hasAttachments: attachments };
}

/** A whole message for the reading pane. */
export function readMessage(buffer) {
  const root = parseMessage(buffer);
  const content = extractContent(root);
  const references = String(root.headers.get('references') ?? '').match(/<[^<>\s]{1,250}>/g) ?? [];
  return { ...envelope(root.headers), references: references.slice(-20), ...content };
}

function isAscii(text) { return /^[\x20-\x7e]*$/.test(text); }

function encodedWords(text) {
  // Each word carries at most 39 bytes on a character boundary, so a line stays under 76 columns.
  const words = [];
  let chunk = [];
  let size = 0;
  for (const character of text) {
    const bytes = Buffer.from(character, 'utf8');
    if (size + bytes.length > 39) { words.push(Buffer.concat(chunk)); chunk = []; size = 0; }
    chunk.push(bytes);
    size += bytes.length;
  }
  if (chunk.length) words.push(Buffer.concat(chunk));
  return words.map((bytes) => `=?UTF-8?B?${bytes.toString('base64')}?=`);
}

// A header line is folded between tokens, so that no line passes 78 columns.
function foldHeader(name, tokens) {
  const lines = [];
  let line = `${name}:`;
  for (const token of tokens) {
    if (line.length + 1 + token.length > 78 && line !== `${name}:`) { lines.push(line); line = ` ${token}`; }
    else line += ` ${token}`;
  }
  lines.push(line);
  return lines.join('\r\n');
}

function unstructuredHeader(name, text) {
  const clean = String(text ?? '').replace(/[\0\r\n]+/g, ' ').trim();
  return foldHeader(name, isAscii(clean) ? clean.split(' ').filter(Boolean) : encodedWords(clean));
}

// The tokens of one mailbox: an optional display name, then the address.
function mailboxTokens({ name, address }) {
  const label = String(name ?? '').replace(/[\0\r\n]+/g, ' ').trim();
  if (!label) return [address];
  if (!isAscii(label)) return [...encodedWords(label), `<${address}>`];
  return [/^[A-Za-z0-9 !#$%&'*+/=?^_`{|}~-]+$/.test(label) ? label : `"${label.replace(/(["\\])/g, '\\$1')}"`, `<${address}>`];
}

const addressList = (addresses) => addresses.map((address, index) => (index < addresses.length - 1 ? `${address},` : address));

/**
 * Compose a plain-text message. Addresses must already be validated; Bcc
 * recipients are never written into the message, only given to SMTP.
 */
export function composeMessage({ from, to = [], cc = [], subject = '', text = '', inReplyTo = null, references = [], date = new Date(), messageId = null }) {
  const domain = from.address.split('@')[1];
  const id = messageId ?? `<${randomUUID()}@${domain}>`;
  const headers = [
    foldHeader('From', mailboxTokens(from)),
    to.length ? foldHeader('To', addressList(to)) : null,
    cc.length ? foldHeader('Cc', addressList(cc)) : null,
    unstructuredHeader('Subject', subject),
    `Date: ${date.toUTCString().replace(/GMT$/, '+0000')}`,
    `Message-ID: ${id}`,
    inReplyTo ? `In-Reply-To: ${inReplyTo}` : null,
    references.length ? foldHeader('References', references) : null,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8'
  ].filter(Boolean);
  const body = String(text ?? '').replace(/\r\n?/g, '\n');
  const plain = isAscii(body.replace(/\n/g, '')) && body.split('\n').every((line) => line.length <= 900);
  headers.push(`Content-Transfer-Encoding: ${plain ? '7bit' : 'base64'}`);
  const encoded = plain
    ? body.replace(/\n/g, '\r\n')
    : (Buffer.from(body, 'utf8').toString('base64').match(/.{1,76}/g) ?? []).join('\r\n');
  return { messageId: id, raw: Buffer.from(`${headers.join('\r\n')}\r\n\r\n${encoded}\r\n`, 'latin1') };
}
