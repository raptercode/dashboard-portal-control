import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mailStepAvailable } from "../public/ui/screens/mail.js";
import {
  dnsCheckDue,
  dnsStatus,
  domainHealth,
  folderLabel,
  folderShowsRecipients,
  formatMailDate,
  generatePassword,
  hasRemoteContent,
  initials,
  linkify,
  mailHref,
  mailHtmlDocument,
  mailLocation,
  replyDraft,
} from "../public/ui/screens/mail/model.js";

test("mail setup allows identity before DNS but gates activation and mailbox operations on saved state", () => {
  const m = {
    hostname: null,
    domains: [],
    outboundMode: null,
    configure: null,
    mailboxes: [],
  };
  assert.equal(mailStepAvailable(1, m), true);
  assert.equal(mailStepAvailable(2, m), true);
  assert.equal(mailStepAvailable(3, m), false);
  m.hostname = "mail.example.com";
  m.domains.push({ domain: "example.com" });
  assert.equal(mailStepAvailable(3, m), true);
  assert.equal(mailStepAvailable(4, m), true);
  assert.equal(mailStepAvailable(5, m), false);
  m.outboundMode = "relay-587";
  assert.equal(mailStepAvailable(5, m), true);
  assert.equal(mailStepAvailable(6, m), false);
  m.configure = { status: "configured" };
  assert.equal(mailStepAvailable(6, m), true);
  assert.equal(mailStepAvailable(7, m), false);
  m.mailboxes.push({ id: "mailbox" });
  assert.equal(mailStepAvailable(7, m), true);
});

test("domain DNS is reported as health and re-checked by itself, never as a gate", () => {
  const record = (status, minutesAgo = 1) => ({
    status,
    checkedAt: new Date(Date.now() - minutesAgo * 60000).toISOString(),
  });
  const ready = { dns: { mx: record("verified"), spf: record("verified"), dkim: record("verified"), dmarc: record("verified") } };
  const fresh = { dns: { mx: { status: "pending" }, spf: { status: "pending" }, dkim: { status: "pending" }, dmarc: { status: "pending" } } };
  const partial = { dns: { mx: record("verified"), spf: record("not_found"), dkim: record("mismatch"), dmarc: record("error") } };
  assert.deepEqual(domainHealth(ready), { id: "ready", label: "DNS ครบ", tone: "success", verified: 4 });
  assert.equal(domainHealth(fresh).id, "pending");
  assert.deepEqual([domainHealth(partial).id, domainHealth(partial).label], ["incomplete", "DNS 1/4"]);
  assert.equal(domainHealth({}).id, "pending");
  assert.deepEqual(["verified", "not_found", "mismatch", "error", undefined].map((status) => dnsStatus({ status }).tone), ["success", "warn", "warn", "danger", "neutral"]);
  // Unverified records are due at once; verified ones only when they are old.
  assert.equal(dnsCheckDue(fresh), true);
  assert.equal(dnsCheckDue(partial), true);
  assert.equal(dnsCheckDue(ready), false);
  assert.equal(dnsCheckDue({ dns: { ...ready.dns, mx: record("verified", 7 * 60) } }), true);
  assert.equal(dnsCheckDue(ready, Date.now(), Number.POSITIVE_INFINITY), false);
});

test("the mailbox address keeps folder, page and message in the URL", () => {
  assert.deepEqual(mailLocation("/mail"), { view: "inbox", box: "", folder: "INBOX", offset: 0, message: "" });
  assert.deepEqual(mailLocation("/mail?box=b1&folder=Sent&offset=40&message=1700.M1%2CS%3D9"), { view: "inbox", box: "b1", folder: "Sent", offset: 40, message: "1700.M1,S=9" });
  assert.equal(mailLocation("/mail?view=domains&message=x").view, "domains");
  assert.equal(mailLocation("/mail?view=nonsense&offset=-5").view, "inbox");
  assert.equal(mailLocation("/mail?offset=-5").offset, 0);
  assert.equal(mailHref({ view: "inbox", folder: "INBOX" }), "/mail");
  assert.equal(mailHref({ view: "domains", box: "b1", folder: "Sent" }), "/mail?view=domains");
  const href = mailHref({ view: "inbox", box: "b1", folder: "Sent", offset: 40, message: "1700.M1,S=9" });
  assert.deepEqual(mailLocation(href), { view: "inbox", box: "b1", folder: "Sent", offset: 40, message: "1700.M1,S=9" });
  assert.deepEqual(["INBOX", "Junk", "Archive"].map(folderLabel), ["Inbox", "Spam", "Archive"]);
  assert.deepEqual(["INBOX", "Sent", "Drafts"].map(folderShowsRecipients), [false, true, true]);
});

