# Install Dashboard Portal on Ubuntu

Localized topic guide; the original detailed record is available in [Thai](../../th/how-to/production-install.md).


## Prepare the server

The current installer accepts Ubuntu 24.04 or 25.04, amd64. Use root or a sudo-capable account, a domain resolving to this host, inbound TCP 80/443 and free loopback port 3100. Check DNS from the host with `getent ahosts portal.example.com`. For a CDN, use DNS-only during initial certificate issuance, then verify origin HTTPS before enabling proxying. Back up existing Nginx and services and start with a staging host.

## Install

After installation, `dashboard-portal -h` or `--help` lists all CLI commands. Use `dashboard-portal -v` or `--versions` for installed Portal and runtime versions. These informational commands do not require sudo. `dashboard-portal update --help` also shows the command reference; update, configuration changes and password reset still require sudo.

```bash
curl -fsSL https://dashboard-portal.cloud/install.sh | bash
```

### Select a version

Without `--version`, the command selects GitHub's latest published stable release. To pin a release, use this single-line command:

```bash
curl -fsSL https://dashboard-portal.cloud/install.sh | bash -s -- --version v0.8.3
```

`bash -s` reads the script from the pipe; `--` separates arguments passed to the installer. Use the published tag format `v<major>.<minor>.<patch>`, such as `v0.8.3`, including the `v` prefix. The release must have its archive and checksum published. Missing releases/download failures stop installation rather than falling back to latest. Check available versions in [GitHub Releases](https://github.com/raptercode/dashboard-portal-control/releases).

### Required inputs and email

Use an interactive SSH terminal as root or a sudo-capable user. You do not need to put domain/email in the command line; the installer prompts for them:

| Input | Required? | What to enter |
| --- | --- | --- |
| Portal domain | Yes | A lowercase fully qualified domain such as `portal.example.com`, with A/AAAA pointing to this server and DNS resolving on the host |
| TLS email | Yes | A reachable email such as `admin@example.com` for Let's Encrypt/Certbot certificate management; not SMTP credentials |
| sudo password | When needed | The SSH account's password for privilege elevation; root does not need sudo |
| Initial Portal password | First installation | At least 12 characters, entered privately in the terminal rather than command arguments |

TLS email cannot be blank. It is separate from the login email configured during first-account setup in the browser. You do not need to install a mail server to supply it. Prompts read `/dev/tty`, including sudo and initial password setup, so the curl pipe works. The standard command uses Node 24.

The bootstrap downloads the release archive and its SHA-256 file over HTTPS, verifies the requested archive, extracts it into a private temporary directory and invokes the host installer. Failed downloads/checksums stop installation. Initial bootstrap trusts the HTTPS/GitHub release source; subsequent signed updates also verify Ed25519.

The installer provisions the selected pinned Portal Node runtime, Bun, Git, Nginx and Certbot. It does not install unused Node majors or remove existing project runtimes; prepare additional project runtimes separately and check Setup/Doctor before deployment. It runs the Portal at `127.0.0.1:3100`, requires TLS, enables HTTPS redirects/HSTS and verifies HTTPS health. Choose an initial password of at least 12 characters and finish account bootstrap in the browser.

## Managed files and services

| Path/service | Purpose |
| --- | --- |
| `/opt/dashboard-portal` | Root-owned Portal source |
| `/opt/node-v<version>` | Checksum-verified Node runtimes |
| `/etc/dashboard-portal/dashboard-portal.env` | Configuration and encryption key; root:dashboardportal, 0640 |
| `/var/lib/dashboard-portal` | SQLite state and source workspaces |
| `/srv/hostmgr/projects` | Activated project releases |
| `/etc/hostmgr/projects` | Project service configuration/environment |
| `/var/backups/dashboard-portal` | Installer snapshots |
| `dashboard-portal` | Unprivileged Portal service |
| `hostmgr-deploy-helper` | Root-owned helper with allowlisted operations |

Only managed Nginx files are modified. The original Ubuntu default-site symlink can be replaced with a reject catch-all; unrelated virtual hosts remain externally owned.

## Verify installation and updates

```bash
sudo systemctl is-active dashboard-portal hostmgr-deploy-helper nginx
sudo nginx -t
curl -fsS https://portal.example.com/api/health
curl -fsSI https://portal.example.com/
```

Check API, page and static assets, then login and exercise projects, environments, deployment, health and rollback. Test reboot persistence in an approved downtime window. Local/container tests do not certify systemd, TLS or host permissions. Project domains also need valid DNS and HTTP-01 reachability.

## Backup and restore

Back up `/etc/dashboard-portal/dashboard-portal.env` and `/var/lib/dashboard-portal` together, encrypted with restricted access. Keep the original `HOSTMGR_SECRET_KEY`; replacing it makes saved credentials/environments unreadable. Use a consistent SQLite backup or stop writers during snapshots; copying only the database while WAL changes is insufficient.

Also back up application data under `/srv/hostmgr/projects`, `/etc/hostmgr/projects`, Docker volumes and external databases according to each application, plus Nginx and `/etc/letsencrypt` for host recovery. Installer snapshots cover managed files and small control-plane state, not full project workspaces, dependencies/caches, package removal or certificate reversal. Restore on staging and verify ownership, login, data and secret decryption before relying on a backup.

## Update over SSH

```bash
sudo dashboard-portal update --check
sudo dashboard-portal update
sudo dashboard-portal update --check
```

The updater verifies Ed25519 and SHA-256 and preserves the configured Portal Node major. The UI reports available versions; it cannot apply Portal updates. Both SQLite drivers retain the existing schema/file; no data conversion is required. Repeat health/static/project checks after updating.

The default stable feed is [GitHub stable.json](https://github.com/raptercode/dashboard-portal-control/releases/latest/download/stable.json). A custom feed uses `sudo dashboard-portal configure-update --manifest=https://releases.example.com/dashboard-portal/stable.json --public-key=/secure/download/dashboard-portal-update-public.pem`. Never replace a verification key just to bypass a signature error. For pre-v0.7.0 installations, independently validate the replacement key/fingerprint from a trusted release before installing it.

## Troubleshoot

Inspect `journalctl -u dashboard-portal -u hostmgr-deploy-helper -n 100 --no-pager`, `sudo nginx -t`, host DNS and certificate issuance. HTTP 301 redirecting to healthy HTTPS is expected. An API success does not prove static files or login work. Reset a lost password with `sudo dashboard-portal reset-password`; it prompts privately and revokes old sessions. Keep port 3100 private and redact secrets in shared logs.

Maintainers: [release guide](releasing-and-ai-handoff.md), [bootstrap hosting](bootstrap-hosting.md), [Node versions](node-versions.md).
