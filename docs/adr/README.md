# Architecture Decision Records

Documents in this folder record architecture decisions that affect code, operations, or product scope.

- Name files `NNNN-short-title.md`; check the folder for the highest existing number before assigning a new one — two ADRs have already collided on the same number once
- Status is `Proposed`, `Accepted`, `Superseded`, or `Deprecated`
- An `Accepted` ADR is current policy; if it changes, create a new ADR and reference the previous one
- Do not rewrite decision history to match current thinking; record the impact and reasons for the change instead

Current operational decisions include [ADR 0020](0020-host-helper-keeps-shadow-utils-and-acme-visible.md) for the Hostinger helper compatibility fix and [ADR 0021](0021-trusted-docker-compose-project-runtime.md) for trusted Docker Compose projects.
