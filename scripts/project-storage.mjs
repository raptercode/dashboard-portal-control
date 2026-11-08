import { lstat, readlink } from 'node:fs/promises';
import { posix } from 'node:path';

// Host paths are always POSIX, whatever machine the tests run on.
const { dirname, join } = posix;

// Persistent project storage.
//
// A release directory is replaced by every deployment and old releases are deleted, so anything an
// application writes inside it (uploads, a local SQLite file, generated images) is lost on the next
// deploy or rollback. A project that sets a storage path gets one directory outside releases/:
//
//   <project root>/shared/storage          survives deploys, rollbacks, restarts and pruning
//   <release>/<storage path>  ->  symlink to the directory above, created for every release
//
// The application keeps using a relative path such as ./uploads and needs no code change.
//
// Why a symlink and not a systemd BindPaths= mount: it changes nothing in the unit sandbox that every
// project already runs under, it works the same for every runtime (including Bun's own bind of the
// release), and it can be exercised on any Linux machine without a systemd host.
//
// The helper that calls mountProjectStorage runs as root, while the release tree is owned by the
// project user and holds code the Portal did not write. Every change to that tree is therefore made
// through `runAsProject`, a callback that spawns the command as the project's own Unix user. A link
// planted inside a release can then only let the project act on files it already owns; root never
// follows it. The only thing root does is read metadata with lstat to decide what to do.

export const STORAGE_DIRECTORY = ['shared', 'storage'];
export const MAX_STORAGE_PATH_SEGMENTS = 5;

// Directories the runtimes create or need inside a release. Replacing one with the storage link
// would break the application, so they are refused instead of silently honoured.
const RESERVED_SEGMENTS = new Set(['node_modules', 'vendor', 'venv', 'hostmgr-app']);
const SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,63}$/;

/**
 * Returns the normalized storage path, or null when the project has no persistent storage.
 * Throws an Error with a message that is safe to show to the owner.
 */
export function validateStoragePath(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new Error('Storage path must be text.');
  const typed = value.trim();
  if (typed.startsWith('/')) throw new Error('Storage path is relative to the app folder (for example uploads). Absolute paths are not supported.');
  const path = typed.replace(/^\.\//, '').replace(/\/+$/, '');
  if (path === '') return null;
  if (path.length > 160) throw new Error('Storage path is too long.');
  const segments = path.split('/');
  if (segments.length > MAX_STORAGE_PATH_SEGMENTS) throw new Error(`Storage path can have at most ${MAX_STORAGE_PATH_SEGMENTS} folders.`);
  for (const segment of segments) {
    if (!SEGMENT.test(segment)) throw new Error('Storage path must be a folder inside the app, such as uploads or public/uploads. Use letters, digits, dot, dash or underscore; do not start a folder name with a dot and do not use absolute paths.');
    if (RESERVED_SEGMENTS.has(segment.toLowerCase())) throw new Error(`Storage path cannot use "${segment}" because the runtime needs that name inside the release.`);
  }
  return path;
}

export function storageDirectory(identity) {
  return join(identity.root, ...STORAGE_DIRECTORY);
}

/**
 * Makes `<releaseRoot>/<storagePath>` a link to the project's persistent storage directory. Safe to
 * run again on the same release (a rollback prepares an old release). Returns true when it changed
 * something.
 */
export async function mountProjectStorage({ identity, releaseRoot, storagePath, runAsProject, inspect = lstat, readLink = readlink }) {
  const path = validateStoragePath(storagePath);
  if (!path) return false;
  const storage = storageDirectory(identity);
  const link = join(releaseRoot, ...path.split('/'));

  await runAsProject('/usr/bin/mkdir', ['-p', '-m', '0750', '--', storage]);

  const existing = await inspect(link).catch(() => null);
  if (existing?.isSymbolicLink() && await readLink(link).catch(() => null) === storage) return false;
  // A real file is the repository's own content, not something to delete.
  if (existing && !existing.isDirectory() && !existing.isSymbolicLink()) throw new Error(`The storage path "${path}" is a file in the release. Choose a folder name that the repository does not use.`);
  // A folder that the repository ships is replaced, as a volume would hide it. A link already in the
  // release (from a repository, or an older storage path) is replaced too.
  if (existing?.isDirectory()) await runAsProject('/usr/bin/rm', ['-rf', '--', link]);
  else if (existing) await runAsProject('/usr/bin/rm', ['-f', '--', link]);
  await runAsProject('/usr/bin/mkdir', ['-p', '--', dirname(link)]);
  await runAsProject('/usr/bin/ln', ['-s', '--', storage, link]);
  return true;
}
