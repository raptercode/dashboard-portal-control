# Production acceptance record: 2026-08-07

## Scope

The direct installer was exercised on an Ubuntu 25.04 amd64 host under the operational exception in ADR 0012. A real DNS-only HTTP-01 path was used for certificate issuance.

## Evidence recorded

- Release archive checksum verified before extraction.
- Installer preflight resolved the configured domain to the host.
- Node.js 24.18.0 was installed from the pinned archive and the Dashboard service started as its unprivileged account.
- Nginx configuration passed `nginx -t`; the Dashboard Portal service and Nginx were both active and enabled.
- Loopback and public HTTPS `/api/health` checks returned `status: ok` in `host` mode.
- Let’s Encrypt issued a valid certificate and Certbot configured renewal.
- HTTP returned a redirect to HTTPS with the expected response headers.

## Deliberate exclusions

This run did not reboot the host because it already runs unrelated services. It also did not validate a project deployment or rollback: those require the reviewed privileged project activation helper and SSH deploy-key lifecycle described elsewhere.

## Host repair observed

An unsupported `deadsnakes` PPA for Ubuntu 25.04 caused the first `apt-get update` to fail. Its source file was retained as a `.disabled` file before retrying; package state was then healthy and the installer completed.
