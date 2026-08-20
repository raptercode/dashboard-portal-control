# ADR 0025: Mail host provisioning is port-aware and fails closed

- Status: Accepted
- Date: 2026-08-21

## Context

Mail support must work on hosts with uneven network capability: a provider may
block direct SMTP egress on 25 while allowing authenticated relay delivery on
587 or 2525, and a host's local firewall can permit only a subset of public
mail ports. A loopback test cannot prove that port 25 is reachable from the
public Internet, so the Portal must not claim it can.

## Decision

The root-owned helper owns all Postfix, Dovecot, OpenDKIM, mailbox, and TLS
changes. It accepts only typed operations and reads the encrypted desired state
it needs from the Portal database; no browser-supplied config directive or
shell command reaches the host.

Before configuration, the Portal performs SMTP egress probes for 25, 587, and
2525 and asks the helper to inspect UFW policy for inbound 25, 587, and 993.
The resulting plan enables only inbound services whose local policy is
`allowed`; `blocked` and `unknown` ports are left without a public listener.
The helper never changes firewall rules. Direct MX needs confirmed egress 25
and a matching PTR; relay modes need their selected egress port. A failed mail
certificate request downgrades every mail listener to loopback-only instead of
leaving a public plaintext or invalid-TLS service.

The UFW result is expressly local-firewall evidence. It is not proof of a
provider firewall or Internet reachability; receiving a real external message
remains the evidence for inbound SMTP.

## Consequences

- A relay-only host can send mail without exposing SMTP, submission, or IMAPS.
- A host with permitted inbound services receives managed Postfix/Dovecot TLS
  configuration, virtual mailboxes, and OpenDKIM without becoming an open
  relay (`reject_unauth_destination` is mandatory).
- Existing mail installations are not taken over silently: the helper only
  writes managed mail configuration after the Portal itself installed the mail
  packages and created its marker.
- Unmanaged firewall implementations report `unknown`, so the owner must
  provide a supported policy signal before public mail services are enabled.
