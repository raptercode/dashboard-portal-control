# Changelog

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