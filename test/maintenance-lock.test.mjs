import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, chmod, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { acquireMaintenanceLease, withMaintenanceLease } from '../scripts/maintenance-lock.mjs';

const linux = process.platform === 'linux';
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'portal-maintenance-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await chmod(root, 0o750);
  const lockPath = join(root, 'operations.lock');
  await writeFile(lockPath, '', { mode: 0o660 });
  return { lockPath, expectedUid: process.getuid() };
}
const exclusive = (path) => spawnSync('/usr/bin/flock', ['--exclusive', '--nonblock', '--conflict-exit-code', '75', path, '/bin/true']).status;

test('shared operation leases exclude installer, coexist, and release before returning', { skip: !linux }, async (t) => {
  const options = await fixture(t);
  const first = await acquireMaintenanceLease(options);
  const second = await acquireMaintenanceLease(options);
  try {
    assert.equal(exclusive(options.lockPath), 75);
    await first.release();
    assert.equal(exclusive(options.lockPath), 75);
    await second.release();
    assert.equal(exclusive(options.lockPath), 0);
    assert.equal(await withMaintenanceLease(async () => {
      assert.equal(exclusive(options.lockPath), 75);
      return 'completed';
    }, options), 'completed');
    assert.equal(exclusive(options.lockPath), 0);
    await assert.rejects(withMaintenanceLease(async () => { throw new Error('operation failed'); }, options), /operation failed/);
    assert.equal(exclusive(options.lockPath), 0);
  } finally {
    await first.release();
    await second.release();
  }
});

test('exclusive installer lock rejects operations without running their callback', { skip: !linux }, async (t) => {
  const options = await fixture(t);
  const holder = spawn('/usr/bin/flock', ['--exclusive', options.lockPath, '/bin/sh', '-c', 'printf "ready\\n"; while IFS= read -r line; do :; done'], { stdio: ['pipe', 'pipe', 'ignore'] });
  const exited = once(holder, 'exit');
  await once(holder.stdout, 'data');
  let ran = false;
  try {
    await assert.rejects(withMaintenanceLease(async () => { ran = true; }, options), (error) => error.code === 'MAINTENANCE_BUSY');
    assert.equal(ran, false);
  } finally {
    holder.stdin.end();
    await exited;
  }
});

test('operation process crash releases lock without removing inode or stale-file cleanup', { skip: !linux }, async (t) => {
  const options = await fixture(t);
  const moduleUrl = new URL('../scripts/maintenance-lock.mjs', import.meta.url).href;
  const child = spawn(process.execPath, ['--input-type=module', '-e', `import { acquireMaintenanceLease } from ${JSON.stringify(moduleUrl)}; await acquireMaintenanceLease(${JSON.stringify(options)}); console.log('ready'); setInterval(() => {}, 1000);`], { stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(child, 'exit');
  await once(child.stdout, 'data');
  assert.equal(exclusive(options.lockPath), 75);
  child.kill('SIGKILL');
  await exited;
  const deadline = Date.now() + 3000;
  let status;
  do {
    status = exclusive(options.lockPath);
    if (status !== 0) await new Promise((resolve) => setTimeout(resolve, 20));
  } while (status !== 0 && Date.now() < deadline);
  assert.equal(status, 0);
  const lease = await acquireMaintenanceLease(options);
  await lease.release();
});

test('unsafe owner, symlink, missing file and writable parent fail closed', { skip: !linux }, async (t) => {
  const options = await fixture(t);
  await assert.rejects(acquireMaintenanceLease({ ...options, expectedUid: options.expectedUid + 1 }), /directory.*unsafe/);
  await rm(options.lockPath);
  await assert.rejects(acquireMaintenanceLease(options), /unavailable/);
  const target = join(join(options.lockPath, '..'), 'target');
  await writeFile(target, '', { mode: 0o660 });
  await symlink(target, options.lockPath);
  await assert.rejects(acquireMaintenanceLease(options), /unavailable/);
  await rm(options.lockPath);
  await writeFile(options.lockPath, '', { mode: 0o660 });
  await chmod(join(options.lockPath, '..'), 0o770);
  await assert.rejects(acquireMaintenanceLease(options), /directory.*unsafe/);
});
