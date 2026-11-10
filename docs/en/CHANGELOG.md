# Changelog

## 1.1.2 — 2026-11-10

- Show persistent storage in the application. A new read-only **Storage** tab gives the mount path, the host folder, whether the live release already uses it (*In use* or *Waiting for the next deploy*), the bytes in regular files, the number of items and the free disk space, with **Measure again**. The Portal asks the root helper (`project-storage-status`), which reads link metadata itself but counts the folder with `find` and `df` run as the project's own Unix user, never following links and giving up after 20 seconds; one reading is shared for five seconds. Visible with `project.view` through `GET /api/projects/<slug>/storage`. It shows no file names and cannot download, upload or delete files. See the how-to and the ADR 0032 addendum.

## 1.1.1 — 2026-11-09

- Add persistent project storage. Files an application wrote next to its code were lost at the next deploy or rollback, because each release directory is replaced and old ones are deleted. A native project (Node.js, Bun, Go, Python, PHP, workers) can now set a **Mount path** such as `uploads`; the Portal keeps `/srv/hostmgr/projects/<slug>/shared/storage` outside `releases/` and links it into every release at that path, at deploy and at rollback, so the application keeps using `./uploads` unchanged. The link is made as the project's own Unix user, never by root; a file at the path stops the deployment instead of being deleted; Docker Compose keeps named volumes. Applies at the next deployment, needs `project.configure`, and deleting the application deletes its storage. New installer file `project-storage.mjs`. See the how-to and ADR 0032.

- Count portal login, invitation and CLI login attempts per visitor. Behind Nginx every request used to arrive from `127.0.0.1`, so five wrong passwords from anyone locked the owner out for 15 minutes. The portal now reads `X-Real-IP`, but only on a loopback connection that also carries a secret (`HOSTMGR_PROXY_TOKEN`) which Nginx stamps from a root-only snippet, so a process on the host, such as a deployed project, cannot spoof its address to escape the limit.
- Let Nginx report the visitor address behind Cloudflare Proxy (`/etc/nginx/conf.d/strckro-realip.conf`, trusting `CF-Connecting-IP` only from Cloudflare's published ranges). Projects receive the visitor in `X-Real-IP`. Installed by `strckro.sh` on install and update, and dropped with a warning when Nginx itself reports it as a duplicate of a `real_ip_header` or `real_ip_recursive` the host already sets at http level (Nginx decides, so another site's own `server` block is never mistaken for a conflict). The configuration passed `nginx -t` and was exercised on Ubuntu 24.04 with Nginx 1.24; a complete `sudo strckro update` on a real host has not been tried.
- Move the pinned Node.js runtimes to the October 2026 security releases: 22.23.4, 24.22.2 and 26.13.0 (previously 22.23.3, 24.18.0 and 26.10.0), with checksums taken from the GPG-signed `SHASUMS256.txt` of each release. They fix High-severity issues such as the Brotli out-of-bounds write in `node:zlib` (CVE-2026-111497). Node.js 20 has no fixed build because it is end of life, so the installer now warns when the Portal runs on it.
- Keep other Node.js majors current on update: a project service names `/opt/node-v<version>`, so every major already provisioned under `/opt` moves to its pinned release too. A failure there is a warning that keeps the existing runtime, not a failed Portal update.
- Make anonymous endpoints cheap. Every request used to copy the whole portal state before the caller was identified, and an anonymous caller could trigger that thousands of times a second (`/api/*` without a credential, a bogus bearer token, a webhook for a project that does not exist, CLI login polling). A request with no credential the portal recognises is now answered without copying or writing state, CLI login polling is limited per visitor, and Nginx gives each address a request budget (40/s, burst 200, `/etc/nginx/conf.d/strckro-limits.conf`).
- Throttle guessing harder. Sign-in attempts are now also counted per account (10 in 15 minutes across all visitors, existing or not), so guesses spread over many addresses stay bounded; an IPv6 visitor counts as its whole /64, in the Portal and in Nginx; an attempt is counted when it starts and given back if it succeeds, so simultaneous guesses cannot all slip through and a success no longer resets a visitor's earlier failures; a wrong email costs one password hash, checked on the thread pool two at a time, so response time no longer reveals which accounts exist and a flood cannot stall the Portal; failed sign-ins write at most one audit entry a second; and guessing the installer password at first-run bootstrap is limited per visitor and overall. A visitor that has signed in to an account since the Portal started is not refused by that account's limit, so a stranger cannot lock the owner out of their usual address; restarting the Portal clears all counters. Every source address in 127.0.0.0/8 is one local visitor, and a flood of password checks keeps places in the queue for such known visitors. Failures are written to the audit log at most once a second and the held-back ones are written together when the second ends. Behaviour to know: a successful sign-in no longer clears a visitor's earlier failures, so five failures in total from one shared address lock that address for the 15-minute window.
- Refuse notification webhooks that point at private addresses. A member who could manage webhooks could aim the portal at `127.0.0.1`, a LAN host or a cloud metadata address and read the HTTP status back. Destinations must now be public: checked when saved and again at every delivery, with the connection pinned to the address that was checked, no redirects followed and no response body kept. `HOSTMGR_WEBHOOK_ALLOW_PRIVATE=true` is the host owner's opt-in for a private network.
- Contain deployed projects. Their systemd units now set `MemoryMax=85%`, `TasksMax=4096` and close kernel interfaces (`ProtectKernelTunables/Modules/Logs`, `ProtectControlGroups`, `LockPersonality`, `RestrictSUIDSGID`, `RestrictAddressFamilies`). Existing projects pick them up at their next deployment.
- Remove superseded Node.js runtimes on update, but only an older `/opt/node-v<version>` of a major whose pinned release is installed and working, that is exactly what the Node.js archive unpacks to (nothing installed into it: no global package, `etc/npmrc`, application or dotfile), that no unit (a linked one included) or project configuration names and no process has its executable or working directory in; if `/proc` cannot be read nothing is removed. A project service on Node 24 follows the Portal's runtime at its next restart; one on another major keeps its path until redeployed.
- Refuse to prepare a release that is missing files. `release:prepare` archives committed `HEAD`, so a runtime file that was never committed used to be left out silently, and the Portal that imports it failed to start. It now stops on untracked runtime files (`--allow-untracked=yes` overrides) and warns about uncommitted edits.
- Send deployment notifications to Discord as an embed from "Strckro" with the logo, naming the project, runtime, branch, commit, release, duration and domain inside the embed. Other providers are unchanged.

