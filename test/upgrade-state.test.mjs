import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('synthetic encrypted SQLite state survives consistent snapshot restore with grants and selected major', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dashboard-portal-readiness-state-'));
  const fixture = fileURLToPath(new URL('./support/upgrade-state-fixture.mjs', import.meta.url));
  const run = (...args) => {
    const result = spawnSync(process.execPath, [fixture, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  try {
    const seed = run('seed', join(directory, 'state.sqlite'), join(directory, 'backup.sqlite'));
    assert.equal(seed.schemaVersion, 4);
    assert.ok(seed.snapshotBytes > 0);
    const restored = run('verify', join(directory, 'backup.sqlite'));
    assert.equal(restored.fixtureVisits, 1);
    const reopened = run('verify', join(directory, 'backup.sqlite'));
    assert.equal(reopened.fixtureVisits, 2);
    assert.ok(reopened.checks.includes('wrong-key-rejection'));
    for (const check of ['restored-session-http', 'member-login-http', 'master-login-http', 'authorized-environment-read-http', 'denied-environment-write-http']) assert.ok(reopened.checks.includes(check), check);
    assert.deepEqual(reopened.counts, { users: 2, organizations: 1, memberships: 1, projects: 1, credentials: 1, preservedSessions: 1 });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
