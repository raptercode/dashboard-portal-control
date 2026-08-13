# Current architecture context

## Product boundary

Modern Host Manager is a control plane for the owner of a single Linux server who deploys their own applications. It is not a shared-hosting panel, DNS provider, file manager, or multi-tenant platform.

The system assumes the owner chooses trusted repositories. Building or starting source from a repository therefore intentionally runs arbitrary application code, but that application code must not receive root privileges or control-plane secrets.

## Trust boundary

```text
Browser / CLI
  -> Management API (unprivileged service account)
  -> Privileged helper (fixed allowlisted operations)
  -> systemd, apt, owned Nginx files, Docker

Project source/build process
  -> dedicated project Unix user
  -> project working and release directories only

Trusted Docker Compose project
  -> privileged helper validates a bounded Compose configuration
  -> Docker Engine (no privileged/host-network/host-PID/host-bind-mount settings)
```

No layer accepts free-form shell commands from the Browser or API. Privileged work must be converted into typed, validated operations before reaching the helper.

## Configuration ownership

- Database: desired state and audit metadata
- Host Manager Nginx directory: generated state owned by the system
- Other Nginx files: external state, read-only for Host Manager
- Project releases: immutable per deployment as far as practical
- Persistent application data: separate from releases and not deleted by rollback

## Delivery lifecycle

1. Validate project configuration and repository reference
2. Build the Node candidate as the project user in a new release, or copy a Docker Compose candidate and validate its Compose policy
3. Start the Node candidate without affecting the active release; Docker Compose builds and starts during controlled host activation
4. Run a bounded health check
5. On success, switch owned traffic/config; Docker Compose rollback restores the prior release if activation/health fails
6. On failure, keep logs and the previous active release; rollback must be an auditable operation

Port allocation, release layout, health-check contract, and Node.js major details remain follow-on design topics.

## Test environments

Docker on a development machine is used for repeatable, isolated integration tests such as API, database, project build, and Nginx template validation.

Ubuntu 24.04 or 25.04 host acceptance tests are required for paths that depend on a real host: apt/package state, systemd, privileged helper, Nginx reload, file permissions, and reboot persistence. A Docker container is not a sufficient stand-in for a systemd host.

Production deployment uses `dashboard-portal.sh` to install the service directly on Ubuntu 24.04 or 25.04. The application binds only to loopback and host Nginx owns public HTTP/HTTPS. A direct install fails closed unless domain resolution, a Certbot certificate, HTTPS redirect/HSTS, and an HTTPS health check succeed. It never removes unrelated Nginx virtual hosts.

The pinned Node runtime is exposed as `node`, `npm`, `npx`, and `corepack` in
`/usr/local/bin`; the checksum-verified Bun binary is exposed as `bun` there.
Node candidates run `npm ci` when a valid lockfile is available. If it is
absent or incompatible, the isolated candidate falls back to `npm install`
without modifying the synced Git checkout. Bun candidates use `bun install
--frozen-lockfile` with the analogous safe fallback. Each then runs an optional
named build script and a required named start script. Failure metadata
identifies the bounded deployment stage without storing process output or
environment values.

Project activation and domain/TLS sync use a root-owned Unix-socket helper,
not a setuid script or browser-provided command. The helper can create only the
project's service and managed Nginx file, run a bounded health check, and use
Certbot after DNS preflight. It restores the prior project symlink and managed
Nginx file if activation or TLS setup fails.

Docker Compose is optional and is deliberately limited to repositories the
single owner trusts. The helper rejects privileged containers, host networking,
host PID/IPC namespaces, and host bind mounts; it requires the selected service
to publish the configured project port. This is guardrail policy, not a
multi-tenant sandbox: image builds and container processes are still owner
supplied code. See [ADR 0021](../adr/0021-trusted-docker-compose-project-runtime.md).

Notification hooks are stored with their endpoint encrypted in the same vault
as repository credentials. A completed or failed deployment may post a
provider-aware payload (Discord, Google Chat, Slack, or generic HTTPS webhook)
without making deployment success depend on delivery. Public APIs return hook
metadata and last delivery result, never the endpoint.

Dashboard Portal software updates are separate from project deployments. The
web UI only reads and verifies a signed release manifest; it has no endpoint to
apply an update. An owner invokes the root-only `dashboard-portal update`
command through SSH. The command downloads an immutable HTTPS archive, verifies
its Ed25519 manifest signature and SHA-256 digest, then hands the staged release
to the normal installer and its rollback path.

## v0.1 foundation (historical)

This was the feature set at the end of the first phase; it predates native
project activation, domain/TLS sync, and the SQLite store described above,
which are now implemented on top of it. For the current, maintained feature
status see [scope-and-roadmap.md](scope-and-roadmap.md).

- Dashboard single-owner login with HttpOnly, SameSite cookies and login rate limiting
- CSRF tokens for every write request
- `doctor` report, tool inventory, and persistent audit log
- UI installer that requires confirmation, allowlists tools, and talks to the helper without shell strings
- Docker compose sandbox on Ubuntu 24.04 publishing port 80 for `demo.test`
- Native project contract that creates a project user, release paths, systemd hardening, and environment file, accepting only npm script names
- Git onboarding: author identity, HTTPS credential identifier or SSH deploy-key identifier, project sync configuration, and audit events
- Encrypted credential vault for HTTPS tokens and encrypted per-project `.env`; API returns only metadata/key names
