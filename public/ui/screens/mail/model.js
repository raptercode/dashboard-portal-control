// Pure rules of the Mail workspace: no DOM, so they run in tests as they do in the browser.

export function mailStepAvailable(step, mail) {
  if (step <= 2) return true;
  if (step <= 4) return !!mail.hostname && !!mail.domains?.length;
  if (step === 5)
    return !!mail.hostname && !!mail.domains?.length && !!mail.outboundMode;
  if (step === 6) return mail.configure?.status === "configured";
  return mail.configure?.status === "configured" && !!mail.mailboxes?.length;
}

export const DNS_KINDS = ["mx", "spf", "dkim", "dmarc"];
const DNS_STATUS = {
  verified: ["ถูกต้อง", "success"],
  pending: ["รอตรวจ", "neutral"],
  not_found: ["ยังไม่พบ", "warn"],
  mismatch: ["ค่าไม่ตรง", "warn"],
  error: ["ตรวจไม่ได้", "danger"],
};
export function dnsStatus(record) {
  const [label, tone] = DNS_STATUS[record?.status] || DNS_STATUS.pending;
  return { label, tone, verified: record?.status === "verified" };
}
// DNS never blocks a domain: this is how well other servers will accept its mail.
export function domainHealth(entry) {
  const states = DNS_KINDS.map((kind) => entry.dns?.[kind]?.status || "pending");
  const verified = states.filter((state) => state === "verified").length;
  if (verified === DNS_KINDS.length)
    return { id: "ready", label: "DNS ครบ", tone: "success", verified };
  if (states.every((state) => state === "pending"))
    return { id: "pending", label: "รอตรวจ DNS", tone: "pending", verified };
  return {
    id: "incomplete",
    label: `DNS ${verified}/${DNS_KINDS.length}`,
    tone: "warn",
    verified,
  };
}
// A record that is not verified yet is looked at again by itself; a verified
// one only after `staleMs`, in case it was changed at the DNS provider.
export function dnsCheckDue(entry, now = Date.now(), staleMs = 6 * 60 * 60 * 1000) {
  return DNS_KINDS.some((kind) => {
    const record = entry.dns?.[kind];
    if (record?.status !== "verified") return true;
    const checked = Date.parse(record.checkedAt || "");
    return !Number.isFinite(checked) || now - checked > staleMs;
  });
}

const FOLDERS = {
  INBOX: ["Inbox", "inbox"],
  Sent: ["Sent", "send"],
  Drafts: ["Drafts", "file"],
  Junk: ["Spam", "alert"],
  Trash: ["Trash", "trash"],
};
export const folderLabel = (id) => FOLDERS[id]?.[0] || id;
export const folderIcon = (id) => FOLDERS[id]?.[1] || "folder";
// In folders of mail the owner wrote, the other party is the recipient.
export const folderShowsRecipients = (id) => id === "Sent" || id === "Drafts";

export const MAIL_PAGE_SIZE = 40;
const VIEWS = ["domains", "mailboxes", "server"];
export function mailLocation(input) {
  const url = new URL(input, "http://local");
  const view = url.searchParams.get("view");
  const offset = Number.parseInt(url.searchParams.get("offset") || "0", 10);
  return {
    view: VIEWS.includes(view) ? view : "inbox",
    box: url.searchParams.get("box") || "",
    folder: url.searchParams.get("folder") || "INBOX",
    offset: Number.isInteger(offset) && offset > 0 ? offset : 0,
    message: url.searchParams.get("message") || "",
  };
}
export function mailHref(location = {}) {
  const params = new URLSearchParams();
  if (VIEWS.includes(location.view)) params.set("view", location.view);
  else {
    if (location.box) params.set("box", location.box);
    if (location.folder && location.folder !== "INBOX")
      params.set("folder", location.folder);
    if (location.offset > 0) params.set("offset", String(location.offset));
    if (location.message) params.set("message", location.message);
  }
  const query = params.toString();
  return query ? `/mail?${query}` : "/mail";
}

export const personLabel = (person) =>
  person?.name || person?.address || "(ไม่ทราบผู้ส่ง)";
