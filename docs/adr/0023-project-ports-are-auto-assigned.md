# ADR 0023: Project ports are auto-assigned and reserved

- Status: Accepted
- Date: 2026-08-14

## Context

Two projects configured with the same internal port make their independent
Nginx virtual hosts proxy to the same application. The resulting domain mix-up
is easy to miss because both reverse-proxy configurations are otherwise valid.

## Decision

New projects do not accept a manually entered port. The Portal randomly picks
a port from 12000 through 45000, checks that it is not assigned to another
project and is currently bindable on loopback, and retries up to 128 times. For
native Node.js and Bun projects it also reserves and checks the temporary
candidate health-check port. Existing projects keep their assigned port until
an owner explicitly selects automatic reassignment during a sync.

## Consequences

- New project domains cannot silently share another managed app's proxy port.
- A released project owns its selected port; a deployment still runs its
  health check and catches a later process-level bind race.
- The Portal continues to set `PORT` explicitly in systemd, overriding an
  application's environment default.
