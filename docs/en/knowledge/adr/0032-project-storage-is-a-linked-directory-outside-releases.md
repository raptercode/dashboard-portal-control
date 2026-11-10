# ADR 0032: Project storage is a linked directory outside releases

[ภาษาไทย](../../../th/knowledge/adr/0032-project-storage-is-a-linked-directory-outside-releases.md)


- Status: Accepted
- Date: 2026-11-08

## Context

An application runs with `WorkingDirectory=<project root>/current`, and `current` points at a release directory that every deployment replaces; `pruneHistoricalReleases` deletes all but the active and the previous release. Anything an application writes next to its code (uploads, a local database, generated images) is lost at the next deploy or rollback. The architecture already says persistent application data must be separate from releases, but a project had no supported place for it. `projectIdentity().shared` named `<root>/shared` without anything using it.

The owner asked for a way to "mount" storage so uploads survive. Applications commonly hard-code a relative path such as `./uploads`.

## Decision

A native project may set one `storagePath`: a relative folder inside the app (`uploads`, `public/uploads`). The helper keeps one directory per project, `<project root>/shared/storage`, and replaces `<release>/<storagePath>` with a symbolic link to it every time it prepares a release, at deploy and at rollback.

- The path is validated in the same module (`scripts/project-storage.mjs`) by the API, when the project is synced, and by the root helper, which re-reads the project from SQLite. It must be relative, at most five segments, each matching `[A-Za-z0-9_][A-Za-z0-9._-]*`; `node_modules`, `vendor`, `venv` and `hostmgr-app` are reserved.
- A symbolic link was chosen over a systemd `BindPaths=` mount. It leaves the sandbox that every project unit already has unchanged (`ProtectSystem=strict`, `ReadWritePaths=<root>`), behaves the same for every runtime including Bun's own bind of the release, and can be exercised for real on any Linux machine. A bind mount would change every unit and needs a systemd host to test.
- The helper runs as root, while the release tree is owned by the project user and contains code the Portal did not write. Every change under it (creating the folder, removing a shipped folder or link, creating the link) is made by spawning `mkdir`, `rm` and `ln` as the project's own uid and gid. The module imports only `lstat` and `readlink`, and a test enforces that. A link planted in a release therefore cannot redirect a root write.
- A real file at the mount path stops the deployment; it is never deleted. A folder or link the repository ships is replaced.
- Docker Compose projects are excluded: they use named volumes, and host bind mounts remain rejected (ADR 0021). The setting is part of project configuration, so changing it needs `project.configure`. A sync that omits the key keeps the stored value, which keeps the CLI working; an empty value turns storage off.

## Consequences

- Uploads survive Restart, deploy, rollback and pruning without an application change.
- The storage is part of the project root, so deleting the project deletes it. The delete confirmation names the path.
- Turning the mount on does not move files an application already wrote into the active release. The how-to gives the one-time copy command.
- There is no quota, replication or backup, and the existing recursive `chown` of the project root on every deploy grows with the number of stored files.
- Not verified: a real systemd host. The link creation was exercised as a non-root user on Ubuntu under WSL2, and the generated unit is unchanged.

## Addendum (2026-11-10): reading the storage

The application sheet has a read-only **Storage** tab (`GET /api/projects/<slug>/storage`, `project.view`) fed by the helper operation `project-storage-status`. It keeps the rule above. Root only calls `lstat` and `readlink` (is the live release linked to the storage folder, does the folder exist). Counting the folder runs `find` and `df` as the project's own uid and gid, because the application controls what is in it: `find` does not follow links and stays on one file system, and the listing is streamed so a large folder is never held in memory. The helper stops counting after 20 seconds and the Portal shares one reading for five seconds. Only regular files add to the size, so an empty folder reads 0 bytes whatever size the file system gives a folder. The tab shows no file names and changes nothing. Listing, downloading, uploading or deleting files through the Portal would need its own decision: path and link handling, size limits and a separate permission.
