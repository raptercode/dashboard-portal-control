# ADR 0004: UI installer is a real, constrained privileged workflow

- Status: Accepted
- Date: 2026-08-03

## Context

The first release must let the machine owner install Nginx, Certbot, and Git from the UI for real. Letting the UI send shell commands straight to root is an unacceptable risk.

## Decision

UI and CLI call the same installer service through a privileged helper. The helper accepts only allowlisted operations with typed parameters from a system-managed package manifest, such as install or verify `nginx`, `certbot`, and `git`. There is no generic `run command` API.

Before changing the machine, the UI must show packages, preflight results, what will change, and a confirmation. Operations must write audit events and redact secrets from output. Repair or force may touch only Host Manager-owned packages/config, with backup and diff.

## Consequences

- Adding a new tool requires a new manifest, validation, rollback behaviour, and tests; users cannot type arbitrary packages or commands
- The privileged helper is the first workstream before the UI installer
- The UI installer has no authority to change Nginx config outside the ownership boundary in ADR 0003
