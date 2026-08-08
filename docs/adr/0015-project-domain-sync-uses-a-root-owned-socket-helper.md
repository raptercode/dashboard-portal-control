# ADR 0015: Project domain sync uses a root-owned socket helper

- Status: Accepted
- Date: 2026-08-07

## Context

Native project activation needs controlled access to systemd, managed Nginx
files, and Certbot. Running a root script directly from the dashboard process
would either fail under `NoNewPrivileges` or weaken the privilege boundary.

## Decision

The installer provisions a root-owned helper service on a Unix socket. Only the
`dashboardportal` group can connect to the socket; requests are bounded JSON
operations: allowlisted tool installation, project activation, and project
domain sync. The browser never supplies a shell command or a filesystem path.

For an active project, a domain sync validates FQDNs and DNS availability,
rejects domains claimed by external Nginx configuration, writes only its own
`hostmgr-<slug>.conf` file, validates Nginx before reload, and obtains a
webroot ACME certificate. A failed sync restores the prior managed Nginx file.
Activation creates an isolated project user, atomically switches `current`,
health-checks the final port, and restores the previous release if activation
or domain/TLS sync fails.

## Consequences

- A project must save at least one domain before host deployment.
- DNS must resolve before Certbot can issue or expand a certificate.
- `.env` saves with blank content default to `NODE_ENV=production`.
- The helper intentionally remains a narrow host capability, not a generic
  command runner.
