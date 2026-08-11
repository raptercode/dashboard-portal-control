# Production installation on Ubuntu 24.04 or 25.04

This is the direct, production installation path. Docker is for development and integration tests only. The installer refuses an HTTP-only installation because Dashboard Portal has an owner login.

## Before installing

- Use an Ubuntu Server **24.04 or 25.04 amd64** host for the first acceptance run. Do not make a first run on the only production server when a disposable host is available.
- Create an A or AAAA record for the chosen fully qualified domain name and wait until `getent ahosts portal.example.com` resolves from the target host.
- Permit inbound TCP 80 and 443 to the target host. Certbot uses the HTTP-01 challenge; a DNS record alone is insufficient.
- Start from an extracted release archive, not a Git working copy. Verify the archive before extracting it:

```bash
sha256sum --check dashboard-portal-*.tar.gz.sha256
tar --extract --gzip --file dashboard-portal-*.tar.gz
cd dashboard-portal-*
```

- Ensure port 3100 is free. The service binds it to loopback only. Nginx is the sole public listener.
- Back up any existing Nginx/site configuration independently. The installer owns only `/etc/nginx/sites-available/dashboard-portal` and its matching `sites-enabled` symlink; it does not remove the default site or edit other virtual hosts.

## Install

```bash
sudo ./dashboard-portal.sh --domain=dpt.domain.com --email=admin@example.com
```

Both flags are mandatory. `--email` is required for the Let's Encrypt account and the HTTPS certificate. The installer verifies DNS resolution, installs pinned Node.js 24.18.0 after SHA-256 verification, starts Dashboard Portal on `127.0.0.1:3100`, obtains a certificate, forces HTTPS with HSTS, and verifies `/api/health` through HTTPS.

It prompts for the owner password only on the initial install. Use at least 12 characters and do not put that password on a command line, in a shell history, or in a deployment log.

## What the installer changes

- Installs: Nginx, Certbot, Git, curl, CA certificates, and xz-utils through apt.
- Adds the unprivileged `dashboardportal` service account.
- Writes a root-owned systemd unit with filesystem and privilege restrictions.
- Provisions a separate root-owned Unix-socket helper for allowlisted tool installs, project activation, managed Nginx files, and Certbot. The dashboard itself remains unprivileged.
- Writes `/etc/dashboard-portal/dashboard-portal.env` as `root:dashboardportal`, mode `0640`. It includes the persistent encryption key and `HOSTMGR_SECURE_COOKIE=true`.
- Stores encrypted state and checked-out projects under `/var/lib/dashboard-portal`, accessible only to the service account.
- Creates timestamped pre-change snapshots under `/var/backups/dashboard-portal`, mode `0700`.

Never change `HOSTMGR_SECRET_KEY` after credentials or project environment values exist. Back up `/etc/dashboard-portal/dashboard-portal.env` and `/var/lib/dashboard-portal` together, encrypted and access-controlled. A backup of only one is not recoverable.

For a project deployment, save at least one FQDN in the Project's **Domains** action before creating a release. Its DNS record must already resolve to the host. On activation the helper creates only `/etc/nginx/sites-available/hostmgr-<project-slug>.conf`, validates Nginx, requests or expands a Let's Encrypt certificate, and reloads Nginx. It does not modify unrelated virtual hosts.

## Acceptance checklist

Run these on the Ubuntu VM after installation. Record the output with secrets redacted.

```bash
sudo systemctl is-active dashboard-portal nginx
curl --fail --silent --show-error https://dpt.domain.com/api/health
curl --fail --silent --show-error -I https://dpt.domain.com/
sudo systemctl reboot
```

After reconnecting, repeat the first two commands. Then use the Dashboard to create a test project with a public repository, provide its environment values, and validate a real deploy/health-check/rollback once that feature is enabled. For private repositories, verify separately that the token or deploy key never appears in `journalctl`, the project URL, `ps`, or the API response.

Also exercise failure containment on the disposable VM: temporarily block inbound port 80 or point a test domain to the wrong host, run the installer, confirm it fails before reporting success, and confirm the pre-existing Dashboard service and Nginx configuration still work. Package installation and a certificate already issued by Let's Encrypt are intentionally not removed during rollback; the managed service, application, configuration, and Nginx files are restored.

## Operations and recovery

```bash
sudo journalctl -u dashboard-portal --since '30 minutes ago' --no-pager
sudo nginx -t
sudo systemctl restart dashboard-portal
sudo systemctl reload nginx
```

### Reset an owner password over SSH

If the owner password is lost, generate a new one directly on the host:

```bash
sudo dashboard-portal --reset-pwd
```

The command prints a new random password once. Store it in a password manager before closing the terminal; it invalidates all existing Dashboard Portal sessions and restarts Dashboard Portal so the new password is active immediately.

Do not expose port 3100 in the firewall. If the HTTPS health check fails, investigate `journalctl` and Nginx first; do not bypass TLS by proxying the login over plain HTTP. Restore only the timestamped snapshot that predates the failed change, test `nginx -t`, and reload Nginx. The installer keeps these snapshots under `/var/backups/dashboard-portal` for that purpose.

## Software update notifications and SSH update

The UI can report a signed release manifest, but it never applies a Dashboard
Portal update. Configure the release channel once from SSH after placing the
Ed25519 public key on the host:

```bash
sudo dashboard-portal configure-update \
  --manifest=https://releases.example.com/dashboard-portal/stable.json \
  --public-key=/secure/download/dashboard-portal-update-public.pem
```

The command copies the public key to `/etc/dashboard-portal`, verifies the
manifest immediately, and does not retain any release-host credential. The UI
then shows the available version and a copyable command. Apply it only over
SSH:

```bash
sudo dashboard-portal update --channel=stable
```

To prepare a release artifact, generate the Ed25519 signing pair once outside
the repository, retain only the private key in CI secrets, and sign a release:

```bash
npm run release:keygen -- --out=/secure/dashboard-portal-update-key
npm run release:prepare -- \
  --out=dist \
  --archive-url=https://releases.example.com/dashboard-portal/dashboard-portal-0.2.0.tar.gz \
  --private-key=/secure/dashboard-portal-update-key/dashboard-portal-update-private.pem
```

Publish the generated archive and `stable.json` at immutable HTTPS URLs (for
example, release assets in GitHub Releases). Never commit the private key or
serve the update archive from the Dashboard Portal host itself.
