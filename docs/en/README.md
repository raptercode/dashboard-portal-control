# Dashboard Portal

[ภาษาไทย](../th/README.md) · [Documentation index](README-index.md)

A dashboard for managing applications on your own Linux server. Connect Git repositories, deploy applications, inspect logs, configure domains and TLS, and manage member access by organization.

[Latest release](https://github.com/raptercode/dashboard-portal-control/releases/latest) · [Ubuntu installation](../th/how-to/production-install.md) · [Node.js versions](../th/how-to/node-versions.md) · [Changelog](CHANGELOG.md)

## Features

- Deploy trusted repositories with **Node.js, Bun, Go, Python, PHP, or Docker Compose**.
- Choose Node.js **20, 22, 24, or 26** for each Node application and select a separate version for the Portal.
- Sync source, configure environment variables, build, check health, activate releases, and roll back.
- Manage domains, Nginx, and Let's Encrypt through a helper with restricted operations.
- View host status, logs, and audit history; configure automatic deployments and notification hooks.
- Manage Master/User accounts, organizations, invitations, and member permissions.
- Store repository credentials and application environment values encrypted, and receive signed Portal updates.

**Scope:** Dashboard Portal manages one host and assumes administrators choose trusted source repositories. Building and starting an application executes its repository code. Organization permissions control access inside the Portal; they do not provide separate host security boundaries.

## Try it locally

Install Git and a Node.js version supported by [package.json](../../package.json). Node 24 is the recommended starting point.

```bash
git clone https://github.com/raptercode/dashboard-portal-control.git
cd dashboard-portal-control
cp .env.example .env
```

On PowerShell, use `Copy-Item .env.example .env`. Then edit these values in `.env`:

- `HOSTMGR_ADMIN_PASSWORD`: a unique password for the local demo.
- `HOSTMGR_SECRET_KEY`: a Base64-encoded, 32-byte key. Generate one with the command below and keep it when you have saved data.

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
npm ci
npm run demo
```

Open **http://localhost:3000** and complete the first-account setup. The example configuration permits HTTP for a local demo and disables secure cookies. Do not expose that configuration as a public login.

On Node 20, the Portal needs the native `better-sqlite3` dependency. If a matching prebuilt binary is unavailable, installation needs C/C++ build tools and Python. Node 22.13+ uses the built-in `node:sqlite` driver. See the [Node.js version and nvm guide](../th/how-to/node-versions.md).

### Try Docker Compose

After preparing `.env`:

```bash
docker compose up --build
```

Open **http://localhost**. Compose stores state in a named volume. The image contains the Node version selected at build time (Node 24 by default), not every supported application runtime. Cloning or building a repository can execute its code. Host activation, systemd, and TLS require testing on an Ubuntu host.

## Install on Ubuntu

The installer supports **Ubuntu 24.04 or 25.04 on amd64**. The host needs a domain that resolves to it and inbound TCP ports 80 and 443 for HTTPS.

Install the latest stable release with one command:

```bash
curl -fsSL https://dashboard-portal.cloud/install.sh | bash
```

To pin a published release, use `curl -fsSL https://dashboard-portal.cloud/install.sh | bash -s -- --version v0.8.3` with its `v`-prefixed tag. A reachable TLS email is required for Let's Encrypt/Certbot, but enter it when prompted rather than in the command line. It is separate from the login email. See [version selection and required inputs](how-to/production-install.md).


Run on the server in an interactive SSH terminal as root or a sudo-capable user. The bootstrap asks for the Portal domain and TLS email, uses Node 24 by default, downloads the release, verifies SHA-256 and invokes the host installer. See the [installation guide](../th/how-to/production-install.md) for preparation, backup and recovery.

The installer provisions Nginx, Certbot, Git, Bun, and checksum-verified Node runtimes for all four supported majors. It serves the Portal at `127.0.0.1:3100` behind Nginx and HTTPS. The bootstrap uses Node 24 for the Portal by default; each Node application can select its own version.

Check the availability of additional tools such as Go, Python, PHP, and Docker in **Setup/Doctor** before deploying applications. See the runtime guides in the [documentation table](#documentation).

## Deploy your first application

1. Create organizations and members as needed. Add a repository credential for a private repository.
2. Create a Project with its repository URL and branch. Choose its runtime and, for Node.js, its Node major.
3. Configure the build and start script names, working directory, and health check for the application, then sync its source.
4. Set values in **Environment** and add a domain whose DNS record points to the host.
5. Create a release, review its build and health checks, activate it, and check HTTPS and logs.

Node projects use `npm ci` when a usable lockfile is available. Otherwise, the candidate falls back to `npm install` without changing the synced checkout. The application must listen on the port supplied by the Portal and respond at its configured health endpoint.

Environment values are encrypted in the database. Members with `env.read` can view their values; `env.write` allows edits. Changes to the environment or Node major take effect in a new deployment. Each release records its Node major so rollback uses the matching runtime.

Related guides: [access control](how-to/access-control.md), [automatic deployment](how-to/project-auto-deploy.md), [Go projects](how-to/go-projects.md), [Python projects](how-to/python-projects.md), and [deployment diagnostics](knowledge/context/deployment-diagnostics-and-health-checks.md).

## Update the Portal

The UI can report available updates. An administrator applies them over SSH on the host:

```bash
sudo dashboard-portal update --check
sudo dashboard-portal update
sudo systemctl is-active dashboard-portal hostmgr-deploy-helper nginx
curl -fsS https://portal.example.com/api/health
curl -fsSI https://portal.example.com/
```

The updater checks the Ed25519 signature and SHA-256 checksum before installing, and preserves the Portal's selected Node major. Both SQLite drivers use the existing database file and schema; enabling Node 20 does not require a data conversion. Back up the **state and its encryption key together** before updating. See [backup and recovery](../th/how-to/production-install.md).

## Develop and test

```bash
npm ci
npm test
node scripts/test-modules.mjs --list
bash -n install.sh dashboard-portal.sh
```

On Windows, use Git Bash for the shell-script syntax check. Local unit and API tests do not verify apt, systemd, Nginx, TLS, or Ubuntu file permissions. See the [testing guide](../th/how-to/testing.md).

## Documentation

| Topic | Guide |
| --- | --- |
| Installation, updates, backup, and troubleshooting | [Production installation](../th/how-to/production-install.md) |
| Portal and application Node versions; nvm | [Node.js versions](../th/how-to/node-versions.md) |
| Members, organizations, and permissions | [Access control](how-to/access-control.md) |
| Current system boundaries | [Architecture](knowledge/context/architecture.md) |
| Feature scope and roadmap | [Scope and roadmap](knowledge/context/scope-and-roadmap.md) |
| Design decisions | [Architecture Decision Records](knowledge/adr/README.md) |
| Shared terminology | [Glossary](knowledge/glossary.md) |
| Tests and signed releases | [Testing](../th/how-to/testing.md) · [Release guide](how-to/releasing-and-ai-handoff.md) |

## License

The project code is available under the **[MIT License](../../LICENSE)**. Dependencies and [runtime logos](../../public/ui/runtime-logos/SOURCES.md) remain subject to their respective owners' licenses and rights.
