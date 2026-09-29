# Portal and application Node.js versions

Localized topic guide; the original detailed record is available in [Thai](../../th/how-to/node-versions.md).


Supported majors follow [package.json](../../../package.json): 20.20.2+, 22.13+, 24.x and 26.x within those major ranges. Odd majors and future majors are excluded.

| Major | Installer pin | Portal SQLite driver |
| --- | --- | --- |
| 20 | 20.20.2 | better-sqlite3 11.10.0 |
| 22 | 22.23.3 | node:sqlite |
| 24 (default) | 24.18.0 | node:sqlite |
| 26 | 26.10.0 | node:sqlite |

All four official Linux x64 binaries are checksum-verified and installed under `/opt/node-v<version>`. Allow disk space and downloads for each. Node 20 is retained as a compatibility option; prefer 24 for new installations.

## Select a Portal runtime

The single command in [production installation](production-install.md) uses Node 24 for the Portal. The bootstrap's advanced `--node-major` option supports 20/22/24/26 when a specific Portal runtime is required. Services and helper commands use explicit paths to that runtime; global `/usr/local/bin/node`, `npm`, `npx` and `corepack` remain on 24. Signed updates preserve `HOSTMGR_NODE_MAJOR`. Back up state/key before changing the Portal runtime.

```bash
/opt/node-v20.20.2/bin/node --version
/opt/node-v22.23.3/bin/node --version
/opt/node-v24.18.0/bin/node --version
/opt/node-v26.10.0/bin/node --version
sudo systemctl show dashboard-portal -p ExecStart
```

## Select application runtimes

Choose Node.js and its major in a Project. Dependencies, build, candidate health and activated systemd service use that major. Changes require a new release. Each release saves its major, so rollback restores the matching runtime. Legacy records default to 24. Lockfile installs use `npm ci`, with an isolated candidate fallback to `npm install` for absent/stale locks. Native dependencies may need recompilation on a major change. The Portal controls `PORT` and `HOST`.

## Local development with nvm

nvm configures an interactive development shell, not host systemd services. Install nvm following its [official repository](https://github.com/nvm-sh/nvm), then:

```bash
nvm install 24
nvm use 24
node --version
npm ci
npm test
```

For a Node 20 compatibility check, select 20.20.2 and reinstall dependencies before testing. On Windows use a compatible version manager and verify the selected executable with `Get-Command node`. Do not assume `.nvmrc` changes Portal/project service runtime selection.

## SQLite and verification

Node 22.13+ uses built-in `node:sqlite`; 20 uses the optional native addon. They share the existing database/schema/key, with no conversion. Node 20 installation may require C/C++ tools and Python if no prebuilt binding exists. Installer preflight opens SQLite in staging before replacing the live app; addon failure must stop installation. Test both drivers and staging backup/restore; synthetic parity tests do not certify production data or host deployment. See [testing](testing.md) and [ADR 0029](../knowledge/adr/0029-selectable-node-runtimes-and-sqlite-adapter.md).
