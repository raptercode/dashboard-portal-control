# Production readiness review: 2026-08-07

## Corrected finding: live tool inventory

**Finding:** The host dashboard showed Nginx, Certbot, and Git as missing even though their executables were installed. `doctorReport()` returned the tool records persisted when the state file was created. Those records are installation history, not host truth.

**Correction:** In `host` mode, every `/api/doctor` request now probes fixed Ubuntu executable paths and returns the observed status and version. The persisted state remains useful for audit history, but cannot make the dashboard claim a missing tool is present or vice versa. Docker is considered installed only when both `docker --version` and `docker compose version` succeed.

**Regression evidence:** The test suite covers a stale state where Nginx, Git, and Docker probe as installed while Certbot does not. Live production API verification returned `Installed` for Nginx, Certbot, Git, Docker Engine, and Docker Compose.

## Accepted production controls

- Dashboard listens only on loopback; host Nginx handles public HTTPS.
- The owner cookie is `Secure`, `HttpOnly`, and `SameSite=Strict`; write routes require a CSRF token.
- Owner sessions persist for seven days across a normal Dashboard service restart. Persistent state stores only a hash of the browser session identifier; see ADR 0013.
- The public Nginx site sends `Referrer-Policy: no-referrer` so a URL query cannot be propagated as a referrer to later page assets or navigations.
- The direct installer verifies its Node archive, owns only its Nginx site, snapshots its own files before changes, and fails closed on TLS.
- Credentials and per-project environment content are encrypted at rest and API responses return metadata only.
- A root-owned Unix-socket helper now handles allowlisted tool installation, project activation/rollback, managed Nginx files, and Certbot; the dashboard process remains unprivileged.
- Active project domain changes validate DNS, preserve external Nginx ownership, test generated configuration before reload, and restore the prior managed file when TLS sync fails.

## Remaining production gaps

These are not hidden by the corrected inventory screen and remain before treating the portal as a general-purpose hosting panel:

1. **SSH deploy keys:** SSH projects intentionally remain blocked until a key-generation, public-key registration, rotation, and revocation workflow is implemented.
2. **Build isolation:** source clone/build code currently executes under the dashboard service account before the helper creates the per-project runtime user. Only repositories trusted by the owner should be built until that boundary is moved into the helper.
3. **Operational acceptance:** the live host was not rebooted because it already serves unrelated workloads. Backups, restore, renewal monitoring, and a scheduled maintenance/reboot window remain operational work.

## Review conclusion

The Dashboard Portal is installed, HTTPS-protected, and can activate trusted Node projects with managed Nginx/TLS after DNS and health checks. The remaining gaps limit it from being a general-purpose hosting panel; they do not block the owner workflow described above.
