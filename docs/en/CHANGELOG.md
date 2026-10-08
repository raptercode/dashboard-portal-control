# Changelog

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
