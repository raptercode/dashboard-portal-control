# ADR 0019: Runtime project logs are read through the root-owned helper

- Status: Accepted
- Date: 2026-08-13

## Context

Native projects run as per-project systemd services under their own
unprivileged users (ADR 0015), and systemd captures each service's
stdout/stderr in the journal by default. The dashboard process is itself
unprivileged and cannot read another user's journal entries, so a UI feature
that shows a project's live runtime output needs the same root-owned helper
boundary already used for activation and domain sync, not a new privilege
path.

## Decision

The existing root-owned socket helper (ADR 0015) gains one additional
allowlisted, read-only operation: `read-project-log`. Given a validated
project slug and a bounded line count (default 150, capped at 200), it runs
`journalctl -u <unit> -n <count> --no-pager -o short-iso` for that project's
own systemd unit only, truncates each line defensively, and returns the
result over the existing bounded JSON socket protocol. The client-side
response cap in `helper-client.mjs` was raised from 16 KiB to 64 KiB so a
useful window of log lines fits; the socket remains loopback-only and
reachable only by the `dashboardportal` group.

In demo/sandbox mode, where no systemd unit exists, the dashboard returns an
explicit sandbox placeholder stating the log is simulated instead of
fabricating request-looking log lines. In host mode with no helper socket
configured, it returns a clear "not configured" notice rather than an error.

## Consequences

- A project's runtime output — whatever it prints to stdout/stderr — is now
  reachable from the authenticated dashboard UI. This is inherent to a log
  viewer and mirrors what the project's own process already writes to the
  journal; the dashboard does not add a new class of exposure beyond that.
- The helper's operation stays read-only and fixed-shape (unit name derived
  from the validated slug, not from arbitrary browser input); it still cannot
  execute arbitrary commands or read arbitrary files, preserving the "narrow
  host capability, not a generic command runner" property from ADR 0015.
- v1 exposes only a fixed recent-lines window, no time range or priority
  filter; a future range/filter feature would need its own bounds review
  given the socket response cap.
