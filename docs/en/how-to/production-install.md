# Install Dashboard Portal on Ubuntu

Localized topic guide; the original detailed record is available in [Thai](../../th/how-to/production-install.md).


## Prepare the server

The current installer accepts Ubuntu 24.04 or 25.04, amd64. Use root or a sudo-capable account, a domain resolving to this host, inbound TCP 80/443 and free loopback port 3100. Check DNS from the host with `getent ahosts portal.example.com`. For a CDN, use DNS-only during initial certificate issuance, then verify origin HTTPS before enabling proxying. Back up existing Nginx and services and start with a staging host.

## Install

After installation, `strckro -h` or `--help` lists all CLI commands. Use `strckro -v` or `--versions` for installed Portal and runtime versions. These informational commands do not require sudo. `dashboard-portal update --help` also shows the command reference; update, configuration changes and password reset still require sudo.

```bash
curl -fsSL https://dashboard-portal.cloud/install.sh | bash
```

### Select a version

Without `--version`, the command selects GitHub's latest published stable release. To pin a release, use this single-line command:

```bash
curl -fsSL https://dashboard-portal.cloud/install.sh | bash -s -- --version v1.1.0
```

`bash -s` reads the script from the pipe; `--` separates arguments passed to the installer. Use the published tag format `v<major>.<minor>.<patch>`, such as `v1.1.0`, including the `v` prefix. The release must have its archive and checksum published. Missing releases/download failures stop installation rather than falling back to latest. Check available versions in [GitHub Releases](https://github.com/raptercode/Strckro/releases).

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
| `/etc/nginx/conf.d/strckro-realip.conf` | Lets Nginx report the visitor's address behind Cloudflare Proxy; rewritten on every install and update |
| `/etc/nginx/conf.d/strckro-limits.conf` | The per-address request-rate zone used by the Portal site; rewritten on every install and update |
| `/etc/nginx/snippets/strckro-proxy.conf` | Root-only (0600) secret that Nginx stamps on proxied requests; the same value is `HOSTMGR_PROXY_TOKEN` in the Portal environment file |
| `dashboard-portal` | Unprivileged Portal service |
| `hostmgr-deploy-helper` | Root-owned helper with allowlisted operations |

Only managed Nginx files are modified. The original Ubuntu default-site symlink can be replaced with a reject catch-all; unrelated virtual hosts remain externally owned.

## Visitor addresses behind Cloudflare Proxy

Nginx adopts the address in `CF-Connecting-IP` only on connections that come from a published Cloudflare range (`set_real_ip_from`, ranges from `scripts/domain-dns.mjs`). A visitor who reaches the origin directly cannot choose the address that Nginx logs and forwards. Behind Cloudflare Proxy the portal login limit, the invitation limit and CLI login requests are therefore counted per visitor, and every project receives the visitor in `X-Real-IP` instead of a Cloudflare address.

Loopback alone does not prove that a request came through Nginx, because any process on the host, including a deployed project, can open `127.0.0.1` and send any `X-Real-IP`. Nginx therefore also stamps each proxied request with `X-Strckro-Proxy-Token`, a random secret that the installer creates once (kept across updates) in `HOSTMGR_PROXY_TOKEN` and in a root-only Nginx snippet that is not part of the world-readable site file. The portal believes `X-Real-IP` only on a loopback connection that presents the matching token. Other local callers, and every request when no valid token is configured, share the single loopback bucket, so a local process cannot reset a limit by spoofing addresses. Rotate the secret by deleting the `HOSTMGR_PROXY_TOKEN` line and running `sudo strckro update`. Without Cloudflare Proxy, Nginx's own peer address is already the visitor and the real-IP file changes nothing. The Cloudflare ranges ship with the release; Cloudflare rarely changes them, and an update refreshes the file. If your Nginx already sets `real_ip_header` or `real_ip_recursive` at `http` level, in `nginx.conf`, `conf.d`, `sites-enabled` or anything they include, Nginx rejects a second copy. The installer lets Nginx decide: when `nginx -t` fails only because such a directive is a duplicate, it removes its own real-IP file, keeps yours, prints a warning that quotes Nginx's message (which names the conflicting file) and tests again; the Portal's limits then count whatever address your configuration reports. A `real_ip_header` inside another site's own `server` block is not a conflict. Any other `nginx -t` failure still stops the update and rolls it back. Behind any proxy or CDN other than Cloudflare, configure `real_ip_header` and `set_real_ip_from` for it yourself, otherwise every visitor arrives from the proxy's address and shares one request budget and one sign-in budget.

## Request limits and sign-in throttling

Nginx gives each visitor a budget of 40 requests per second with a burst of 200 (`strckro-limits.conf` defines the zone, the Portal site applies it). An IPv4 visitor is its address; an IPv6 visitor is its whole /64, because one subscriber can use a fresh address of that range for every request. Beyond it Nginx answers HTTP 429 without waking the Portal. This is far above what a person or the CLI needs; raise it in the two Strckro-managed files only if you have a legitimate reason, because the next update rewrites them.

Inside the Portal, anonymous endpoints are cheap by construction: a request without a credential the Portal recognises is answered without copying or writing its state. Sign-in attempts are counted per visitor (5 in 15 minutes; an IPv6 visitor is its /64) and per account (10 in 15 minutes across all visitors, whether or not the email exists, so guesses spread over many addresses are still bounded). An attempt is counted when it starts and given back if the password is right, so a burst of simultaneous guesses cannot all slip through, and a successful sign-in never resets a visitor's earlier failures. The account limit means a stranger who keeps guessing your email can lock the account for up to 15 minutes, with one exception: a visitor that has signed in to that account since the Portal last started is not refused by the account limit, so you can still get in from where you always sign in (the per-visitor limit still applies, and a restart forgets the exception). A session you already hold and a CLI token keep working. The counters live in memory only, so restarting the Portal clears every one of them at once (`sudo systemctl restart dashboard-portal`; `sudo strckro --reset-pwd` restarts it too), which is the way back in if you are locked out from a new network. This is a deliberate trade-off: a limit on guesses against one account can be used to lock that account, and it is the price of bounding guesses that are spread over many addresses. Because a success gives back only its own attempt, five failures in total from one shared address (an office, a mobile carrier's NAT) lock that address for the window, whoever made them. A wrong email also costs one password hash, so response time does not reveal which accounts exist. Password checks run on the thread pool, two at a time with a short queue (sixteen places are held back for a visitor already known to the account), so a flood of guesses cannot stall the Portal; past the queue a request is refused with 429. Every source address in 127.0.0.0/8 is treated as one local visitor, so a project on the host cannot get a fresh budget by binding another loopback address. Failed sign-ins write at most one audit entry a second, and the next entry says how many more there were. At first-run bootstrap, a wrong installer password is counted per visitor (5) and overall (200) in the same window. Polling a CLI login is limited per visitor.

