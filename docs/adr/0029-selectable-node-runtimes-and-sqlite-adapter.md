# ADR 0029: Selectable Node runtimes and a SQLite compatibility adapter

Status: Accepted
Date: 2026-09-30

## Context

The Portal and native Node projects previously used one pinned Node 24 runtime.
Users need to run the Portal on Node 20 and choose another supported Node major
for individual applications. Node 20 has no built-in node:sqlite API. Existing
installations must retain their SQLite data, encryption key and default runtime.

## Decision

Support Node 20.20.2+, 22.13+, 24.x and 26.x within those majors, with Node 24
as the default. Install checksum-verified, pinned Linux x64 binaries under
root-owned /opt paths. Keep legacy global Node/npm links on 24, while Portal
services and non-default application services use explicit runtime paths.

Store the Portal major in installer configuration and preserve it during signed
updates. Validate a per-project nodeMajor and use it during dependency install,
build, candidate checks and host service execution. Snapshot it into each
release so rollback uses the release's major. Legacy projects/releases default
to 24. Runtime selection does not depend on an interactive nvm shell or .nvmrc.

Use a narrow SQLite adapter: node:sqlite on Node 22.13+ and better-sqlite3
11.10.0 on Node 20. Both use the existing SQLite file and schema. No data
conversion or secret-key rotation is part of this change. Install and preflight
Node 20 dependencies in staging before replacing the running application.
Declare the addon as optional in the package manifest so newer Node versions
can install without compiling an unused binding. Node 20 still requires it;
the installer must fail preflight if it cannot open SQLite with the addon.

## Consequences

- Portal and application runtime choices are independent.
- Existing installations and releases retain their Node 24 default.
- Node 20 requires a native addon and may require compilation tools.
- Installing all supported runtimes increases disk and download requirements.
- Runtime pins and checksums need deliberate maintenance; supporting these
  majors does not promise compatibility with every future Node release.
- Node 20 is an upstream EOL compatibility option; new installations should use 24.
- Driver parity tests use synthetic data. Backup/restore and Ubuntu host
  acceptance remain necessary for customer updates.
- nvm remains useful for local development but does not configure host services.

See [Node versions](../node-versions.md) and
[production installation](../production-install.md).
