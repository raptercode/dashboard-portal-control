# Dashboard Portal

A constrained control plane for one self-managed Linux host: connect Git,
deploy Node apps, bind domains, issue TLS certificates, and manage Nginx —
from one dashboard.

> Production install is deliberately TLS-only and targets Ubuntu 24.04/25.04.
> The Portal's own Docker Compose file is a local evaluation sandbox. Project
> Docker Compose deployment is a separate, guarded runtime for trusted
> repositories; real-host acceptance remains required — see
> [ADR 0021](docs/adr/0021-trusted-docker-compose-project-runtime.md).

This file covers installing and using Dashboard Portal. For feature scope,
architecture, and roadmap, see the [documentation map](#documentation-map) at
the bottom.

## Requirements

- **Try it locally:** Docker + Docker Compose, or Node.js 24.x if you'd rather run it directly (no other dependency — the app only uses Node.js built-ins, so there is no `npm install` step)
- **Install for real:** an Ubuntu Server 24.04 or 25.04 amd64 host, inbound TCP 80/443 open, and a DNS A/AAAA record for the domain you'll use

## Try it locally with Docker

This builds and runs a real copy of the app in a container. It does not
touch your machine's Nginx, systemd, or packages.

1. From the repository root, create your local env file:

   ```bash
   cp .env.example .env
   openssl rand -base64 32
   ```

   Edit `.env`: set `HOSTMGR_ADMIN_PASSWORD` to a password of at least 12
   characters, and set `HOSTMGR_SECRET_KEY` to the output of the command
   above. Never commit `.env`. Do not change `HOSTMGR_SECRET_KEY` again once
   you've saved a credential or a project's `.env` — existing encrypted
   values become unreadable.

2. Start the sandbox:

   ```bash
   docker compose up --build -d
   ```

3. Open <http://localhost> and log in with the password you set.

### Walk through the real flow

The sandbox clones and builds actual repositories inside its own container,
so you can exercise the same pipeline production uses:

1. **Setup** (`/setup`) — install Nginx/Certbot/Git/Docker (simulated here —
   nothing on your machine changes) and set the Git identity used for
   commits.
2. **Projects** (`/projects`) — create a project against a public Node
   repository with `package.json`, pick a branch, and sync. This clones the
   repository inside the container. The Portal automatically reserves an
   available internal port for each new project.
   (Optional: add a token under **Credentials** first if you want to try a
   private repository — tokens are encrypted and never sent back to the
   browser.)
3. Open the project's **Deploy** dialog. Add at least one `.env` line, or
   leave it blank — `NODE_ENV=production` is saved automatically — then
   create a release. Node projects use `npm ci` for a valid lockfile and Bun
   projects use `bun install --frozen-lockfile`; either falls back to an
   isolated unlocked install only when the lockfile is absent or stale. Choose
   **Skip Build** for a runtime-only app, then the Portal starts and
   health-checks the candidate.
   After successful native deployments, dependency trees from releases older
   than the active and immediate rollback releases are removed to limit disk
   usage.
4. The sandbox has no privileged host helper, so a healthy candidate stops at
   "awaiting host activation" instead of actually taking over a systemd
   service and Nginx — that last step only happens on a real installed host
   (see below). Everything before it — clone, build, health check, and
   rollback-safe failure handling — is exactly what production runs.
5. **Activity** (`/activity`) shows the audit trail of everything above.

### Run it directly with Node instead

No Docker, no build step, no `npm install`:

```bash
cp .env.example .env
# edit .env: HOSTMGR_ADMIN_PASSWORD (12+ chars) and HOSTMGR_SECRET_KEY (openssl rand -base64 32)
npm run demo
```

Open <http://localhost:3000>. With the `.env.example` defaults
(`HOSTMGR_SANDBOX_CLONE=false`), project sync and deploy are simulated —
useful for clicking through the UI with no real Git/npm activity. Set
`HOSTMGR_SANDBOX_CLONE=true` (or remove the line) to exercise the real
clone/build/health-check pipeline directly on your machine instead of inside
a container.

## Install for real (Ubuntu 24.04 / 25.04)

Dashboard Portal is released on GitHub — signed archive, checksum, and a
manifest, published at
[github.com/raptercode/dashboard-portal-control/releases](https://github.com/raptercode/dashboard-portal-control/releases).
This block downloads the latest release, verifies it, and installs it. Use a
disposable Ubuntu VM for your first run. Before running it, confirm your
domain already resolves to the target host (`getent ahosts
portal.example.com`) and that inbound 80/443 are open — Certbot's HTTP-01
challenge needs them. Edit only the `--domain=` / `--email=` values on the
last line:

```bash
REPO=raptercode/dashboard-portal-control
TAG=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | grep -m1 '"tag_name"' | cut -d '"' -f4)
VERSION=${TAG#v}
curl -fsSLO "https://github.com/${REPO}/releases/download/${TAG}/dashboard-portal-${VERSION}.tar.gz"
curl -fsSLO "https://github.com/${REPO}/releases/download/${TAG}/dashboard-portal-${VERSION}.tar.gz.sha256"
sha256sum --check "dashboard-portal-${VERSION}.tar.gz.sha256"
mkdir "dashboard-portal-${VERSION}" && tar -C "dashboard-portal-${VERSION}" --extract --gzip --file "dashboard-portal-${VERSION}.tar.gz"
cd "dashboard-portal-${VERSION}"
sudo ./dashboard-portal.sh --domain=portal.example.com --email=admin@example.com
```

This installs Nginx/Certbot/Git, pins Node.js 24.18.0 and Bun 1.3.13 after
verifying their checksums, runs Dashboard Portal on `127.0.0.1:3100` behind host Nginx,
requests a Let's Encrypt certificate, forces HTTPS with HSTS, and verifies
`/api/health` over HTTPS. It prompts once for the owner password and fails
closed — rather than reporting success — if DNS or the certificate isn't
ready.

The full pre-install checklist, acceptance steps, password reset, and update
instructions are in [docs/production-install.md](docs/production-install.md)
— read it before running this on a host you care about.

## Development

```bash
npm start          # or: npm run demo — both run src/server.mjs with --env-file=.env
npm test           # node --test
npm run test:watch
```

There is no dependency install step — the app is built entirely on Node.js
built-ins (`node:http`, `node:sqlite`, `node:crypto`, ...). `npm run
release:keygen` and `npm run release:prepare` build signed release archives;
see [docs/releasing-and-ai-handoff.md](docs/releasing-and-ai-handoff.md).

## Documentation map

This file is intentionally install/usage-only. Scope, architecture, and
operational detail live under `docs/`:

| Doc | Covers |
| --- | --- |
| [docs/context/scope-and-roadmap.md](docs/context/scope-and-roadmap.md) | Full v1 feature scope (with implemented/planned status per feature), roadmap, non-goals |
| [docs/context/architecture.md](docs/context/architecture.md) | Trust boundary, configuration ownership, delivery lifecycle |
| [docs/context/ui-rewrite-layout.md](docs/context/ui-rewrite-layout.md) | Current UI route map, template/renderer layout, and behavior notes |
| [docs/context/owner-auth-and-db-connectors.md](docs/context/owner-auth-and-db-connectors.md) | Owner bootstrap/login and database client connector API surface |
| [docs/production-install.md](docs/production-install.md) | Full production install, acceptance checklist, and operations runbook |
| [docs/context/deployment-diagnostics-and-health-checks.md](docs/context/deployment-diagnostics-and-health-checks.md) | Reading release logs, the runtime log viewer, and diagnosing a failed activation |
| [docs/glossary.md](docs/glossary.md) | Shared terms (release, candidate, drift, deploy key, ...) |
| [docs/adr/](docs/adr/) | Architecture decision records |
| [docs/releasing-and-ai-handoff.md](docs/releasing-and-ai-handoff.md) | How to cut and publish a signed Dashboard Portal release |

## Contributing

Architecture and trust-boundary decisions are recorded in
[docs/adr/](docs/adr/) as they're made; read the relevant ones before
changing behavior they cover. Before opening a pull request, include: a
problem description and proposed approach, how you tested it on the target
environment, the impact on permissions/security, and a migration/rollback
plan if config or data changes.

## License

No license has been chosen yet. Before making the repository public, add an
OSI-approved license such as Apache-2.0 or AGPL-3.0 based on project goals.
