# ADR 0016: Dashboard software updates are SSH-initiated

- Status: Accepted
- Date: 2026-08-08

## Context

Dashboard Portal is itself part of the host control plane and ships a root-owned
deployment helper. Letting its browser UI download and replace that software
would enlarge the privileged API boundary and require the running service to
hold update authority.

## Decision

The authenticated UI may fetch a small signed update manifest over HTTPS and
display availability, release notes, and a copyable SSH command. It cannot
apply an update.

The owner applies an update through:

```bash
sudo dashboard-portal update --channel=stable
```

The root-only command verifies an Ed25519-signed manifest, downloads the
HTTPS-only archive, verifies its SHA-256 digest, stages it in `/tmp`, and runs
the existing transactional installer. The installer retains its health check
and rollback behavior.

The public verification key is stored at
`/etc/dashboard-portal/update-public-key.pem`; the signing private key stays
outside the repository and is supplied to the release CI only.

## Consequences

- The UI is a notification surface, not a remote shell or self-update API.
- Releases must be immutable artifacts, not mutable Git branches.
- An unavailable, malformed, or invalidly signed manifest fails closed and is
  shown as unavailable without exposing its contents.
- Project Git deployments remain independent from Portal software updates.
