# ADR 0024: Bun uses a runtime bind path and old dependencies are pruned

- Status: Accepted
- Date: 2026-08-14

## Context

Project service accounts can traverse but cannot list shared managed parent
directories. Bun 1.3.13 cannot resolve its current directory under that layout
when executing an application, even though the service account owns the
release. In addition, every native release contains a full `node_modules`
tree; retaining dependencies for every historical release consumes unnecessary
disk space.

## Decision

Bun systemd units bind the active release into a service-owned path below
`/run/hostmgr-project-<slug>/app` and use that as their working directory.
The application source remains under the existing per-project root and retains
the same systemd hardening.

After a successful native activation and domain sync, the helper removes only
`node_modules` from releases older than the active release and its immediate
rollback target. It keeps source and release metadata for audit history, and
does not prune a failed activation, the active release, or the one-step
rollback release.

## Consequences

- Bun projects start without weakening parent-directory privacy.
- The active and immediate rollback release remain runnable without a network
  install.
- Rolling back to an older historical release requires a fresh deployment,
  rather than claiming it is immediately runnable.
