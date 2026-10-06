# Node.js projects using pnpm

[ภาษาไทย](../../th/how-to/pnpm-projects.md)

pnpm is optional. Installing or updating Dashboard Portal does not install it.
Existing npm and Bun projects do not require pnpm. In **Setup**, the owner can
explicitly install pnpm 11.19.0, or prepare a compatible installation over SSH.
The Setup action requires Node 22.13 or newer. The executable must be available
at `/usr/local/bin/pnpm` to the Portal and project service users.

```bash
sudo /usr/local/bin/npm install --global --prefix /usr/local --ignore-scripts pnpm@11.19.0
/usr/local/bin/pnpm --version
```

Choose **Node.js** as the project runtime, then pin the package manager in the
application's `package.json`:

```json
{
  "packageManager": "pnpm@11.19.0",
  "scripts": { "build": "your-build-command", "start": "node dist/main.js" }
}
```

An explicit npm declaration takes precedence over a leftover pnpm lockfile.
Without a declaration, `pnpm-lock.yaml` selects pnpm; otherwise Node projects
continue to use npm. Detection is relative to the selected project directory:
select the workspace root when the lockfile and workspace settings live there.

The host pnpm version must match an exact `pnpm@major.minor.patch` declaration.
Portal supports pnpm 8–11; pnpm 11 requires the project's Node 22/24/26 runtime.
Other pins, including tags, ranges and Corepack integrity suffixes, produce an
actionable error rather than selecting an arbitrary package manager version.
Without a pin, the installed supported version is used. There is one shared
host installation, so coordinate upgrades across apps. Portal never installs
or switches pnpm during deployment, build, startup or rollback.

When a lockfile exists, deployment runs a frozen install including development
dependencies needed for builds. A stale pnpm lockfile fails the candidate;
update and commit it locally. Without a lockfile, installation can resolve a
new tree inside the candidate only. Commit the lockfile for reproducibility.
Portal does not bypass peer-dependency checks or approve dependency build
scripts; review the app's `pnpm-workspace.yaml` settings yourself.

Install, build and candidate startup use the selected package manager. Host
services and rollback also use the installed pnpm with the release's Node
major. Automatic manager downloads and pnpm's implicit dependency installation
before `run` are disabled. Relative dependency links are preserved when moving
the candidate to the runtime directory. Dependency failures retain redacted,
bounded command output in the deployment log.

If deployment reports a missing or mismatched pnpm installation, install the
required version explicitly and retry. Updating Portal alone does not resolve
application dependency conflicts. Verify build, tests and a meaningful health
endpoint before activating an application.
