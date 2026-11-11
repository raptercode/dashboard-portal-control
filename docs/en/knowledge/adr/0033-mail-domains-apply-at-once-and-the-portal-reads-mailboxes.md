# ADR 0033: Mail domains apply at once, and the Portal reads mailboxes through the helper

[ภาษาไทย](../../../th/knowledge/adr/0033-mail-domains-apply-at-once-and-the-portal-reads-mailboxes.md)


- Status: Accepted
- Date: 2026-11-11
- Amends: [ADR 0025](0025-port-aware-mail-host-provisioning.md) (the port and TLS rules there are unchanged)

## Context

Two things made the mail service hard to run after its first setup.

**Domains.** The helper re-validated the whole mail state on every mail operation and required MX, SPF, DKIM and DMARC of *every* domain to be `verified`. Adding a domain to a running service therefore:

- did nothing on the host until the owner verified four DNS records and ran **Activate mail service** again, which rewrites every configuration file, asks Certbot again and restarts Postfix, Dovecot and OpenDKIM;
- blocked creating a mailbox on any domain, including the ones that already worked, until the new domain's DNS was verified;
- could not be undone: removing the unverified domain went through the same validation and was refused.

Those four records do not decide whether a host can be configured. They decide whether other servers deliver to a domain and trust what it sends. Only the mail hostname (the certificate request must reach this host) and, for direct delivery, the PTR record are needed to configure the service.

**Reading mail.** The Portal created mailboxes but could not show them. Reading or sending needed a separate mail client and an open IMAP port. The owner asked to see received and sent mail in the Portal.

The mail design record had advised the opposite: a future webmail should be a separate product with its own Maildir permission, session isolation and audit scope. This decision keeps the reader inside the Portal because the owner asked for one place, and it answers those three points explicitly below rather than leaving them implied.

## Decision

### 1. Domain DNS is health, not a gate

- `validateMailState` in the helper checks structure only (names, DKIM key material, relay shape). The hostname and PTR requirements moved to `assertMailActivationReady`, which only `configure-mail` calls. The Portal's `assertHostMailReadiness` dropped the per-domain DNS condition too.
- A new helper operation, `sync-mail-domains`, rewrites the Postfix domain and mailbox maps and the OpenDKIM key material and tables from the stored state, then reloads Postfix and OpenDKIM. It requests no certificate and restarts nothing.
- `POST /api/mail/domains` stores the domain and, when the service is already configured on a real host, calls `sync-mail-domains` in the same request. If the helper refuses, the domain is removed from the state again and the request fails, so the Portal never lists a domain the host does not have. Removal already had its own operation (`remove-mail-domain`) and now works whatever the DNS state.
- `create-mailbox` no longer re-reads the port plan. It needs a managed installation and a known domain.
- The interface checks DNS by itself: when a domain is added, when the Domains view opens, and every 90 seconds for records that are not verified. A check sent with `background: true` writes an audit entry only when a record changed state. The result is shown per record with the exact host and value to enter at the DNS provider.
- The comment in the generated `main.cf` names the domain map instead of listing domains, because that file is no longer rewritten when the list changes.

What stays a condition, once, at configuration: packages installed by the Portal, the mail hostname resolving to this host, a matching PTR for direct delivery, the outbound port of the chosen mode confirmed open, and the inbound port policy of ADR 0025.

### 2. The Portal reads and writes Maildir through typed helper operations

Mail lives in `/var/vmail/<domain>/<local part>/Maildir`, owned by the `vmail` account. The Portal process cannot read it and is not given access. Seven helper operations (`mail-folders`, `mail-list`, `mail-read`, `mail-flag`, `mail-move`, `mail-delete`, `mail-store`) all pass through one gate, `mailboxOperation`: the domain and local part are validated, the address must be in the Portal's own user file, and the three directories on the way must be real directories.

