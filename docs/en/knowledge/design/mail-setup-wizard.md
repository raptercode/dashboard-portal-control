# Mail setup wizard design

Localized topic guide; the original detailed record is available in [Thai](../../../th/knowledge/design/mail-setup-wizard.md).


This is design knowledge with implementation details and future ideas. It is not an instruction to provision a production mail host. Use source/ADR 0025 to establish current behavior and separate host evidence from proposed UI behavior.

## Domain model

A mail hostname (typically `mail.example.com`) identifies the SMTP server, HELO, PTR and server TLS. A mail domain (`example.com`) identifies address ownership. Multiple mail domains may use one mail hostname; each needs its own MX/SPF/DKIM/DMARC records. Adding/removing a domain affects its mailboxes/routes and requires checking current dependencies; selecting the Portal domain does not establish DNS ownership automatically.

Use a DNS-only A/AAAA record for the mail hostname. MX points to that hostname, not a CDN proxy. SPF records authorize the selected direct/relay path; avoid duplicate SPF TXT records. DKIM uses `<selector>._domainkey.<domain>` with only the public key in DNS. DMARC uses `_dmarc.<domain>`; begin with reporting policy and tighten after observing alignment. PTR/rDNS belongs to the server IP and is configured with the hosting provider, not as an ordinary domain-zone record. Align PTR, hostname and HELO for direct delivery.

## Seven-stage workflow

Guide the owner through prerequisites/readiness, server hostname and mail domains, delivery mode/relay credentials, generated DNS records and verification, mailboxes, managed installation/TLS and final delivery checks. Preserve the exact API models, mockups and per-step transitions in the detailed Thai record when extending the UI. Show blocked and unknown prerequisites explicitly rather than treating them as passed.

Direct-MX mode needs outbound TCP 25 and matching PTR. Relay mode uses the chosen authenticated outbound port such as 587/2525 and encrypted credentials. API egress checks differ from helper-observed inbound UFW policy for 25/587/993. Local allowed policy does not prove a provider firewall permits Internet traffic. The helper must never open firewall rules automatically. Enable only public listeners permitted by the local plan. Certificate failure makes all mail listeners loopback-only.

## Host ownership and security

Only the root-owned helper provisions Postfix/Dovecot/OpenDKIM, managed virtual-mail files and TLS from typed desired state. It may decrypt required relay/DKIM secrets inside the host boundary. Browser-provided shell/config directives are rejected. Existing unmanaged mail installations must not be taken over silently; managed installation requires its ownership marker. Keep `reject_unauth_destination` to prevent an open relay. Do not display relay passwords, DKIM private keys or mailbox secrets in API lists/audit/logs.

Check certificate coverage and ownership before reusing Portal/Certbot material. Mail hostname certificates and mail-domain DNS records have distinct purposes. Changes must preserve managed-file backup/recovery and safe service reload behavior. DNS verification reports each record and propagation state; it does not silently change the provider zone.

## Acceptance and further development

Verify generated config with actual Postfix/Dovecot/OpenDKIM binaries, certificate issuance/failure, loopback fallback, permitted listeners, SMTP relay auth, external inbound mail, DKIM signatures, SPF/DMARC alignment and mailbox access. Test bad DNS/PTR, blocked egress, unknown UFW, provider filtering and service rollback. Loopback tests are insufficient deliverability evidence.

Before extending to new Ubuntu releases, validate Dovecot 2.3 versus 2.4 config/data compatibility separately. Planned UX/port logic in the detailed design should be compared with source and [architecture](../context/architecture.md), [mail ADR](../adr/0025-port-aware-mail-host-provisioning.md) and [Ubuntu plan](../plans/ubuntu-compatibility-plan.md). Keep unresolved options in knowledge; promote proven procedures to how-to after acceptance.
