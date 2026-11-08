# Persistent storage for uploads and other files

[ภาษาไทย](../../th/how-to/project-storage.md) · [Documentation index](../README-index.md)

Every deployment creates a new release directory and the Portal deletes old ones (it keeps the active release and the previous one for rollback). A file an application writes inside its own directory, such as `./uploads/photo.jpg`, therefore survives a plain **Restart** but disappears at a later **deploy** or **rollback**.

Set a **Mount path** on the project to keep such files:

1. Open the project, **Edit application**, step **Source & runtime**, and fill **Persistent storage → Mount path** with a folder inside the app, for example `uploads` or `public/uploads`. Leave it empty to turn storage off.
2. Save and sync, then **deploy**. The setting applies to the next deployment; Restart does not re-link an existing release.
3. The application keeps using the relative path (`./uploads`). It needs no code change and no environment variable.

Works for Node.js, Bun, Go, Python and PHP services and for workers. Docker Compose projects are not supported here: declare a named volume in the Compose file instead (host bind mounts stay rejected). Changing the setting needs the `project.configure` permission.

## What it does on the host

- The files live in one directory per project, `/srv/hostmgr/projects/<slug>/shared/storage`, outside `releases/`. Pruning, rollback and Restart never touch it.
- For every release the Portal replaces `<release>/<mount path>` with a symbolic link to that directory. It does this when it prepares the release at deploy and again at rollback, so an older release also gets the link.
- Existing content: a folder with the same name that the repository ships is replaced in the release (the repository copy is hidden, as a volume would hide it). A **file** with that name stops the deployment with an error and is left alone.
- The path is relative to the app folder, at most five folders, each made of letters, digits, `.`, `-` or `_` and not starting with a dot. `node_modules`, `vendor`, `venv` and `hostmgr-app` are refused because the runtimes need those names.
- The link and the folder are created by the project's own Unix user, not by root, so a link inside a release cannot make the Portal's privileged helper touch anything the project could not already touch. The service can write only under its project directory, which includes this folder.

## Moving files that already exist

Turning the mount on does not copy files an application already wrote into the active release. Deploy once with the path set; the release it replaced is then the previous release and still on disk. Copy its folder before the next deploy removes it:

```sh
sudo cp -a /srv/hostmgr/projects/<slug>/releases/<previous-release-id>/uploads/. /srv/hostmgr/projects/<slug>/shared/storage/
```

The release ids are in the project's deployment history.

## What it does not do

- It is plain disk on the host: no quota, no replication and no backup. Back up `/srv/hostmgr/projects/<slug>/shared/storage` yourself.
- **Deleting the application deletes its storage.** The confirmation says so when a mount path is set.
- It does not serve the files. The application decides what is public.
- One mount path per project. Removing the path stops new releases from linking it; the directory and its files stay on disk.
- Each deployment re-owns the project directory recursively, which includes this folder, so a very large number of files makes deployment slower.

See [ADR 0032](../knowledge/adr/0032-project-storage-is-a-linked-directory-outside-releases.md) for the reasoning.
