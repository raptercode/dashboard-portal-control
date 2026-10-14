# ADR 0031: Maintenance exclusion and installation recovery

[ภาษาไทย](../../../th/knowledge/adr/0031-maintenance-exclusion-and-install-recovery.md)

Status: Accepted for the current working tree; operational acceptance pending
Date: 2026-10-01

## Context

An installer health failure can use an explicit `exit` and bypass an ERR-only
trap. Copying SQLite database/WAL/SHM while writers remain active does not
establish a consistent backup. Restoring only Portal service state leaves the
helper stopped, while overwritten CLI and Nginx catchall resources also need
snapshots. Stopping services during a host operation risks interrupting it.

## Decision

Use an EXIT recovery handler for nonzero exit, including explicit failures;
INT and TERM exit with 130 and 143. Disable recursive traps during recovery.
Successful completion disarms recovery and cleans temporary files safely.

Record enabled and active state independently for Portal and helper. Stop both
before SQLite/control-plane snapshots. Restore files only after the complete
snapshot set exists; a partial backup failure recovers service state without
deleting or replacing unsnapshotted originals. Completed per-item markers also
distinguish an absent original from an incomplete copy. Restore helper before
Portal. Include the CLI directory, managed catchall available/enabled paths and
maintenance tmpfiles configuration in recovery. Packages and issued TLS
certificates remain outside automatic rollback coverage.

Use Linux `flock` shared leases for participating host operations and an
exclusive nonblocking installer lock before stopping services. Host-mode HTTP
mutations, background queues/polling and helper dispatch are guarded. A busy
installer refuses the update before service stop; busy or unsafe/unavailable
leases reject host operations. Demo mode remains separate from real host mode.
Leases cover the operation lifetime and are released after completion.

The default lock is `/run/dashboard-portal-maintenance/operations.lock` in a
root-owned directory outside the helper's `/run/dashboard-portal`
RuntimeDirectory. The directory uses root:dashboardportal 0750 and the regular,
single-link file root:dashboardportal 0660. Reject symlinks, unexpected owners,
unsafe directory permissions and world-accessible lock files. Existing lock
inodes are not truncated, removed or replaced during updates: two different
inodes would defeat exclusion. This requires Linux and the `flock` utility.

`/etc/tmpfiles.d/dashboard-portal-maintenance.conf` recreates the volatile lock
directory/file at boot. Both services order after
`systemd-tmpfiles-setup.service`. This implements reboot preparation; actual
systemd boot/reboot acceptance remains a release gate.

## Trust boundary and consequences

This is cooperative update exclusion, not a sandbox or a general drain
protocol. Trusted repositories and the existing privileged-helper boundary
remain required. Legacy installed versions do not take shared leases, so an
exclusive lock alone cannot prove their operations are idle. The first upgrade
must occur on a confirmed quiescent host, including deployment, tool, mail and
background work. Do not certify automatic safe draining of legacy operations.
Root-level commands outside the participating paths must respect maintenance.

Local Bash recovery fixtures and Linux lease fixtures verify bounded behavior.
They do not certify real service shutdown, public TLS, database/key restore or
provider networking. Follow the [acceptance record](../plans/v1-acceptance-record.md)
and [readiness priorities](../plans/v1-readiness-plan.md) before a final release.