test("a reply quotes the original, threads on it, and reply-all leaves the owner out", () => {
  const message = {
    id: "1700.M1",
    from: { name: "Ploy", address: "ploy@partner.example" },
    replyTo: [],
    to: [{ name: "", address: "hello@example.test" }, { name: "Team", address: "team@partner.example" }],
    cc: [{ name: "", address: "boss@partner.example" }],
    subject: "Quote",
    date: "2026-11-11T09:00:00.000Z",
    messageId: "<m1@partner.example>",
    references: ["<m0@partner.example>"],
    text: "Line one\n\nLine two",
  };
  const reply = replyDraft(message, "hello@example.test", "reply", "INBOX");
  assert.equal(reply.to, "ploy@partner.example");
  assert.equal(reply.cc, "");
  assert.equal(reply.subject, "Re: Quote");
  assert.match(reply.text, /^\n\n.*Ploy.*\n> Line one\n>\n> Line two$/s);
  assert.equal(reply.inReplyTo, "<m1@partner.example>");
  assert.deepEqual(reply.references, ["<m0@partner.example>", "<m1@partner.example>"]);
  assert.deepEqual(reply.answered, { folder: "INBOX", id: "1700.M1" });

  const all = replyDraft(message, "hello@example.test", "reply-all");
  assert.equal(all.to, "ploy@partner.example");
  assert.equal(all.cc, "team@partner.example, boss@partner.example");
  assert.equal(replyDraft({ ...message, subject: "RE: Quote" }, "hello@example.test").subject, "RE: Quote");
  assert.equal(replyDraft({ ...message, replyTo: [{ name: "", address: "desk@partner.example" }] }, "hello@example.test").to, "desk@partner.example");
  // Replying to a message the owner sent goes to its recipients, not back to the owner.
  const own = replyDraft({ ...message, from: { name: "Me", address: "hello@example.test" }, to: [{ name: "", address: "ploy@partner.example" }] }, "hello@example.test");
  assert.equal(own.to, "ploy@partner.example");

  const forward = replyDraft(message, "hello@example.test", "forward");
  assert.equal(forward.to, "");
  assert.equal(forward.subject, "Fwd: Quote");
  assert.match(forward.text, /Forwarded message[\s\S]*From: Ploy <ploy@partner\.example>[\s\S]*Line two$/);
  assert.equal(forward.inReplyTo, null);
  assert.equal(forward.answered, null);
});

test("the message frame document blocks the network before any sender markup runs", () => {
  const hostile = '<meta http-equiv="Content-Security-Policy" content="img-src *"><base href="https://evil.example/"><img src="https://tracker.example/p.gif"><script>steal()</script>';
  const blocked = mailHtmlDocument(hostile);
  const policy = blocked.indexOf("Content-Security-Policy");
  assert.ok(policy > 0 && policy < blocked.indexOf("tracker.example"), "the policy precedes the sender's content");
  assert.ok(blocked.indexOf('<base target="_blank">') < blocked.indexOf("evil.example"), "the first base element wins");
  assert.match(blocked, /content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:"/);
  assert.doesNotMatch(blocked.slice(0, blocked.indexOf("<body>")), /script-src|https:/);
  assert.match(mailHtmlDocument(hostile, { images: true }), /img-src data: https:;/);
  assert.equal(hasRemoteContent(hostile), true);
  assert.equal(hasRemoteContent('<div style="background:url(https://x.example/a.png)">'), true);
  assert.equal(hasRemoteContent('<img src="data:image/png;base64,AAAA"><a href="https://x.example">x</a>'), false);
});

test("the reader frame is sandboxed without scripts or same-origin access", async () => {
  const client = await readFile(new URL("../public/ui/screens/mail/client.js", import.meta.url), "utf8");
  const sandbox = client.match(/sandbox: "([^"]*)"/)?.[1];
  assert.equal(sandbox, "allow-popups allow-popups-to-escape-sandbox");
  assert.doesNotMatch(client, /innerHTML|insertAdjacentHTML|document\.write/);
  // The frame must get its sandbox before its document.
  assert.ok(client.indexOf("sandbox:") < client.indexOf("srcdoc:"));
});

test("plain text links, dates, initials and generated passwords", () => {
  assert.deepEqual(linkify("see https://example.test/a?b=1. And http://x.test)"), [
    { text: "see " },
    { text: "https://example.test/a?b=1", href: "https://example.test/a?b=1" },
    { text: ". And " },
    { text: "http://x.test", href: "http://x.test" },
    { text: ")" },
  ]);
  assert.deepEqual(linkify("javascript:alert(1) ftp://x"), [{ text: "javascript:alert(1) ftp://x" }]);
  const now = new Date(2026, 10, 11, 15, 0);
  assert.match(formatMailDate(new Date(2026, 10, 11, 9, 5).toISOString(), now, "en-GB"), /^09:05$/);
  assert.equal(formatMailDate(new Date(2026, 10, 9, 9, 5).toISOString(), now, "en-GB"), "9 Nov");
  assert.equal(formatMailDate(new Date(2025, 0, 2, 9, 5).toISOString(), now, "en-GB"), "2 Jan 2025");
  assert.equal(formatMailDate("", now), "");
  assert.equal(formatMailDate("not a date", now), "");
  assert.deepEqual([{ name: "Ploy Sirikul" }, { address: "hello@example.test" }, { name: "สมชาย ใจดี" }, {}].map(initials), ["PS", "HE", "สใ", "?"]);
  const passwords = new Set(Array.from({ length: 20 }, () => generatePassword()));
  assert.equal(passwords.size, 20);
  for (const password of passwords) assert.match(password, /^[A-Za-z0-9_-]{20}$/);
});
