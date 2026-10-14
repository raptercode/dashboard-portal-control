import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { dirname } from 'node:path';
import { spawn } from 'node:child_process';

export const MAINTENANCE_LOCK_PATH = '/run/dashboard-portal-maintenance/operations.lock';
const HOLDER_SCRIPT = '/usr/bin/flock --shared --nonblock --conflict-exit-code 75 3 || exit $?; printf "PORTAL_LOCK_READY\\n"; while IFS= read -r line; do :; done';

export class MaintenanceLockError extends Error {
  constructor(message, code = 'MAINTENANCE_UNAVAILABLE') {
    super(message);
    this.name = 'MaintenanceLockError';
    this.code = code;
  }
}

// The root-owned directory prevents replacement of the inode while a lease is
// held. flock owns an inherited descriptor, never a second pathname lookup.
export async function acquireMaintenanceLease({ lockPath = MAINTENANCE_LOCK_PATH, expectedUid = 0, timeoutMs = 5000 } = {}) {
  if (process.platform !== 'linux') throw new MaintenanceLockError('Host maintenance locking requires Linux.');
  const parent = await lstat(dirname(lockPath)).catch(() => null);
  if (!parent?.isDirectory() || parent.uid !== expectedUid || (parent.mode & 0o022)) {
    throw new MaintenanceLockError('Host maintenance lock directory is unavailable or unsafe.');
  }
  let handle;
  try {
    handle = await open(lockPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const info = await handle.stat();
    if (!info.isFile() || info.uid !== expectedUid || info.nlink !== 1 || (info.mode & 0o007)) {
      throw new MaintenanceLockError('Host maintenance lock file is unsafe.');
    }
    return await startHolder(handle, timeoutMs);
  } catch (error) {
    if (error instanceof MaintenanceLockError) throw error;
    throw new MaintenanceLockError('Host maintenance locking is unavailable.');
  } finally {
    await handle?.close();
  }
}

async function startHolder(handle, timeoutMs) {
  const child = spawn('/bin/sh', ['-c', HOLDER_SCRIPT], { stdio: ['pipe', 'pipe', 'ignore', handle.fd] });
  // Closing the parent's write end (including a process crash) releases the
  // holder. The child exits naturally; no persistent PID or stale lock files.
  child.stdin.on('error', () => {});
  let ready = false;
  let releasing = false;
  let lost = false;
  let output = '';
  let resolveExit;
  const exited = new Promise((resolve) => { resolveExit = resolve; });
  const acquired = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new MaintenanceLockError('Host maintenance lock acquisition timed out.'));
    }, timeoutMs);
    child.once('error', () => {
      clearTimeout(timer);
      resolveExit();
      reject(new MaintenanceLockError('Host maintenance locking is unavailable.'));
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      lost = ready && !releasing;
      resolveExit();
      if (!ready) reject(new MaintenanceLockError(code === 75 ? 'Portal maintenance is in progress. Retry after the update completes.' : 'Host maintenance locking is unavailable.', code === 75 ? 'MAINTENANCE_BUSY' : 'MAINTENANCE_UNAVAILABLE'));
    });
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
      if (output === 'PORTAL_LOCK_READY\n' && !ready) {
        ready = true;
        clearTimeout(timer);
        resolve();
      } else if (output.length > 128) {
        child.kill('SIGKILL');
      }
    });
  });
  try {
    await acquired;
  } catch (error) {
    child.stdin.end();
    await exited;
    throw error;
  }
  let releasePromise;
  return {
    assertHeld() {
      if (lost || releasing) throw new MaintenanceLockError('Host maintenance lock was lost.');
    },
    release() {
      if (!releasePromise) {
        releasing = true;
        child.stdin.end();
        releasePromise = exited;
      }
      return releasePromise;
    }
  };
}

export async function withMaintenanceLease(operation, options) {
  const lease = await acquireMaintenanceLease(options);
  try {
    lease.assertHeld();
    const result = await operation();
    lease.assertHeld();
    return result;
  } finally {
    await lease.release();
  }
}
