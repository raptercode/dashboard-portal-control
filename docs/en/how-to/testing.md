# Test modules and acceptance boundaries

Localized topic guide; the original detailed record is available in [Thai](../../th/how-to/testing.md).


## Run tests

```bash
npm test
node scripts/test-modules.mjs --list
node scripts/test-modules.mjs installer
node scripts/test-modules.mjs access-api org-credentials-api
bash -n install.sh dashboard-portal.sh
```

Use Git Bash for shell checks on Windows. Discover current module names with `--list`; `--all` selects `*.test.mjs` only. Unknown names fail before execution. Each file is a module; `test/support/server.mjs` supplies isolated temporary state and loopback HTTP fixtures with real session/CSRF handling.

The former server suite is divided into server-candidate, server-monitor, server-shell, server-runtime, server-auth, server-integrations, server-deployment, server-environment and server-observability. Other modules cover state, secrets, Node/Bun/Go/Python/PHP, mail, DNS/Nginx, DB, metrics, installer, updater and UI. Run only relevant modules during iteration, then required full checks for release.

## Access scenarios

| Scenario | Required behavior |
| --- | --- |
| Anonymous | No access to protected API/data |
| Master | All organizations and host tools; CSRF enforced; last Master protected |
| User without membership | No visible projects or organization creation |
| Viewer | Project/log/audit reads only |
| Operator | Source sync/deploy/rollback, without environment/host administration |
| Maintainer | Organization grants including environment/credentials; no global administration |
| Mixed grants | Each operation uses the target organization's grants |
| Disabled/revoked user | Existing sessions cannot retain old authorization |

Viewer/Operator/Maintainer are membership presets, not account roles. `access-api` covers HTTP authorization, invitation expiry/revocation/single use, cross-org jobs/audit/hooks, env read/write separation, restart sessions and allowed operations. `access-model` isolates persistence/migration policy. `access-hardening` covers token throttling, visibility, sync without deploy grants, diagnostics scoping and queued-job revocation. `org-credentials-api` checks each credential grant, defaults, encryption/rotation, mocked Git callbacks, legacy bindings and CSRF; mocked clone behavior does not prove access to a real private repository.

When adding an endpoint, test both permission success and denial, cross-org references, session CSRF for mutations and safe fields on reads. UI button visibility is insufficient API protection.

## Runtime and host acceptance

SQLite parity uses synthetic data for node:sqlite/better-sqlite3. Go compiler tests and offline Python venv tests exercise real local runtime behavior where available. Demo/fake probes do not prove Ubuntu systemd, apt, Nginx, TLS, DNS or SMTP delivery. Check browser flows separately from structural UI assertions.

For installer/updater changes verify shell syntax, failed-download/hash behavior, interactive prompts, version resolution, installer arguments and privilege handoff. Bootstrap fixtures must never invoke real sudo or modify a host. Host acceptance needs a clean Ubuntu VM, managed/unmanaged Nginx behavior, service users/permissions, certificates, API and static files, deployment/rollback and reboot persistence. Record OS/image/kernel and evidence, with unavailable checks explicitly marked.

Mail checks distinguish SMTP egress, local UFW policy, provider firewall and real external delivery. Test restoring state with its encryption key. Release checks include `git diff --check`, links, package/lock consistency, archive contents, Ed25519 signature and downloaded SHA-256; see [release guide](releasing-and-ai-handoff.md).

## Documentation and public bootstrap checks

```bash
npm run docs:check
python3 test/support/bootstrap-check.py
```

The link checker verifies local paths and th/en topic pairs. The Python harness uses Linux/WSL POSIX PTYs and offline release fixtures to exercise piped prompts, sudo handoff, pinned/latest versions, download/checksum failures and cleanup without installing on a host. The bootstrap test module runs it on Linux and skips on Windows; run it through WSL there.
