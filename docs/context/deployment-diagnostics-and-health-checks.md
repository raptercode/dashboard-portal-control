# Deployment diagnostics and health checks

## What a deployment records

Each release retains an ordered event log in Portal state. The project card
opens the latest release's **Logs** dialog, which reports candidate source
copy, dependency installation, build, candidate health, host activation, and
the final failure reason. The dialog also keeps up to 48 KiB of deployment
diagnostics, including command name, exit code or spawn error, and stdout/stderr
for failed host operations such as account creation, dependency installation,
service startup and domain activation. Failed host starts retain the project's
own runtime output since that activation, before rollback. Long output carries
an explicit truncation notice. The owner can copy the events and error details
from the dialog. Before it is stored, values from the
project `.env`, authorization headers, and common secret assignments are
replaced with `<redacted>`. Only authenticated owner/authorized project-log
readers receive these diagnostics; never send an entire helper journal to the UI.

Linux service accounts retain `hostmgr-<slug>` when it fits within 32 characters.
Longer slugs use `hostmgr-<first 7 slug characters>-<16 hex SHA-256 characters>`.
The slug, service name, domain and release paths remain stable. This avoids
`useradd: invalid user name` for otherwise valid project slugs without relaxing
Linux account-name validation.

The helper retains `CAP_SETUID`/`CAP_SETGID` through `AmbientCapabilities`
while keeping `NoNewPrivileges=true`. This allows Python subprocesses to drop
to the project uid/gid; the Python child has no effective/ambient capabilities.
Verify this inside the helper's systemd sandbox: an ordinary root SSH process
can succeed even when the helper gets `spawn EPERM`.

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

Projects with managed domains still require a working upstream for edge
activation. After Nginx reload, activation retries an unavailable upstream
every 500 ms for a 30-second window, including when optional health checks
are disabled. A probe already in progress may finish after that window.
Structural Nginx failures fail immediately. Previously this final edge check
ran once, so a Python application still starting could be rolled back within
two seconds even though it only needed a few more seconds to become ready.

An edge timeout records the attempt count, elapsed time, upstream port/path,
and failed checks. Both service-start and domain/edge failures capture the
candidate's own runtime logs before rolling back, then redact known secrets
and apply the same 48 KiB UI limit. A failed candidate never replaces the
previous active release.

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

After a successful release, the project's **Domains** dialog also runs an
Nginx edge check: managed site file, sites-enabled symlink, `nginx -T`
server_name/proxy_pass, loopback Host-header request on port 80, and the
application port. A `Released` status means the process is up; the default
Ubuntu Nginx page means the Host header still hit `default_server`.

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
