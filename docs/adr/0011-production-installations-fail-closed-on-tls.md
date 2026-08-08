# ADR 0011: Production installation fails closed until TLS is verified

- Status: Accepted
- Date: 2026-08-07

## Decision

The direct Ubuntu installer requires both `--domain` and `--email`. It requires the domain to resolve before making managed configuration changes, obtains a TLS certificate with Certbot, redirects HTTP to HTTPS, enables HSTS, and makes an HTTPS health request before declaring success. It sets `HOSTMGR_SECURE_COOKIE=true` in the production environment.

Node.js is installed from the pinned official archive only after its embedded SHA-256 value matches. The installer stages and syntax-checks the application, snapshots every file it owns before changing it, and restores its service, Nginx files, app root, configuration, and data root when a later managed step fails. Apt package changes and issued certificates are reported but not automatically removed.

## Consequences

- `sudo ./dashboard-portal.sh --domain=portal.example.com` no longer succeeds; production use needs a deliverable email address and publicly reachable port 80/443.
- Existing third-party Nginx sites are retained. Only the named Dashboard Portal site is managed.
- An Ubuntu 24.04 or 25.04 acceptance run is required before the first real-server installation. Docker tests cannot certify systemd, Certbot, DNS, firewall, or reboot behaviour.
