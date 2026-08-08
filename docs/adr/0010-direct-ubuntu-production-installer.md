# ADR 0010: Production runs directly on Ubuntu through systemd and Nginx

- Status: Accepted
- Date: 2026-08-03

## Decision

Production installs from a release directory with `sudo ./dashboard-portal.sh --domain=... --email=...`. The installer targets the Ubuntu releases defined by ADR 0012, installs required packages, creates an unprivileged service account, runs the Node process only on loopback, and exposes it through host Nginx. TLS enforcement and recovery behaviour are defined by ADR 0011.

Docker remains a development and integration environment, not a production prerequisite.

## Consequences

- HTTPS is mandatory and is issued only after DNS resolution passes.
- State and encrypted secrets persist in `/var/lib/dashboard-portal`; configuration and the master key persist in `/etc/dashboard-portal`.
- The installer must run as root and is intentionally not run from the Windows development workspace.
