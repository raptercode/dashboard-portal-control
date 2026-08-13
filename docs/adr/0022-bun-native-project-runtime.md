# ADR 0022: Bun is a supported native project runtime

- Status: Accepted
- Date: 2026-08-14

## Context

The Portal previously supported native projects only through the pinned Node.js
runtime and `npm` scripts. Some owned projects use Bun as both their package
manager and runtime, including services that can start directly from their
`start` script without a compilation phase.

## Decision

Native projects may select either `node` or `bun`. Both retain the same
security boundary: build and start values are constrained package-script names,
never shell commands. Bun candidates use `bun install --frozen-lockfile` when
`bun.lock` or `bun.lockb` is present, and fall back to `bun install` only when
that lockfile is incompatible. Host systemd units execute the fixed
`/usr/local/bin/bun run <start-script>` argument vector.

The production installer provides a pinned, checksum-verified Bun baseline
binary for amd64 Ubuntu hosts. Bun services use a bind-mounted service runtime
path below `/run` so Bun can resolve its current directory without making the
shared project parent listable. The project wizard exposes an explicit **Skip
Build** option; it stores an empty build script and therefore skips only the
build phase, not dependency installation, start-script validation, health
checks, or host activation safeguards.

## Consequences

- Existing Node and Docker Compose projects remain unchanged.
- Bun applications can use the same candidate, health-check, activation, log,
  rollback, and managed-Nginx contracts as Node projects.
- Updating the Portal installs the pinned Bun binary before a Bun project can
  be deployed on the host.
