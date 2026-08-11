# Git, release, and AI handoff playbook

This is the operating guide for changing and publishing **Dashboard Portal itself**. It is separate from syncing or deploying a project managed inside the Portal.

## Source of truth

- Repository: `https://github.com/raptercode/dashboard-portal-control`
- Stable update manifest: `https://github.com/raptercode/dashboard-portal-control/releases/latest/download/stable.json`
- Release archive format: `https://github.com/raptercode/dashboard-portal-control/releases/download/v<VERSION>/dashboard-portal-<VERSION>.tar.gz`
- The installation/update target is Ubuntu 24.04+ with Node.js 24. Docker is only a sandbox test environment.

The installed Portal only reads the public `stable.json` manifest. Every GitHub release must therefore include exactly these assets:

1. `dashboard-portal-<VERSION>.tar.gz`
2. `dashboard-portal-<VERSION>.tar.gz.sha256`
3. `stable.json` (signed)

Do not replace files under an existing tag. Publish a new, increasing SemVer version instead. The `releases/latest/download/...` URL automatically moves to the newest non-draft release.

## Safety rules for a future AI or developer

- Start by checking the repository state. Preserve other people's uncommitted work; do not use `git reset --hard`, force-push, or delete tags/releases.
- Never put a Git token in a repository URL, command arguments recorded in notes, API responses, screenshots, commits, or documentation.
- Never commit, upload, print, or paste the update **private** signing key. The server receives only the public key.
- Release artifacts are built from a clean, committed, tagged worktree. Do not release a local working-tree-only change.
- `package.json` is private; releases are GitHub release assets, not `npm publish` packages.
- A public release repository is intentional: the installed Portal downloads updates without a GitHub credential. If the repository becomes private, the server will receive a not-found/authorization response.
- The web UI may report that an update is available, but updates are deliberately applied over SSH with `sudo dashboard-portal update`. Do not add an in-browser self-update path without a security review and an ADR.

## 1. Inspect before changing anything

From the repository root:

```powershell
git status --short
git remote -v
git branch --show-current
git log -1 --oneline
git tag --points-at HEAD
git diff --check
```

At the time this guide was written, the integration branch was `master`; do not assume that remains true. Capture the current branch once and use it in commands below:

```powershell
$branch = git branch --show-current
```

If `git status --short` is not empty, identify which files belong to the requested change. Do not bundle unrelated edits into a release. If ownership is unclear, stop before committing and hand off the exact status output.

Before a code change, also run the relevant checks. A safe default is:

```powershell
npm test
bash -n dashboard-portal.sh
```

For changes to installer, update, privilege, Nginx, token, or deployment behavior, run both checks and manually inspect the affected command path. Docker results are useful evidence, but do not describe them as production-host acceptance.

## 2. Make the code change and update documentation

Keep scope narrow and add or update tests for behavior changes. When a decision changes a durable boundary, update the corresponding records in the same change:

- `docs/adr/` for a consequential architecture/security decision;
- `docs/context/` for the current operating context;
- `docs/glossary.md` if a new domain term needs a precise shared meaning;
- this guide or `docs/production-install.md` for operational steps.

The control-plane invariants must remain true: the dashboard service is unprivileged, host-changing operations pass through the root-owned allowlisted helper, Nginx configuration is managed-files-only, and stored credentials are encrypted and never returned to the browser.

## 3. Choose and set the next version

Use SemVer and increment the patch version for a compatible fix or ordinary feature. Use a minor or major version only when the user has agreed to the compatibility impact.

Check the current version:

```powershell
node -p "require('./package.json').version"
```

Edit the `version` in `package.json` before committing. For example, change `0.2.4` to `0.2.5`. Do not create a tag until the version, tests, and documentation are final.

Run the release gate again:

```powershell
npm test
bash -n dashboard-portal.sh
git diff --check
git status --short
```

## 4. Commit, tag, and push the exact release source

Stage only the intended files, then create one release commit and an annotated tag. Replace `0.2.5` with the chosen version.

```powershell
git add package.json README.md docs scripts src test
git status --short
git commit -m "release: v0.2.5"
git tag -a v0.2.5 -m "Dashboard Portal v0.2.5"
git push origin $branch
git push origin v0.2.5
```

Do not literally add paths that do not exist; `git add` must be scoped to the actual changed files. Confirm that the tag points at the release commit:

```powershell
git show --no-patch --decorate v0.2.5
git status --short
```

The final status must be clean before building assets. If it is not clean, do not publish the artifact because it cannot be reproduced from the tag.

## 5. Keep the signing key outside Git

The update private key is normally stored only on the release workstation:

```text
C:\\Users\\boyas\\.dashboard-portal\\release-signing\\dashboard-portal-update-private.pem
```

Generate a key pair only for first-time setup or an intentional key rotation:

```powershell
npm run release:keygen -- --out=C:\\Users\\boyas\\.dashboard-portal\\release-signing
```

Back up the private key in an approved secret store. Losing it prevents future signed updates; replacing it requires distributing and configuring a new public key on every installed host. The public key belongs at `/etc/dashboard-portal/update-public-key.pem` on a host; the private key must never be copied there.

