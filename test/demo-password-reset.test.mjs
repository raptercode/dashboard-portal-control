import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { hashPassword, verifyPassword } from '../src/auth.mjs';
import { resetDemoOwnerPassword } from '../scripts/reset-demo-password.mjs';

test('demo password reset keeps the owner and invalidates local sessions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dashboard-portal-demo-reset-'));
  const databasePath = join(directory, 'state.sqlite');
  const setup = new DatabaseSync(databasePath);
  setup.exec(`
    CREATE TABLE portal_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE sessions (id_hash TEXT PRIMARY KEY, payload TEXT NOT NULL);
    CREATE TABLE audit_events (id TEXT PRIMARY KEY, occurred_at TEXT NOT NULL, payload TEXT NOT NULL);
  `);
  setup.prepare('INSERT INTO portal_meta (key, value) VALUES (?, ?)').run('owner', JSON.stringify({ email: 'owner@local.test', password: hashPassword('BeforeReset1!') }));
  setup.prepare('INSERT INTO sessions (id_hash, payload) VALUES (?, ?)').run('session', '{}');
  setup.close();
  const result = resetDemoOwnerPassword({ databasePath, password: 'AfterReset2!' });
  assert.equal(result.email, 'owner@local.test');
  const database = new DatabaseSync(databasePath);
  const owner = JSON.parse(database.prepare('SELECT value FROM portal_meta WHERE key = ?').get('owner').value);
  assert.equal(verifyPassword('AfterReset2!', owner.password), true);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM sessions').get().count, 0);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE payload LIKE '%auth.demo_password_reset%'").get().count, 1);
  database.close();
  await rm(directory, { recursive: true, force: true });
});