## 1.1.0 — 2026-11-07

- Replace the monolithic frontend with the Signal interface: shared host strip and rail, responsive application inventory, source → build → serving tracks, health gauges, release timelines and system-aware light/dark themes.
- Load workspaces and APIs on demand, keep navigation in one document, pause polling in hidden tabs, and protect unsaved forms and ENV edits. Add keyboard search and a loopback-only preview with isolated temporary data.
- Restore per-domain DNS, Cloudflare proxy and origin TLS status, explicit Refresh/Verify and removal retries, deployment progress with on-demand logs, and release/commit confirmations for Restart and Rollback.
- Add runtime/framework logo menus and repository-driven detection, plus explicit Auto/npm/pnpm selection retained through deployment and rollback. Reject conflicting packageManager declarations.
- Complete Strckro installer, host-command and archive naming. Hosts using the legacy dashboard-portal updater must run strckro.sh once; existing host paths, services and signing trust are retained. See the migration guide.
- Replace obsolete markup assertions with model tests and real browser workflows. Local validation does not establish Ubuntu/systemd/Nginx/TLS, fresh-install or reboot acceptance; publication does not update installed hosts.

## 1.0.4 — 2026-11-06

- Introduce Strckro branding, a layered SVG logo, a redesigned login/Overview experience, and a dedicated deployment activity workspace with project/status filters and live metadata refresh.
- Add scoped, expiring CLI credentials, browser/device login with explicit approval, token management/revocation, and bearer access to allowed project workflows. Existing organization permissions are rechecked at mutation commit.
- Add atomic revision-checked ENV patches and a metadata-only deployment feed. Publish the renamed `strckro` CLI (`skctl` and `strckro`) with legacy config/credential compatibility.
- Keep host service identifiers, paths, commands and signed update trust compatible. Publishing this release does not update an installed host; real Linux/systemd/Nginx/TLS acceptance remains separate from local fixtures.

