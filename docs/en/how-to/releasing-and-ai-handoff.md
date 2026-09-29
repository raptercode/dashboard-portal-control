# Git, signed releases, and handoff

[ภาษาไทย](../../th/how-to/releasing-and-ai-handoff.md)


This guide publishes **Dashboard Portal itself**. Project deployments inside
the Portal and production-host updates are separate operations.

## Contract

- Repository: [raptercode/dashboard-portal-control](https://github.com/raptercode/dashboard-portal-control).
- Stable feed: [latest/download/stable.json](https://github.com/raptercode/dashboard-portal-control/releases/latest/download/stable.json).
- Every release contains exactly three assets: `dashboard-portal-<VERSION>.tar.gz`,
  its `.sha256`, and signed `stable.json`.
- Publish a new increasing version; never replace assets under an existing tag.
- Build from a clean, committed, tagged checkout. Preserve unrelated work by
  using a separate checkout of the release commit when necessary.
- Keep tokens and private signing keys out of Git, archives, logs and process
  arguments. Hosts receive only the public key.
- `package.json` is private: publish GitHub assets, not an npm package.
- Release authorization does not authorize updating an installed production host.

Host support and runtime pins are documented in
[production installation](../../th/how-to/production-install.md) and [Node versions](../../th/how-to/node-versions.md).

## 1. Inspect and prepare

```powershell
git status --short
git remote -v
git branch --show-current
git log -1 --oneline
git fetch origin
gh release list --repo raptercode/dashboard-portal-control --limit 5
```

Confirm the actual integration branch (historically `master`), current remote
HEAD, file ownership and latest published version. Stage only requested work.

Use a patch increment for compatible fixes and ordinary features. Discuss
compatibility impact before a minor/major bump. Update package.json,
package-lock.json and release documentation together. Add an ADR for a
consequential architecture/security decision and keep current context accurate.

Preserve the unprivileged Portal/root-helper boundary, managed Nginx ownership
and encrypted secrets. Repository credentials are never returned to browsers;
project environment values require explicit access grants.

## 2. Validate the candidate

```powershell
npm ci
npm test
bash -n install.sh dashboard-portal.sh
npm run docs:check
git diff --check
```

Use Git Bash on Windows for shell syntax. Exercise supported Node drivers when
changing database/runtime behavior. Inspect installer/updater/helper changes
and run relevant behavioral tests. Record what actually ran and distinguish
local tests from Ubuntu systemd/Nginx/TLS/reboot acceptance.

Check documentation links, package/lock versions, staged diff and absence of
secrets before committing. Never include an unrelated file just to clean status.

## 3. Commit, tag and push

Set `$version` from the final package version and `$branch` from the inspected
integration branch. Stage the exact intended paths, then:

```powershell
$version = node -p "require('./package.json').version"
$branch = git branch --show-current
git diff --cached --stat
git commit -m "release: v$version"
git tag -a "v$version" -m "Dashboard Portal v$version"
git push origin $branch
git push origin "v$version"
git show --no-patch --decorate "v$version"
```

Use a clean checkout of this tag for the following build. Confirm package and
lock versions equal the tag and that `git status --short` is empty.

## 4. Sign outside the repository

The release workstation keeps its existing Ed25519 private key outside Git,
normally under `$HOME\.dashboard-portal\release-signing`. Verify its derived
public key matches `scripts/dashboard-portal-update-public.pem` without printing
private material. Do not regenerate the key for an ordinary release; a rotation
requires distributing a new trusted public key to installed hosts.

From the clean release checkout:

```powershell
$version = node -p "require('./package.json').version"
$releaseDir = Join-Path $HOME ".dashboard-portal\releases\v$version"
$env:DASHBOARD_PORTAL_UPDATE_PRIVATE_KEY_PATH = Join-Path $HOME '.dashboard-portal\release-signing\dashboard-portal-update-private.pem'
try {
  npm run release:prepare -- "--out=$releaseDir" "--archive-url=https://github.com/raptercode/dashboard-portal-control/releases/download/v$version/dashboard-portal-$version.tar.gz" --notes="Describe the user-visible change"
} finally {
  Remove-Item Env:DASHBOARD_PORTAL_UPDATE_PRIVATE_KEY_PATH
}
```

The script archives committed `HEAD` with Git, preserving shell-script LF bytes.
Verify all of these before uploading:

- Signature parses with `parseSignedManifest` from `scripts/software-update.mjs`
  and the tracked public key.
- Manifest metadata is inside `payload`: version, channel, archiveUrl and archiveSha256.
- Actual archive SHA-256 matches both `payload.archiveSha256` and the checksum file.
- Archive source matches the tag; required source, lockfile, LICENSE and docs
  exist; no private key, .env, state, node_modules or output archives are included.

Do not hand-edit the signed manifest.

## 5. Publish and verify downloaded assets

Write human-readable release notes to a file outside the checkout, then:

```powershell
gh release create "v$version" "$releaseDir\dashboard-portal-$version.tar.gz" "$releaseDir\dashboard-portal-$version.tar.gz.sha256" "$releaseDir\stable.json" --repo raptercode/dashboard-portal-control --title "Dashboard Portal v$version" --notes-file "$releaseDir\release-notes.md" --verify-tag
gh release view "v$version" --repo raptercode/dashboard-portal-control
```

Download the published assets into a fresh directory and repeat signature/hash
verification. Fetch the permanent stable feed and confirm it reports this
version and the immutable tag archive URL. Confirm remote tag/branch SHAs and
that the release is neither draft nor prerelease.

Before validating the public installation commands, publish the reviewed [bootstrap endpoint](bootstrap-hosting.md) separately and verify its bytes. A Git commit alone does not serve `install.sh` at the public domain.

## 6. Host verification only when authorized

Use the [installation guide](../../th/how-to/production-install.md) for backup,
`update --check`, update, service/API/static checks and recovery. Never report a
host update or acceptance test that was not run. A published release can be
complete with an explicitly recorded host-validation limitation.

## Completion record

Leave a concise handoff with branch, commit, tag, release URL, exact test results,
signature/hash verification, changed ADR/context documents and remaining
limitations. Include the installed version only if checked on the host. Confirm
no credentials or private key material were included in source/artifacts.

Project source sync, project environment changes and project deployment remain
their own workflow; publishing Portal software does not activate customer apps.
