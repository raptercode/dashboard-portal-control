# Changelog

## Unreleased

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

Earlier releases: [GitHub Releases](https://github.com/raptercode/dashboard-portal-control/releases).
