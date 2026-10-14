# Product scope, architecture reference, and roadmap

[ภาษาไทย](../../../th/knowledge/context/scope-and-roadmap.md)


This document is the design/spec reference moved out of the root `docs/en/README.md`
so that file can stay focused on installing and using Dashboard Portal. It
records the current 1.0.0 candidate source capabilities and release
boundary, and the longer-term backlog. Implementation does not certify a
production host. See the [prioritized v1 readiness plan](../plans/v1-readiness-plan.md)
for release gates and work order, and the [acceptance record](../plans/v1-acceptance-record.md)
for current evidence. The candidate combines v0.8.9 fixes with the v1 preparation work.
Operational Mail is deferred from the 1.0.0 readiness claim. Installer recovery
and shared host-operation leases are documented in
[ADR 0031](../adr/0031-maintenance-exclusion-and-install-recovery.md); legacy
upgrades still require confirmed quiescence and real host acceptance.

Status labels used below:

- **Implemented** — present in source through the applicable UI/API/CLI path; local tests and real-host acceptance are separate evidence.
- **Partial** — some of the described capability exists; the rest is listed explicitly.
- **Planned** — described for context; not present in the code yet.

## Main goals

- Personal use on a single server as the primary case
- Support multiple apps and domains from one Dashboard
- Keep resource use low with Native mode as the default
- Use Docker only for projects that need isolation or different runtime versions
- Connect GitHub and GitLab to deploy from repositories
- Detect and install required tools through the UI or CLI
- Let Linux-fluent users edit config and manage the system when needed

## Target environment

```text
Ubuntu Server 24.04 LTS amd64
Ubuntu Server 25.04 amd64 (operational exception; see ADR 0012)
```

Early testing focuses on this environment to reduce complexity. Other
distributions or Ubuntu versions are not guaranteed. See
[ADR 0001](../adr/0001-ubuntu-24-04-is-the-supported-host.md) and
[ADR 0012](../adr/0012-ubuntu-25-04-is-an-operationally-supported-host.md).

## Deploy model

**Native-first, Docker-optional.**

**Native Mode (Implemented)** — apps run directly on the host under `systemd`.
Each project gets its own service account, release directory, environment
file, and systemd unit created by the root-owned helper
(`scripts/hostmgr-deploy-helper.mjs`).

**Docker Compose Mode (Implemented, v0.5; discovery added in v0.6)** — trusted repositories choose a
repository-relative Compose YAML file and web service. The root helper performs
policy validation, controlled build/start, host health check, rollback, and
container-log access. It rejects privileged containers, host namespaces, and
host bind mounts; this is a guardrail, not a hostile-code sandbox (ADR 0021).

| Topic | Native | Docker |
| --- | --- | --- |
| RAM / disk | Lower | Slightly higher |
| Getting started | Easy for Linux-fluent users | Needs Dockerfile/Compose |
| Dependency isolation | Process/user level | Container level |
| Multiple runtime versions | Node 20/22/24/26 selection per project; required host runtime must already be provisioned | Supported via images |
| Best for | Typical personal apps | Special apps or complex dependencies |
| Current status | **Implemented** | **Implemented (trusted Docker Compose, v0.5; repository suggestion, v0.6)** |

## Current capabilities and follow-on backlog

The Planned and Partial items below are backlog, not automatic 1.0.0 release
requirements. The readiness plan distinguishes mandatory validation from
recommended operations features and deferred work.

### Dashboard

- View host name, platform, Node major, and uptime — **Implemented**
- View total memory — **Implemented**
- View CPU load average and disk usage — **Implemented** (live snapshot + 5-minute history retained 30 days; UI ranges 1/3/7/15/30)
- Owner email/password bootstrap and login — **Implemented**
- Master/User accounts, organizations, invitations and per-organization grants — **Implemented** (organizations are access scopes, not hostile-tenant isolation)
- Optional database client connectors (MongoDB/PostgreSQL/MySQL/Redis) — **Implemented** (metadata + encrypted secret + TCP probe; not host DB packages)
- View Nginx, Certbot, Git, Docker, and runtime status — **Implemented** (`doctorReport`, live-probed in host mode)
- View projects, domains, and recent deployments — **Implemented**
- Warn when a required tool is missing — **Implemented** (readiness checklist on the overview page)

### Project management

