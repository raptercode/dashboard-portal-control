# Production incident: Dashboard static files returned 500 after an update

- Date: 2026-08-11
- Host: `SpeedTopup` (`dpt.tovenly.com`)
- Status: Resolved and regression-fixed in the installer

## Symptoms

The public dashboard root returned `500` with `{"error":"Internal server error."}`
while `/api/health` remained healthy. The update client had already verified its
downloaded archive checksum and signature, but the installed application did not
serve static files.

## Diagnosis

`journalctl -u dashboard-portal` reported `EACCES` when the unprivileged
`dashboardportal` service tried to read `public/index.html`. `namei -l` showed
that `/opt/dashboard-portal` was mode `0700`, owned by `root:root`. Files below
it were readable, but the service user could not traverse the application-root
directory. API health checks did not read static assets, which explained the
different endpoint behaviour.

The installer moves a staging directory into `/opt/dashboard-portal`. A
restrictive staging-directory mode from the updater could therefore survive the
move. The existing recursive `go-w` hardening did not restore the required
traverse permission on the root directory.

## Immediate recovery

On the host, restore only the application-root traverse permission and restart
the service:

```bash
sudo chmod 0755 /opt/dashboard-portal
sudo systemctl restart dashboard-portal
sudo systemctl is-active dashboard-portal
curl -fsS http://127.0.0.1:3100/
curl -fsSI https://dpt.tovenly.com/
```

Do not make the application root writable by the service account. Source files
remain root-owned; the service writes only under `/var/lib/dashboard-portal`.

## Permanent fix and future verification

The installer now runs `chmod 0755 "$APP_ROOT"` immediately after moving the
staged application into place, before the recursive no-group/other-write
hardening. The release pipeline also archives committed Git content and
preserves LF shell scripts, avoiding the earlier Windows archive-line-ending
failure.

After every production update, verify both the API and a static page, not only
`/api/health`:

```bash
sudo dashboard-portal update --channel=stable --check
sudo dashboard-portal update --channel=stable
sudo systemctl is-active dashboard-portal hostmgr-deploy-helper nginx
curl -fsS http://127.0.0.1:3100/api/health
curl -fsSI https://dpt.tovenly.com/
```
