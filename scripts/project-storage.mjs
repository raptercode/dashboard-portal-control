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

// ---------------------------------------------------------------------------------------------
// Status: read-only, for the Storage tab of an application.
//
// The same rule as above applies. Root only calls lstat/readlink. Counting what is inside the
// folder goes through `runAsProject`, because the application can put anything in there, including
// a link to a path it should not see; find and df run as the project's own user and never follow one.

/** `df --output=size,avail --block-size=1` prints a header and one row of two numbers. */
export function parseSpace(output) {
  const lines = String(output ?? '').trim().split('\n');
  const values = lines.length > 1 ? lines.at(-1).trim().split(/\s+/) : [];
  if (values.length !== 2 || !values.every((value) => /^\d+$/.test(value))) return null;
  return { totalBytes: Number(values[0]), availableBytes: Number(values[1]) };
}

/**
 * Adds one line of `find -printf "%y %s\n"` ("f 1500", "d 4096", "l 12") to the running totals.
 * Only regular files add to the size: a folder's own size is a file-system detail, not something stored.
 */
export function addEntry(total, line) {
  const match = String(line).match(/^([A-Za-z]) (\d+)$/);
  if (!match) throw new Error('Storage listing could not be read.');
  total.entries += 1;
  if (match[1] === 'f') total.bytes += Number(match[2]);
  return total;
}

/**
 * Size of the storage folder: bytes in regular files, how many items it holds (files, folders and
 * links, not counting the folder itself) and the space left on its disk. Throws when a number is
 * missing. `find` never follows a link and -xdev never leaves the filesystem, so the walk stays
 * inside the folder. `scanAsProject` streams the listing line by line, so a folder with millions of
 * files is counted without holding the list in memory.
 */
export async function measureStorage({ directory, scanAsProject, runAsProject }) {
  const total = { entries: 0, bytes: 0 };
  await scanAsProject('/usr/bin/find', [directory, '-xdev', '-printf', '%y %s\n'], (line) => addEntry(total, line));
  const space = parseSpace(await runAsProject('/usr/bin/df', ['--output=size,avail', '--block-size=1', '--', directory]));
  if (total.entries < 1 || !space) throw new Error('Storage usage could not be read.');
  return { bytes: total.bytes, items: total.entries - 1, ...space };
}

/**
 * What the Portal shows for one project:
 *   configured  the project has a storage path
 *   deployed    a release is live (`current` exists)
 *   mounted     the live release links <path> to the storage folder; false means the next deployment applies it
 *   exists      the storage folder exists (it is created by the first deployment that has a path)
 *   measured    usage is present; false when the folder is missing or counting failed or timed out
 */
export async function storageStatus({ identity, storagePath, currentRelease, scanAsProject, runAsProject, inspect = lstat, readLink = readlink }) {
  const path = validateStoragePath(storagePath);
  if (!path) return { configured: false };
  const directory = storageDirectory(identity);
  const status = { configured: true, path, directory, deployed: Boolean(currentRelease), mounted: false, exists: false, measured: false, usage: null };
  if (currentRelease) {
    const link = join(currentRelease, ...path.split('/'));
    const entry = await inspect(link).catch(() => null);
    status.mounted = Boolean(entry?.isSymbolicLink()) && await readLink(link).catch(() => null) === directory;
  }
  const folder = await inspect(directory).catch(() => null);
  status.exists = Boolean(folder?.isDirectory());
  if (!status.exists) return status;
  try {
    status.usage = await measureStorage({ directory, scanAsProject, runAsProject });
    status.measured = true;
  } catch { /* the folder is there but could not be counted; the caller reports that, not an error */ }
  return status;
}