- Create Native projects: repository, branch, directory, build/start command, port — **Implemented**; a shallow metadata scan suggests Node or Bun without executing project code
- Domainless Web/API and portless long-running Node/Bun/Go/Python-script Workers — **Implemented in 1.0.0**; Workers build without launching candidate consumers and check process stability after activation. See the [internal services guide](../../how-to/internal-services-and-workers.md).
- Docker Compose projects — **Implemented (v0.5)** for trusted repositories: selected Compose file/service, policy preflight, guarded host activation, rollback, and container logs. v0.6 can suggest this selection from a Compose manifest
- Manage environment variables through file uploads, full `.env` editing or individual rows — **Implemented** (all values visible to the authenticated owner, encrypted at rest; ADR 0026)
- Deploy and rollback — **Implemented**, including a durable job queue that survives a Dashboard restart
- Deployment progress on project cards — **Implemented (v0.8.4)**, automatically refreshing phases and results without opening a log dialog; logs remain available on request
- Native Bun, Go, Python and PHP runtimes — **Implemented**, with runtime-specific build/start contracts and prerequisites
- Native Node major selection and release-specific rollback — **Implemented (v0.8.3)**; Portal updates preserve their selected Node major in v0.8.5
- Stop/restart as a standalone action (outside of deploy/rollback) — **Planned**
- Health check after deploy — **Implemented** (candidate check + host check, optional per project)
- View build/candidate logs — **Implemented** (per-release event log in the Logs dialog)
- View live runtime/systemd logs from the UI — **Implemented** (`/projects/:slug/logs`, auto-refreshing; reads the project's systemd unit through the root-owned helper, see [ADR 0019](../adr/0019-runtime-project-logs-are-read-through-the-root-owned-helper.md))

### GitHub / GitLab

- Clone over HTTPS with a stored token credential — **Implemented**
- Clone over SSH deploy keys — **Planned**; SSH projects are intentionally blocked (`needs_ssh_key`) until key generation, registration, rotation, and revocation exist
- Choose the deploy branch (fetched from the remote) — **Implemented**
- Manual deploy from the Dashboard — **Implemented**
- GitHub push webhook-triggered auto deploy — **Implemented** (signed delivery, exact repository and branch, polling fallback)
- GitLab inbound auto deploy — **Planned**
- Store credentials encrypted, never returned or logged — **Implemented**
- Organization-scoped credentials and credential grants — **Implemented (v0.8.2)**

### Domain management

- Add/remove domains bound to a project (up to 10; removing the final domain removes only Portal-managed Nginx/TLS) — **Implemented**
- DNS check (A/AAAA against this host) before and after saving — **Implemented**
- Generate and validate Nginx config before use — **Implemented** (`nginx -t` before every reload)
- Preview a diff before applying a Nginx change — **Planned** (the helper snapshots/restores internally, but nothing is shown to the owner before sync)
- Detect config drift between system state and managed files — **Partial**: `checkDrift()` exists in `src/nginx.mjs` as a primitive; there is no scheduled check or dashboard alert wired to it yet
- Sync from Dashboard to Nginx — **Implemented**
- Import existing external Nginx config back into the Dashboard — **Planned**

### SSL

- Request Let's Encrypt certificates through Certbot — **Implemented**
- Enable HTTPS automatically after issuance — **Implemented**
- View expiry dates and renewal status in the UI — **Planned**
- Trigger/test renewal from the Dashboard or a CLI — **Planned** (renewal today depends on Certbot's own system timer, outside the app)
- Refuse to issue a certificate until DNS resolves — **Implemented** (`getent ahosts` check before calling Certbot)

### Nginx

- Generate reverse-proxy config from templates — **Implemented**
- Preview diffs before apply — **Planned**
- Always validate with `nginx -t` — **Implemented**
- Back up existing config before changes — **Implemented**
- Automatically restore previous config on validation/reload failure — **Implemented**
- Advanced Mode for custom directives — **Planned**

### Logs and terminal

- Per-release deployment/build logs in the UI — **Implemented**
- systemd journal logs per Native project and Compose logs per Docker project, from the UI — **Implemented** (see `/projects/:slug/logs` above)
- Search/filter logs by time range — **Planned** (Activity page is an unfiltered table today; the runtime log viewer shows a fixed recent-lines window)
- In-browser terminal escape hatch — **Planned**; no such feature exists in the code yet, so there is nothing to gate behind an owner opt-in

## System tools and dependency installer

The **Settings → System Tools** UI flow described below is **Implemented**:
scan tools, show what an install will do, require explicit confirmation,
install through the allowlisted helper (simulated in `demo` mode, real `apt`
install in `host` mode), and refresh status after.

| Tool | Necessity | Role |
| --- | --- | --- |
| Nginx | Required | Reverse proxy and receives domain traffic |
| Certbot | Required for SSL | Issue and renew Let's Encrypt certificates |
| Git | Required for Git deploy | Clone and pull source code |
| systemd | Required for Native mode | Control application processes |
| Docker Engine + Compose | Optional | Run Docker mode |
| Node.js / PHP | Optional | Install only runtimes Native projects need |

The CLI shown below is a **planned interface only** — there is no `hostmgr`
binary in this repository today. The only real command-line entry points are
`dashboard-portal.sh` (installer) and the `dashboard-portal` command it
provisions on the host (`update`, `configure-update`, `--reset-pwd`, help and version reporting). Treat
the block below as a design placeholder, not a usable command:

```bash
# Planned, not implemented yet
hostmgr doctor
sudo hostmgr tools install --required
sudo hostmgr tools install nginx certbot git
sudo hostmgr tools install docker
sudo hostmgr tools install nginx --force
hostmgr tools check
```

## Deployment flow

```mermaid
flowchart TD
    A[GitHub or GitLab] --> B[Clone or Pull]
    B --> C{Deployment mode}
    C -->|Native — implemented| D[Install and Build]
    C -->|Docker Compose — trusted| E[Validate and activate Compose]
    D --> F[Start candidate]
    E --> F
    F --> G{Health check}
    G -->|pass| H[Apply Nginx and SSL]
    G -->|fail| I[Keep previous release and show logs]
```

Deploy does not cut over from the running release until the new release's
build and health check pass. If deploy fails, the previous release remains
active and the detected cause is shown in the release log
(see [deployment-diagnostics-and-health-checks.md](deployment-diagnostics-and-health-checks.md)).

## Proposed architecture

```text
Web Dashboard / CLI
        │
        ▼
Management API
        │
        ├── Project Service
        ├── Deployment Service
        ├── Domain & SSL Service
        ├── Tool Installer
        └── Audit Log
                │
                ▼
        Privileged Helper
                │
        ┌───────┴────────┐
        ▼                ▼
 Native/systemd     Docker/Compose
        │                │
        └───────┬────────┘
                ▼
           Host Nginx
```

Everything above the Privileged Helper is **Implemented** and matches
`src/server.mjs` / `src/helper-client.mjs`. The Privileged Helper and
Native/systemd and trusted Docker/Compose paths are **Implemented** in
`scripts/hostmgr-deploy-helper.mjs`; Docker guardrails are defined in ADR 0021.
For the authoritative, currently-accurate trust-boundary description, see
[architecture.md](architecture.md); this diagram is kept here only because it
reads well next to the roadmap below.

## Core data model

### Server
- hostname and OS information
- IP addresses
- tool/service status
- resource metrics

### Project
- name and slug
- deployment mode: `native` or `docker` (trusted Docker Compose)
- runtime and runtime-specific settings, including a Node major per release
- organization and grants controlling access to project operations
- repository and branch
- build/start configuration
- internal port and health-check path
- environment variables
- release history

### Domain
- hostname
- project and target port
- SSL status
- Nginx config state
- DNS validation state

### Deployment
- commit SHA
- status and timestamps
- build/runtime logs
- health-check result
- active/rollback release

## Security principles

These are design tenets; for the enforced trust boundary see
[architecture.md](architecture.md), and for the decisions behind each
boundary see [Architecture Decision Records](../adr/README.md).

- Dashboard/API runs as a non-root Linux user
- Separate privileged helper with an operation allowlist
- Validate domain, path, port, repository URL, and config every time
- Persist repository tokens, project environment and mail secrets encrypted; runtime environment files are decrypted only where required and protected by permissions
- Repository credential values are not returned to browsers; project environment plaintext is available only with explicit environment-read grants (ADR 0026/0027)
- Redact secrets from logs and error responses
- Use CSRF protection, secure cookies, rate limiting, and session timeout
- Record audit logs for install, deploy, config changes, and privileged actions
- Back up files before edits and use atomic writes when possible
- Terminal and custom Nginx config are high-risk features and must be enabled by the machine owner (not yet applicable: neither feature exists yet)
- The UI installer must show what will change before asking for permission and must not run free-form commands

## Non-goals for v1

- DNS server
- FTP server
- Shared hosting and multi-tenant isolation
- Reseller, license, and billing
- General-purpose runtime version management (Node project selection is implemented; automatic provisioning of every project major and multi-version PHP management are not)
- Kubernetes or multi-server clusters
- Full file manager
- Automatic DNS provider or registrar management
- Supporting every Linux distribution

These limits keep v1 focused on one administrator-controlled host and trusted
repositories, with organization-scoped collaboration. Organizations do not
provide process isolation between mutually untrusted tenants. Node/Bun builds
and candidate processes still run in the Portal service execution context;
activated Native services use dedicated project Unix users.

## Mail service (implemented with port-aware host provisioning)

Self-hosted mail moved out of the non-goals by owner decision (2026-08). The
step-by-step Mail Setup Wizard (design: `docs/th/knowledge/design/mail-setup-wizard.md`)
checks outbound SMTP 25/587/2525 and the host's inbound UFW policy for
25/587/993 before it configures Postfix, Dovecot, OpenDKIM, virtual mailboxes,
and TLS through the root-owned helper. The helper does not change firewall
rules and leaves blocked or unknown inbound ports without public listeners.
The v0.6 code path covers DNS gates, encrypted relay state, DKIM, virtual
mailboxes, and real outbound SMTP checks. It requires host acceptance before
being treated as an operational mail server. Provider-edge inbound
reachability is still not inferable from the host: verify it with a real
external delivery.

## Roadmap

### v0.1 — Server Foundation — done

Login for a single machine owner, dashboard and system metrics, tool
detection, installer for Nginx/Certbot/Git via UI, audit log.

### v0.2 — Native Projects — mostly done

Git clone/pull, native build (`npm ci` + optional build script) and systemd
service, environment variables, build/candidate logs and health check, manual
deploy and rollback with a durable job queue. Remaining gaps: SSH deploy keys,
and moving repository clone/build out of the dashboard service account into
the privileged helper's isolation boundary.

### v0.3 — Domains & SSL — mostly done

Domain inventory, Nginx template rendering with mandatory `nginx -t`
validation and automatic rollback on failure, Certbot issue on activation.
Remaining gaps: no diff preview before apply, no UI-facing drift detection or
alerting, no certificate expiry/renewal view.

### v0.4 — Admin UI rewrite, runtime logs, and database connectors — done

Server-rendered multi-page admin UI replacing the original single-page shell
(see [ui-rewrite-layout.md](ui-rewrite-layout.md)), owner password management,
database client connectors (MongoDB/PostgreSQL/MySQL/Redis), and the
per-project runtime log viewer ([ADR 0019](../adr/0019-runtime-project-logs-are-read-through-the-root-owned-helper.md)).

### v0.5 — Operations UX + Docker Compose — done

Animated deployment phases and busy controls, complete management deletion,
Monitor Logs Tokens, encrypted provider-aware deployment notifications, domain
status/recheck guidance, and trusted Docker Compose projects. Docker activation
is host-validated and supports rollback; it is not a general container-security
boundary (see ADR 0021).

### v0.6 — Runtime discovery and guarded mail — implemented

Project onboarding inspects a shallow, non-executing repository checkout and
suggests Docker Compose, Bun, or Node from its metadata; the owner can always
override the icon-based dropdown. Mail host provisioning is port-aware and
fails closed as described above. Signed GitHub push-triggered auto-deploy is implemented;
GitLab inbound auto-deploy,
per-project backup/restore, certificate-expiry alerting, and notification
retry queues remain planned follow-on work.

## v1 readiness criteria

These are acceptance gates, not a record of completed host testing. The
[readiness plan](../plans/v1-readiness-plan.md) defines priority and completion
evidence. Local passing tests alone do not close these gates.

- Install on a clean Ubuntu target from the CLI without hand-editing files
- If Nginx, Certbot, or Git is missing, the user can install them from the UI
- Add a Native project from Git and serve it over an HTTPS domain
- Add a Docker project and share the same Nginx as Native projects
- Bad config does not take down the whole machine's Nginx
- A deploy that fails build or health check does not destroy the previous release
- After reboot, Dashboard, Nginx, and enabled apps come back up
- Repository credentials, session/password material and encryption keys do not appear in UI/API responses, process arguments or logs; project environment reads require explicit grants and deployment output is redacted
- Existing installations update without losing state, memberships, encrypted secrets or the configured Portal Node major
- A consistent backup of state and the original encryption key restores successfully on staging
- Browser and API checks enforce organization grants, including revocation and cross-organization denial
- If Mail is included in the operational release claim, real external inbound/outbound delivery, TLS and mailbox recovery are verified separately
