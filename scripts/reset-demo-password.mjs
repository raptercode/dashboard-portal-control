import { access } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { hashPassword } from '../src/auth.mjs';
import { generateResetPassword } from './password-config.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const defaultDatabasePath = join(here, '..', 'data', 'state.sqlite');

export function resetDemoOwnerPassword({ databasePath = defaultDatabasePath, password = generateResetPassword() } = {}) {
  const database = new DatabaseSync(databasePath);
  try {
    database.exec('BEGIN IMMEDIATE');
    const row = database.prepare('SELECT value FROM portal_meta WHERE key = ?').get('owner');
    const owner = row?.value ? JSON.parse(row.value) : null;
    if (!owner?.email) throw new Error('No demo owner exists yet. Start npm run demo and complete bootstrap first.');

    const updatedOwner = { ...owner, password: hashPassword(password), updatedAt: new Date().toISOString() };
    database.prepare('INSERT OR REPLACE INTO portal_meta (key, value) VALUES (?, ?)').run('owner', JSON.stringify(updatedOwner));
    database.prepare('DELETE FROM sessions').run();
    const event = {
      id: randomUUID(),
      at: new Date().toISOString(),
      action: 'auth.demo_password_reset',
      outcome: 'success',
      actor: 'local-developer',
      target: owner.email,
      detail: 'Demo owner password reset locally; existing sessions were invalidated'
    };
    database.prepare('INSERT INTO audit_events (id, occurred_at, payload) VALUES (?, ?, ?)').run(event.id, event.at, JSON.stringify(event));
    database.exec('COMMIT');
    return { email: owner.email, password };
  } catch (error) {
    try { database.exec('ROLLBACK'); } catch { /* Transaction may not have started. */ }
    throw error;
  } finally {
    database.close();
  }
}

async function run() {
  if (process.env.HOSTMGR_MODE !== 'demo') throw new Error('This command only runs when HOSTMGR_MODE=demo.');
  if (process.argv.length !== 2) throw new Error('This command does not accept password arguments.');
  const databasePath = process.env.HOSTMGR_DATABASE_PATH ?? process.env.HOSTMGR_DATA_PATH ?? defaultDatabasePath;
  await access(databasePath);
  const result = resetDemoOwnerPassword({ databasePath });
  process.stdout.write(`Demo password reset for ${result.email}. Store this password now; it will not be shown again:\n${result.password}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run().catch((error) => {
    process.stderr.write(`Demo password reset failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
