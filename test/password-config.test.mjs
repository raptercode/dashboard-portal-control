import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { hashPassword, verifyPassword } from '../src/auth.mjs';
import { generateResetPassword, invalidateStoredSessions, passwordFromEnvironment, renderPasswordConfig } from '../scripts/password-config.mjs';

test('password configuration writes only a Base64 value and replaces legacy plaintext', () => {
  const rendered = renderPasswordConfig('HOSTMGR_ADMIN_PASSWORD=old-value\nHOSTMGR_MODE=host\n', 'new-correct-horse-battery');
  assert.equal(rendered.includes('HOSTMGR_ADMIN_PASSWORD=old-value'), false);
  assert.match(rendered, /HOSTMGR_ADMIN_PASSWORD_B64=bmV3LWNvcnJlY3QtaG9yc2UtYmF0dGVyeQ==/);
  assert.equal(passwordFromEnvironment({ HOSTMGR_ADMIN_PASSWORD_B64: 'bmV3LWNvcnJlY3QtaG9yc2UtYmF0dGVyeQ==' }), 'new-correct-horse-battery');
  assert.equal(passwordFromEnvironment({ HOSTMGR_ADMIN_PASSWORD: 'legacy-password' }), 'legacy-password');
});

test('generated reset passwords are URL-safe and long enough for login', () => {
  assert.match(generateResetPassword(), /^[A-Za-z0-9_-]{32}$/);
});

test('host password reset updates the owner hash and clears sessions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dashboard-portal-host-reset-'));
  const databasePath = join(directory, 'state.sqlite');
  const setup = new DatabaseSync(databasePath);
  setup.exec(`
    CREATE TABLE portal_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE sessions (id_hash TEXT PRIMARY KEY, payload TEXT NOT NULL);
    CREATE TABLE audit_events (id TEXT PRIMARY KEY, occurred_at TEXT NOT NULL, payload TEXT NOT NULL);
  `);
  setup.prepare('INSERT INTO portal_meta (key, value) VALUES (?, ?)').run('owner', JSON.stringify({ email: 'owner@example.com', password: hashPassword('BeforeReset1!') }));
  setup.prepare('INSERT INTO sessions (id_hash, payload) VALUES (?, ?)').run('session', '{}');
  setup.close();
  const email = await invalidateStoredSessions(databasePath, 'AfterReset2!');
  assert.equal(email, 'owner@example.com');
  const database = new DatabaseSync(databasePath);
  const owner = JSON.parse(database.prepare('SELECT value FROM portal_meta WHERE key = ?').get('owner').value);
  assert.equal(verifyPassword('AfterReset2!', owner.password), true);
  assert.equal(verifyPassword('BeforeReset1!', owner.password), false);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM sessions').get().count, 0);
  database.close();
  await rm(directory, { recursive: true, force: true });
});