## Containment of deployed projects

A project is code the Portal did not write, so its systemd unit adds limits beyond running as its own user with `NoNewPrivileges`, `PrivateTmp`, `ProtectHome` and `ProtectSystem=strict`: `MemoryMax=85%` and `TasksMax=4096` keep a runaway or hostile project in its own control group instead of starving the Portal and the other projects, and `ProtectKernelTunables`, `ProtectKernelModules`, `ProtectKernelLogs`, `ProtectControlGroups`, `LockPersonality`, `RestrictSUIDSGID` and `RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6 AF_NETLINK` close kernel interfaces that no application needs. Network isolation is deliberately not added: Nginx reaches the project over loopback, and an application on a cloud host may need its metadata service. A project that legitimately needs more memory or tasks can be given its own values in a systemd drop-in (`sudo systemctl edit hostmgr-project-<slug>`), which survives redeployment, unlike an edit to the unit file itself. Existing projects pick these limits up at their next deployment.

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
sudo strckro update --check
sudo strckro update
sudo strckro update --check
```

The updater verifies Ed25519 and SHA-256 and preserves the configured Portal Node major. The UI reports available versions; it cannot apply Portal updates. Both SQLite drivers retain the existing schema/file; no data conversion is required. Repeat health/static/project checks after updating.

The default stable feed is [GitHub stable.json](https://github.com/raptercode/Strckro/releases/latest/download/stable.json). A custom feed uses `sudo strckro configure-update --manifest=https://releases.example.com/dashboard-portal/stable.json --public-key=/secure/download/dashboard-portal-update-public.pem`. Never replace a verification key just to bypass a signature error. For pre-v0.7.0 installations, independently validate the replacement key/fingerprint from a trusted release before installing it.

## Troubleshoot

Inspect `journalctl -u dashboard-portal -u hostmgr-deploy-helper -n 100 --no-pager`, `sudo nginx -t`, host DNS and certificate issuance. HTTP 301 redirecting to healthy HTTPS is expected. An API success does not prove static files or login work. Reset a lost password with `sudo strckro --reset-pwd`; it generates a new random password, displays it once in the terminal, revokes old sessions and restarts Portal. Store the displayed password securely before closing the terminal. Keep port 3100 private and redact secrets in shared logs.

Maintainers: [release guide](releasing-and-ai-handoff.md), [bootstrap hosting](bootstrap-hosting.md), [Node versions](node-versions.md).
