# ADR 0030: Public bootstrap and bilingual documentation

[ภาษาไทย](../../../th/knowledge/adr/0030-public-bootstrap-and-bilingual-documentation.md)


Status: Accepted
Date: 2026-09-30

## Decision

Use public install.sh as the installation entry point, documenting a single latest-stable command; version pinning remains available internally. Read domain and email from the controlling terminal, using Node 24 by default, including when stdin is a curl pipe and sudo is needed. Verify the requested GitHub release SHA-256 before invoking internal dashboard-portal.sh. Preserve existing OS gates, TLS, backups/recovery and privilege boundaries.

Organize docs/th and docs/en into how-to for executable procedures and knowledge for architecture, design, ADRs and future plans. Track shared knowledge. Ignore only machine-local notes in docs/knowledge-local; preserve existing decision history. Localized topic adaptations may be shorter while linking to detailed originals and retaining facts/status/date.

## Consequences

Serving the bootstrap URL is a separate publishing step; a Git file does not prove it is live. Initial bootstrap trusts HTTPS/GitHub plus checksum; installed signed updates additionally verify Ed25519. Installation requires an interactive terminal for prompts/passwords. Link checks must cover both languages after moves. Current how-to presents only the public bootstrap install commands; historical ADRs retain historical command context.