## 1.0.3 — 2026-10-20

- Restart the active native app process after a failed sync/deployment without creating another release or replacing its deployed ENV. Restart checks process stability and configured HTTP health, reports progress and failures, and blocks overlapping project operations.
- Move ENV and deployment planning into a wide workspace with searchable variable rows, direct Environment / Build / Review navigation and unsaved-edit protection. Saving ENV applies it to the next deployment, including its build; Restart keeps the deployed ENV.
- Keep Deploy, Sync latest, ENV, Restart app and Logs visible on project cards. Restart supports native systemd apps; Docker Compose retains its deployment workflow.
- Explicit Sync latest retries a cached failed revision or returns to the latest commit after rollback when Auto deploy permits it. Configuration saves, background polling, disabled Auto deploy and Actions mode retain their separate behavior.
- Successful rollback updates the card, shows release IDs and identifies same-commit targets. Historical failure logs remain accessible without announcing a new failure or labeling a completed job as running.

## 1.0.2 — 2026-10-20

- Wait up to 30 seconds for live HTTP/TLS probes after a graceful Nginx reload when the managed configuration is correct. A new domain no longer rolls back immediately because an old worker rejects its TLS handshake; genuine configuration errors still fail immediately.
- Use fresh HTTP connections during readiness checks and distinguish certificate, HTTP routing and upstream failures.
- Regression tests cover delayed workers, retry limits, configuration failures and connection reuse. Before publication, the patch passed the real Verify API, all eight Nginx/TLS checks and HTTPS 200 on an existing Ubuntu host. Fresh installation and reboot acceptance remain separate.

## 1.0.1 — 2026-10-20

- Domain replacement and removal update the named certificate's exact domain set. Certificate preflight falls back to bounded public DNS queries when the host resolver retains a negative answer; HTTP-01 validation remains required.
- Add domains before configuring DNS, view the required A/AAAA records, then Verify to configure Nginx/TLS. Pending domains do not interrupt existing active domains or later app deployments. Refresh checks status without changing configuration.
- Show Cloudflare Proxy status from public IPv4/IPv6 DNS without requiring Proxy to be disabled, and check the origin TLS certificate with SNI, hostname and trust validation. The proxy's hidden origin IP and visitor-facing CDN certificate remain separate.
- Saved domain state and Nginx/TLS activation have separate outcomes, visible errors and explicit retry. Rejected removal of the last domain no longer counts as a successful sync. Dialogs prevent duplicate actions and ignore stale responses after closing or changing projects.
- Local automated fixtures cover the failure/retry paths; real certificate issuance and production recovery require host acceptance after installing this patch.

## 1.0.0 — 2026-10-15

- Stable release scope: one Ubuntu amd64 host and trusted repositories. Publication does not update an installed host.
- Web/API projects can deploy without a domain. Long-running Node.js, Bun, Go and Python-script Workers use no Portal-assigned port or HTTP probe; empty ENV is allowed. Workers build without starting a candidate consumer, stop the old service before cutover, check process stability and attempt recovery after activation failure.
- Installer/update/helper/CLI operations share maintenance leases, preserve consistent state snapshots and recover failed installation changes. Monitor usage writes also respect maintenance exclusion.
- Navigation groups related tasks; Settings has separate account, update and Monitor integration pages, with mobile keyboard/focus improvements.
- Retains v0.8.6–0.8.9 pnpm and Prisma compatibility, Node-major preservation and project-scoped Monitor field allowlists. Existing projects default to Web; service type and Worker runtime cannot change after a release exists.
- Operational Mail and remote `dpctl` are deferred. PHP/Compose/ASGI/WSGI and one-shot Workers are unsupported. Process stability does not certify queue/job success or exactly-once delivery.
- Validation uses local/Docker suites and fixtures. Clean-host provisioning, real helper/systemd/Nginx/TLS, reboot and whole-host restore remain unverified; see the [acceptance record](knowledge/plans/v1-acceptance-record.md). This release does not claim hostile-tenant isolation.

## 0.8.9 — 2026-10-10

