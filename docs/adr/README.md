# Architecture Decision Records

Documents in this folder record architecture decisions that affect code, operations, or product scope.

- Name files `NNNN-short-title.md`; check the folder for the highest existing number before assigning a new one — two ADRs have already collided on the same number once
- Status is `Proposed`, `Accepted`, `Superseded`, or `Deprecated`
- An `Accepted` ADR is current policy; if it changes, create a new ADR and reference the previous one
- Do not rewrite decision history to match current thinking; record the impact and reasons for the change instead

Current operational decisions include [ADR 0020](0020-host-helper-keeps-shadow-utils-and-acme-visible.md) for the Hostinger helper compatibility fix, [ADR 0021](0021-trusted-docker-compose-project-runtime.md) for trusted Docker Compose projects, [ADR 0022](0022-bun-native-project-runtime.md) for Bun-native projects, [ADR 0023](0023-project-ports-are-auto-assigned.md) for auto-assigned project ports, [ADR 0024](0024-bun-sandbox-path-and-release-dependency-cleanup.md) for Bun's runtime path and dependency cleanup, and [ADR 0025](0025-port-aware-mail-host-provisioning.md) for guarded mail provisioning.
