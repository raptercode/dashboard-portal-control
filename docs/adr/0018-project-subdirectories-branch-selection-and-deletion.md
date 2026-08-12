# ADR 0018: Project sources may use a repository subdirectory

- Status: Accepted
- Date: 2026-08-11

## Decision

A project stores an optional `directory` that is an absolute-looking path *inside
its checked-out repository*. `/` is the repository root; `/examples` selects the
`examples` folder in a monorepo. The value is normalized and rejects traversal,
backslashes, and empty path segments.

The dashboard fetches Git branch names with `git ls-remote --heads` and presents
them as a selection. HTTPS credentials continue to use a short-lived AskPass
file, so tokens are never added to a URL, command line, API response, or audit
record.

Project configuration can be reopened and edited. Deletion is audited; in host
mode the root-owned helper first stops the project and removes only its
allowlisted service/runtime/Nginx files before the dashboard removes the
managed source workspace and saved project state.

## Consequences

- A monorepo can deploy a Node application from `/examples` without treating a
  browser-provided path as a host filesystem path.
- Changing configuration resyncs the repository while preserving its deployment
  history and encrypted environment metadata.
- Deletion does not remove a project's separately issued certificate, so an
  accidental delete cannot remove certificate material that may be needed for
  investigation or recovery.