## 6. Create the signed release artifacts

Build assets into a directory outside the repository to avoid accidental commits. The archive URL must refer to the tag being prepared, not `latest`.

```powershell
npm run release:prepare -- --out=C:\\Users\\boyas\\.dashboard-portal\\releases\\v0.2.5 --archive-url=https://github.com/raptercode/dashboard-portal-control/releases/download/v0.2.5/dashboard-portal-0.2.5.tar.gz --private-key=C:\\Users\\boyas\\.dashboard-portal\\release-signing\\dashboard-portal-update-private.pem --notes="Describe the user-visible change"
```

This creates the archive, its SHA-256 checksum, and a signed `stable.json`.
The archive is built with `git archive HEAD`, so it contains only the tagged
Git content and keeps LF shell-script bytes intact even when prepared on
Windows. Check the output and checksum before upload:

```powershell
Get-ChildItem C:\\Users\\boyas\\.dashboard-portal\\releases\\v0.2.5
Get-FileHash C:\\Users\\boyas\\.dashboard-portal\\releases\\v0.2.5\\dashboard-portal-0.2.5.tar.gz -Algorithm SHA256
tar -tzf C:\\Users\\boyas\\.dashboard-portal\\releases\\v0.2.5\\dashboard-portal-0.2.5.tar.gz
```

The SHA-256 printed by `Get-FileHash` must match the contents of the generated `.sha256` file. Do not hand-edit `stable.json`: its signature would no longer validate.

## 7. Publish the GitHub release

With GitHub CLI authenticated to the correct account, publish the three generated assets to the already-pushed tag:

```powershell
gh release create v0.2.5 C:\\Users\\boyas\\.dashboard-portal\\releases\\v0.2.5\\dashboard-portal-0.2.5.tar.gz C:\\Users\\boyas\\.dashboard-portal\\releases\\v0.2.5\\dashboard-portal-0.2.5.tar.gz.sha256 C:\\Users\\boyas\\.dashboard-portal\\releases\\v0.2.5\\stable.json --repo raptercode/dashboard-portal-control --title "Dashboard Portal v0.2.5" --notes "Describe the user-visible change" --verify-tag
```

Verify the release and the permanent manifest redirect:

```powershell
gh release view v0.2.5 --repo raptercode/dashboard-portal-control
curl.exe -I -L https://github.com/raptercode/dashboard-portal-control/releases/latest/download/stable.json
curl.exe -L https://github.com/raptercode/dashboard-portal-control/releases/latest/download/stable.json
```

The manifest must report the version just released, an HTTPS archive URL for that same tag, a SHA-256 value, and a signature. Never configure hosts with a pinned `releases/download/vX.Y.Z/stable.json` URL; configure the permanent `releases/latest/download/stable.json` URL once.

## 8. Verify from an installed host

For an existing configured installation, no manifest reconfiguration is necessary for subsequent releases:

```bash
sudo dashboard-portal update --channel=stable --check
sudo dashboard-portal update --channel=stable
sudo dashboard-portal update --channel=stable --check
sudo systemctl is-active dashboard-portal hostmgr-deploy-helper nginx
curl -fsS https://YOUR-DOMAIN/api/health
```

The first check should report the new version as available; after the update, it should report `available: false`. If the update fails, do not retry blindly. Preserve the error, inspect the service logs, and verify the GitHub assets, checksum, manifest signature, and systemd state:

```bash
sudo journalctl -u dashboard-portal -u hostmgr-deploy-helper --since "30 minutes ago" --no-pager
```

For a fresh host, configure the update feed once after installation, using a temporary copy of the **public** key only:

```bash
sudo dashboard-portal configure-update --manifest=https://github.com/raptercode/dashboard-portal-control/releases/latest/download/stable.json --public-key=/path/to/dashboard-portal-update-public.pem --channel=stable
sudo dashboard-portal update --channel=stable --check
```

## Project repositories are a separate workflow

Portal software releases above update the Dashboard Portal. They do not upload or deploy a customer project. For a project managed in the Portal:

- public GitHub repository: use HTTPS, repository URL without tokens, and the correct branch (often `main`);
- private repository: store a credential securely in the Portal and use it by its selected credential ID;
- configure Git identity for commits, then sync the project;
- set each project's environment independently. If no values are supplied, the Portal defaults to `NODE_ENV=production`;
- deploy only after sync succeeds and read the release failure detail before changing configuration.

## Required handoff note for the next AI

At the end of a change, leave a concise factual handoff in the task or commit/PR description containing:

1. repository, working branch, commit SHA, and release tag (if published);
2. exact commands run and their result, especially `npm test` and installer syntax checks;
3. published release URL and the version reported by `dashboard-portal update --check`;
4. whether production-host validation was performed or only Docker/local validation;
5. every remaining known limitation, failed check, and the next safe action;
6. changed ADR/context/glossary documents; and
7. confirmation that no credential, password, token, or private signing key was exposed.

This record lets the next AI continue from evidence rather than assumptions.
