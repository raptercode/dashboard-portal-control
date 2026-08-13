# ADR 0020: Host helper keeps shadow-utils and ACME paths visible

- Status: Accepted
- Date: 2026-08-14

## Context

The root-owned deployment helper creates isolated project service accounts,
starts their systemd units, and asks Certbot to validate a webroot challenge.
Real-host acceptance on Ubuntu showed that `ProtectSystem=full` prevents
shadow-utils from acquiring its `/etc` locks even when `ReadWritePaths` names
the affected files. It also showed that project users and Nginx need traversal
access to otherwise root-owned parent directories: `/srv/hostmgr/projects` and
`/var/lib/hostmgr` respectively.

## Decision

The helper service does not set `ProtectSystem`. It remains root-owned and
accessible only by the `dashboardportal` group through a bounded Unix-socket
operation allowlist; it never accepts shell commands or arbitrary paths.

The installer sets `/srv/hostmgr`, `/srv/hostmgr/projects`, and
`/var/lib/hostmgr` to mode `0711`. This grants traversal without directory
listing. Individual project roots remain owned by the project service account,
and the ACME webroot remains root-owned.

## Consequences

- Account creation and deletion work with Ubuntu shadow-utils instead of
  failing during its lock or atomic-update sequence.
- Project services can enter only their own runtime root, while Nginx can read
  the ACME HTTP-01 challenge path.
- The helper's socket allowlist, request validation, static error messages,
  and non-root Dashboard process are now the primary privilege boundary; this
  needs real-host acceptance coverage on every supported Ubuntu release.