- **No path crosses the socket.** A request names a folder (`INBOX` or a Maildir++ name matching `[A-Za-z0-9&][A-Za-z0-9 _.&+,-]*`, no `..`) and a message reference (the Maildir base name). `scripts/maildir-store.mjs` builds every path, checks directories with `lstat` and opens files with `O_NOFOLLOW`, so a link placed inside a mailbox is not followed.
- **The helper moves bytes; the Portal decodes them.** Root never parses MIME, charsets or HTML. A listing returns nine header fields and the first 2 KiB of the body per message (at most 50 messages); a message is read in 256 KiB chunks so each response fits the existing 512 KiB socket limit. A message over 30 MiB is refused. `src/mail-message.mjs` decodes in the unprivileged process, with depth (8), part count (200) and output sizes bounded.
- **Storing a Sent copy uses a spool file, not a larger request.** The 16 KiB request limit is unchanged. The Portal writes the message to `mail-outbox/<uuid>.eml` in its own data directory and sends only the UUID. The helper opens it with `O_NOFOLLOW` and accepts it only if it is a regular file with one name, owned by the Portal account and within the size limit, then writes it into the Maildir with `O_EXCL` and gives it to `vmail` with `lchown`. The Portal removes the spool file.
- **Sending goes to the host's own Postfix** on `127.0.0.1:25`, which is already in `mynetworks`. Postfix signs with DKIM, queues, and delivers or relays, exactly as for a mail client. Bcc recipients are given to SMTP only; they are never written into the message. One refused recipient stops the send before any data.
- **Flags and folders follow Maildir++**, so Dovecot and IMAP clients see the same state: a read message moves from `new/` to `cur/` with `S`, Sent is `.Sent/`, deleting moves to `.Trash/` and only a message already in Trash is erased.

### 3. Sender markup is never trusted

- The API returns the HTML part as data. The interface shows it only in an `<iframe sandbox="allow-popups allow-popups-to-escape-sandbox">` filled through `srcdoc`: no `allow-scripts`, no `allow-same-origin`. The document starts with a `Content-Security-Policy` of `default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:` and a `<base target="_blank">` before any sender content, so later tags cannot widen the policy. Remote images load only after the reader asks, which changes `img-src` to `data: https:`.
- Images sent inside the message (`cid:`) are inlined as `data:` URIs when they are PNG, JPEG, GIF, WebP or BMP and small. SVG is never inlined.
- An attachment is always answered as `application/octet-stream` with `Content-Disposition: attachment`, `nosniff` and a `sandbox` policy, whatever type the sender declared.
- `srcdoc` was chosen over a framed API response because the installed Nginx sends `X-Frame-Options: DENY` for the Portal.

### 4. Access

Every `/api/mail/...` route, including the new ones, is Master only (the default of `authorizeRequest`), and every change needs the CSRF token. Opening a message changes nothing by itself: the interface marks it read with an explicit `POST .../flags`.

- **Maildir permission:** none for the Portal process. Only the helper touches `/var/vmail`, through the operations above.
- **Session isolation:** not provided. The reader is part of the Master's Portal session, with the same cookie and the same seven-day lifetime. There is no per-mailbox sign-in.
- **Audit scope:** sending writes an audit entry with the sender address and the number of recipients, never the content. Reading, flagging, moving and deleting are not audited.

## Consequences

- Adding or removing a mail domain is one action with no DNS wait and no second activation. A domain whose DNS is incomplete works on the host but its mail may be refused or marked as spam elsewhere; the interface says so and keeps checking.
- A Master can read every mailbox of the host from the Portal. That follows from owning the host, but it is a new capability of the Portal session and of the helper socket: whoever controls the Portal account can read mail.
- Received and sent mail can be read with every inbound mail port closed, because the reader does not use IMAP.
- The first update to this version must run the installer path as usual (`sudo strckro update`), because the root helper and a new helper module (`maildir-store.mjs`) change.
- Domains added before this version without a second activation are written to the host by the next add or remove, or by **Apply configuration again**.
- Not built: attachments in composed mail, drafts saved from the Portal, search, changing a mailbox password, and conversation threading.

## Verification

Covered by tests on a workstation: the Maildir module on real files (including link handling on Linux), MIME decoding and composing, the SMTP dialogue against a scripted server, the HTTP API in the sandbox, and the Portal's requests to a recording helper in host mode. The interface was exercised in a browser against the sandbox at 1440, 390 and 320 pixels.

Not verified: a real host. Nothing here has run against Postfix, Dovecot or OpenDKIM, so the reload after `sync-mail-domains`, Dovecot noticing files the helper writes, ownership and modes under `/var/vmail`, DKIM signing of a message submitted on loopback, and the spool hand-off between the two accounts still need a host acceptance run.
