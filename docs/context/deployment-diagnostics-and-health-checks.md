# Deployment diagnostics and health checks

## What a deployment records

Each release retains an ordered, safe event log in Portal state. The project
card opens the latest release's **Logs** dialog, which reports candidate source
copy, dependency installation, build, candidate health, host activation, and
the final failure reason. Messages deliberately exclude command output,
filesystem paths derived from project input, environment values, and secrets.

The active release is not changed unless every required phase succeeds.

## Dependency installation

When `package-lock.json` is present and compatible with `package.json`, a
candidate uses `npm ci` for a clean, locked install. If the lockfile is absent
or npm reports that it is incompatible, the Portal retries `npm install` only
in that isolated candidate. It does not write, commit, or push a replacement
lockfile to the synced Git checkout. The dependency phase records which path
was used without retaining raw npm output.

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
sandbox keeps `ProtectSystem=full` and permits only the exact account files,
managed directories, and runtime paths required by those operations. A broad
`ReadWritePaths=/etc` does not override the protected `/etc` mount on the
supported systemd version.

If activation fails, begin with the release log in the UI, then inspect the
helper using `journalctl -u hostmgr-deploy-helper -n 100 --no-pager`. Do not
copy raw journal output containing project or environment data into the UI.

## Runtime log viewer

Each project's page has a **Logs** link to `/projects/:slug/logs`, which shows
its systemd unit's recent journal output (auto-refreshing) next to its
deployment/build event history. In host mode this reads through the
root-owned helper's `read-project-log` operation, scoped to that project's own
unit only (see [ADR 0019](../adr/0019-runtime-project-logs-are-read-through-the-root-owned-helper.md)).
In demo/sandbox mode it shows an explicit placeholder instead of fabricated
output. Use this before reaching for `journalctl` directly on the host.

## Update verification

An update must restart the helper and dashboard services after `daemon-reload`.
`systemctl enable --now` starts an inactive unit but leaves an active Node
process running its old modules. Verify the new PID/start timestamp,
`/api/health`, **and a static page** (e.g. `curl -fsSI https://YOUR-DOMAIN/`)
after every update — a permission regression on the application root can
leave the API healthy while static file serving returns `500`. See
`docs/production-install.md`'s Software Update section for the exact check.
