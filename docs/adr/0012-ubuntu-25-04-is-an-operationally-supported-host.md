# ADR 0012: Ubuntu 25.04 is accepted for the current operational host

- Status: Accepted
- Date: 2026-08-07

## Context

ADR 0001 selected Ubuntu 24.04 LTS as the original certification baseline. The available production host is Ubuntu 25.04 amd64 and a separate 24.04 VM is not available within the current budget.

## Decision

The direct installer accepts Ubuntu 24.04 and 25.04 on amd64. The same pinned Node.js archive, Nginx ownership boundary, systemd hardening, TLS fail-closed flow, and recovery rules apply to both releases.

Ubuntu 25.04 is an operational support exception, not a claim that it has the long support lifetime of Ubuntu 24.04 LTS. The production install must record real-host acceptance evidence, including systemd, Nginx, Certbot, HTTPS and reboot checks.

## Consequences

- ADR 0001 remains historical; this ADR supersedes its host-version restriction for the direct installer.
- The installer still rejects every other Ubuntu version and non-amd64 host.
- Before Ubuntu 25.04 reaches end of life, migrate the Dashboard Portal to a supported LTS release and repeat the acceptance run.
