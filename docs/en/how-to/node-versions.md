# Portal and application Node.js versions

Localized topic guide; the original detailed record is available in [Thai](../../th/how-to/node-versions.md).


Supported majors follow [package.json](../../../package.json): 20.20.2+, 22.13+, 24.x and 26.x within those major ranges. Odd majors and future majors are excluded.

| Major | Installer pin | Portal SQLite driver |
| --- | --- | --- |
| 20 | 20.20.2 | better-sqlite3 11.10.0 |
| 22 | 22.23.4 | node:sqlite |
| 24 (default) | 24.22.2 | node:sqlite |
| 26 | 26.13.0 | node:sqlite |

The selected Portal Linux x64 runtime is checksum-verified and installed under `/opt/node-v<version>`. Installation and updates do not provision a Node major that is not already on the host. A project service names `/opt/node-v<version>`, so when a pin moves, every other major already provisioned under `/opt` is moved to its pinned release too; if that fails, the installer prints a warning, keeps the runtime it has and still updates the Portal. A major that is not on the host must be provisioned separately before deploying a project that uses it. A project service on Node 24 starts `/usr/local/bin/npm`, which follows the Portal's runtime, so it moves to the new release at its next restart. A service on any other major keeps the `/opt/node-v<version>` path it was activated with until its next deployment; Restart does not change it. Once an update has installed the pinned release of a major, it removes the older `/opt/node-v<version>` directories of that major that are named like a managed runtime, are exactly what the Node.js archive unpacks to, and are no longer used: no systemd unit (a linked one included) or project configuration mentions them and no process has its executable or working directory in them. "Exactly" means a `node` binary and npm are present and the top level, `bin`, `lib`, `lib/node_modules`, `share` and `include` hold nothing but the names that archive uses. A directory that someone put anything else into (a global package such as `pm2` or `pnpm`, `etc/npmrc` from `npm config set -g`, an application, a dotfile) is theirs and stays. If `/proc` cannot be read, nothing is removed. A runtime that is still in use stays, and is reconsidered at the next update. A newer directory than the pin is never touched. Keep your own scripts, cron lines and tools outside `/opt/node-v<version>`: the installer cannot see what points into an old directory and a pristine one that nothing it knows about uses is removed.

Node 20 is retained as a compatibility option but has reached end of life: the October 2026 Node.js security release has no 20.x build, and the installer warns whenever the Portal runs on it. Prefer 24 and move existing Portals after a backup.

## Select a Portal runtime

Fresh installation defaults to Node 24. The bootstrap's advanced `--node-major` option supports 20/22/24/26 when a specific Portal runtime is required. Services, helper commands and global `node`, `npm` and `npx` use the selected runtime; bundled corepack is linked when present. Signed updates preserve `HOSTMGR_NODE_MAJOR`; legacy installations without that setting detect the current runtime instead of forcing 24. The staged installer also detects the existing service runtime when an older updater passes no major. Node 26 selection installs its libatomic1 dependency. Back up state/key before explicitly changing the Portal runtime.

```bash
/opt/node-v20.20.2/bin/node --version
/opt/node-v22.23.4/bin/node --version
/opt/node-v24.22.2/bin/node --version
/opt/node-v26.13.0/bin/node --version
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

## Maintainers: move a pin

Take checksums only from the signed release files, never from a mirror or a search result:

1. Pick the release on [nodejs.org/dist](https://nodejs.org/dist/) and download its `SHASUMS256.txt` and `SHASUMS256.txt.asc`.
2. Verify the signature with `gpg --verify`. The signing key's fingerprint must appear in the release-keys list of the [Node.js README](https://github.com/nodejs/node#release-keys); import that key from [nodejs/release-keys](https://github.com/nodejs/release-keys).
3. Copy the `node-v<version>-linux-x64.tar.xz` hash into `node_pin()` in `strckro.sh` (Node 24 uses `NODE_VERSION` and `NODE_SHA256` at the top of the file) and change the version in `scripts/node-versions.mjs`, the Dockerfile and the tables above. A test fails when these disagree.
4. Run `npm test`, then check an installer update on a host before publishing.

## SQLite and verification

Node 22.13+ uses built-in `node:sqlite`; 20 uses the optional native addon. They share the existing database/schema/key, with no conversion. Node 20 installation may require C/C++ tools and Python if no prebuilt binding exists. Installer preflight opens SQLite in staging before replacing the live app; addon failure must stop installation. Test both drivers and staging backup/restore; synthetic parity tests do not certify production data or host deployment. See [testing](testing.md) and [ADR 0029](../knowledge/adr/0029-selectable-node-runtimes-and-sqlite-adapter.md).