export function initials(person) {
  const source = (person?.name || person?.address || "?").trim();
  const words = source.split(/[\s._@-]+/).filter(Boolean);
  const letters =
    words.length > 1
      ? [...words[0]][0] + [...words[1]][0]
      : [...source].slice(0, 2).join("");
  return letters.toUpperCase();
}
export function formatMailDate(value, now = new Date(), locale = "th-TH") {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return "";
  if (date.toDateString() === now.toDateString())
    return date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  return date.toLocaleDateString(
    locale,
    date.getFullYear() === now.getFullYear()
      ? { day: "numeric", month: "short" }
      : { day: "numeric", month: "short", year: "numeric" },
  );
}
export const formatMailDateLong = (value, locale = "th-TH") => {
  const date = new Date(value);
  return !value || Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString(locale, {
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
};

const prefixed = (prefix, pattern, subject) => {
  const text = String(subject || "").trim();
  return pattern.test(text) ? text : `${prefix} ${text}`.trim();
};
const quote = (text) =>
  String(text || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n");
const addressLine = (people) =>
  (people || [])
    .map((person) =>
      person.name ? `${person.name} <${person.address}>` : person.address,
    )
    .join(", ");
/**
 * What the compose window starts with for a reply, a reply to everyone or a
 * forward. `self` is the address of the mailbox that is replying.
 */
export function replyDraft(message, self, mode = "reply", folder = "INBOX") {
  const own = String(self || "").toLowerCase();
  const sentByOwner = message.from?.address === own;
  const sender = message.replyTo?.[0] || message.from;
  const when = formatMailDateLong(message.date);
  if (mode === "forward") {
    return {
      to: "",
      cc: "",
      subject: prefixed("Fwd:", /^(fwd?|ส่งต่อ):/i, message.subject),
      text: [
        "",
        "",
        "---------- Forwarded message ----------",
        `From: ${addressLine([message.from])}`,
        `Date: ${when}`,
        `Subject: ${message.subject || ""}`,
        `To: ${addressLine(message.to)}`,
        message.cc?.length ? `Cc: ${addressLine(message.cc)}` : null,
        "",
        message.text || "",
      ]
        .filter((line) => line !== null)
        .join("\n"),
      inReplyTo: null,
      references: [],
      answered: null,
    };
  }
  // Replying to a message the owner sent continues the conversation with its recipients.
  const primary = sentByOwner
    ? (message.to || []).map((person) => person.address)
    : [sender?.address];
  const others =
    mode === "reply-all"
      ? [...(sentByOwner ? [] : message.to || []), ...(message.cc || [])].map(
          (person) => person.address,
        )
      : [];
  const to = [...new Set(primary.filter(Boolean))];
  const cc = [...new Set(others.filter(Boolean))].filter(
    (address) => address !== own && !to.includes(address),
  );
  return {
    to: to.join(", "),
    cc: cc.join(", "),
    subject: prefixed("Re:", /^(re|ตอบกลับ):/i, message.subject),
    text: `\n\nเมื่อ ${when} ${personLabel(message.from)} เขียนว่า:\n${quote(message.text)}`,
    inReplyTo: message.messageId || null,
    references: [...(message.references || []), message.messageId].filter(Boolean),
    answered: { folder, id: message.id },
  };
}

export function hasRemoteContent(html) {
  return /(?:src|background|poster)\s*=\s*["']?\s*https?:|url\(\s*["']?\s*https?:/i.test(
    String(html || ""),
  );
}
/**
 * The document for the sandboxed message frame. The policy comes first, so the
 * sender's markup cannot widen it: nothing loads from the network unless the
 * reader asks for images, and scripts never run (the frame has no allow-scripts).
 */
export function mailHtmlDocument(html, { images = false } = {}) {
  const policy = `default-src 'none'; style-src 'unsafe-inline'; img-src data:${images ? " https:" : ""}; font-src data:`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><base target="_blank"><meta name="color-scheme" content="light"><style>html{background:#fff;color:#1c211e;font:14px/1.6 system-ui,-apple-system,"Segoe UI","Leelawadee UI","Noto Sans Thai",sans-serif;overflow-wrap:anywhere}body{margin:18px 20px}img{max-width:100%;height:auto}table{max-width:100%}a{color:#1a56c4}blockquote{margin:0 0 0 .6em;padding-left:.9em;border-left:2px solid #cfd4d0;color:#4b544e}pre{white-space:pre-wrap}</style></head><body>${String(html || "")}</body></html>`;
}

// Text split into plain pieces and http(s) links, for a message without HTML.
export function linkify(text) {
  const parts = [];
  const pattern = /https?:\/\/[^\s<>"')\]]+/g;
  const source = String(text || "");
  let last = 0;
  for (const match of source.matchAll(pattern)) {
    const href = match[0].replace(/[.,;:!?]+$/, "");
    if (match.index > last) parts.push({ text: source.slice(last, match.index) });
    parts.push({ text: href, href });
    last = match.index + href.length;
  }
  if (last < source.length) parts.push({ text: source.slice(last) });
  return parts;
}

const PASSWORD_ALPHABET =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789-_";
export function generatePassword(length = 20, random = globalThis.crypto) {
  const bytes = random.getRandomValues(new Uint8Array(length * 2));
  let password = "";
  for (const byte of bytes) {
    // Reject the bytes that would favour the first letters of the alphabet.
    if (byte >= 256 - (256 % PASSWORD_ALPHABET.length)) continue;
    password += PASSWORD_ALPHABET[byte % PASSWORD_ALPHABET.length];
    if (password.length === length) break;
  }
  return password.padEnd(length, "x");
}