- Resolve the Prisma CLI from installed package bin metadata, including Prisma 8 `dist/prisma.js`.
- Run Prisma 8 `contract emit` before build; retain `generate` for Prisma 2–7 and skip ordinary apps.
- Distinguish missing packages, invalid CLI entry points and contract errors, with redacted diagnostics. No database operations run automatically.

## 0.8.8 — 2026-10-09

- Restrict Monitor token deployment responses to explicit job, release-health, and event fields. Build/startup `failureLog` and private stored job metadata no longer reach the Monitor API; authorized Portal log readers retain their detailed diagnostics.
- Add a current Monitor API reference for AI clients and a proposed, separately versioned `dashboard-portal-client` plan. The client and its ENV-writing APIs are not part of this release.

## 0.8.7 — 2026-10-06

- Detect Prisma in Node/Bun projects and generate the installed client before build, with the project environment. No extra build script is required; no automatic migrations, seeding or CLI downloads.
- Support pnpm 12 and discover pnpm beside the selected Node runtime as well as global system locations. Setup installation remains optional.
- Show the detected npm/pnpm commands and lockfile in deployment configuration.

## 0.8.6 — 2026-10-06

- Add optional pnpm installation in Setup. Portal installation and updates never install pnpm automatically.
- Node projects select npm/pnpm from packageManager and lockfiles. Missing or mismatched pnpm fails with actionable guidance; project operations never download or switch the manager.
- Use pnpm for install, build, health checks, host startup and rollback with the selected Node runtime. Frozen pnpm lockfiles are enforced and relative dependency symlinks survive activation.
- Preserve redacted dependency-install errors in deployment logs instead of hiding the npm/pnpm root cause.
- See [pnpm projects](how-to/pnpm-projects.md) for setup, supported versions and project settings.

## 0.8.5 — 2026-09-30

- CLI `-h`/`--help` lists commands and options; `-v`/`--versions`/`--version` reports Portal and runtime versions without sudo. Command-specific help is available before privileged actions.
- Portal updates preserve the configured Node major, detecting the current runtime on legacy installations without a saved major.
- The installer prepares only the selected Portal Node major and links global Node/npm/npx to it. Unused Node 26 no longer blocks Node 20/22/24 updates; Node 26 selection prepares libatomic1.
- Older updaters that pass no major are supported through installer detection of the existing configuration or service runtime. Fresh installations still default to 24; existing project runtimes are retained.

## 0.8.4 — 2026-09-30

### Changed

- Sync, deploy, deployment wizard and rollback show progress on project cards without automatically opening a log dialog.
- Project cards refresh every 1.5 seconds during deployment and every 5 seconds while idle, including automatically triggered jobs. Hidden tabs pause requests.
- Cards show preparation, dependency installation, build, health checks, activation and the final result. Deployment logs remain available through an explicit details action.
- Automatic card updates preserve open menus/details and keyboard focus. Deployment summaries respect project access and exclude log messages and private failure details.

### Validation boundary

- Automated tests cover polling, concurrent project updates, terminal states, transient errors, focus preservation and scoped API summaries.
- Interactive browser and production-host acceptance remain unverified; publishing this release does not update an installed host.

## 0.8.3 — 2026-09-30

### Added

- Portal runtime support for Node.js 20.20.2+, 22.13+, 24.x and 26.x.
- Independent Node 20/22/24/26 selection for native Node projects, including build, health checks, host activation and release rollback.
- Installer `--node-major` option with checksum-verified runtimes; signed updates preserve the selected Portal major.
- SQLite compatibility adapter using better-sqlite3 on Node 20 and the existing node:sqlite driver on newer supported majors, with the same database file/schema.
- MIT license and practical installation, upgrade, backup and nvm documentation.

### Fixed

- Docker image includes the scripts and views needed by the Portal.
- Node 20 installation prepares native dependencies and readable service permissions before switching the application.

### Upgrade notes

- Default Portal and existing app runtime remains Node 24; Node 20 is retained for compatibility despite its upstream end of life.
- Back up Portal state and its existing encryption key together before updating.
- No database conversion is required for the driver adapter. Application-specific native dependencies may need a rebuild when changing Node.
- Local tests do not replace Ubuntu installation, systemd, Nginx/TLS and reboot acceptance checks.

Earlier releases: [GitHub Releases](https://github.com/raptercode/Strckro/releases).
