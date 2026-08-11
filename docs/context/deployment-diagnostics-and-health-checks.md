# Deployment diagnostics and health checks

## What a deployment records

Each release retains an ordered, safe event log in Portal state. The project
card opens the latest release's **Logs** dialog, which reports candidate source
copy, dependency installation, build, candidate health, host activation, and
the final failure reason. Messages deliberately exclude command output,
filesystem paths derived from project input, environment values, and secrets.

The active release is not changed unless every required phase succeeds.

## Health-check configuration

Health checks are enabled by default for compatibility and safety. A project
can choose an HTTP path such as `/`, `/health`, or `/healthz`. Disabling the
checkbox skips both the temporary candidate HTTP probe and the post-start host
HTTP probe; the release log explicitly records `skipped`.

Use the skip option only for software that cannot provide an HTTP endpoint.
The service still has to start successfully under systemd, but a skipped check
cannot prove that the application is ready to receive traffic.

## Privileged activation boundary

The dashboard stays unprivileged. A root-owned helper accepts only typed
requests over its local Unix socket. Project activation necessarily creates a
static service account, systemd unit, encrypted-environment file, managed
Nginx configuration, ACME working files, and project runtime. Its systemd
sandbox therefore keeps `ProtectSystem=full` and explicitly permits `/etc`,
`/var/lib/hostmgr`, and `/srv/hostmgr/projects` rather than disabling filesystem
protection altogether.

If activation fails, begin with the release log in the UI, then inspect the
helper using `journalctl -u hostmgr-deploy-helper -n 100 --no-pager`. Do not
copy raw journal output containing project or environment data into the UI.
