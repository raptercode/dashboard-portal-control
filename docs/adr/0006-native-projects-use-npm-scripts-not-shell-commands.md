# ADR 0006: Native projects use package scripts, not UI-provided shell commands

- Status: Accepted
- Date: 2026-08-03

## Context

Early README drafts mentioned build/start commands. Accepting shell strings from the UI and composing them into commands or systemd units creates a command-injection boundary that is hard to audit.

## Decision

Native Node.js and Bun projects specify `buildScript` and `startScript` as package-script names only. Allowed characters are letters, digits, colon, underscore, and hyphen. The helper executes a fixed argument vector such as `/usr/local/bin/npm run start` or `/usr/local/bin/bun run start` under a project-specific Unix user.

Environment variables live in a root-owned environment file separate from the unit and logs; values are not returned through the API or audit events.

## Consequences

- Native projects that need commands beyond package scripts use Docker mode or remain out of scope
- systemd units can use hardening directives and have no shell interpolation from the UI
- README and UI must say script, not command, for Native mode
