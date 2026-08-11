import { access, chmod, chown, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

export const DEFAULT_CONFIG_PATH = '/etc/dashboard-portal/dashboard-portal.env';
export const DEFAULT_STATE_DATABASE_PATH = '/var/lib/dashboard-portal/state.sqlite';

export function passwordFromEnvironment(environment = process.env) {
  const encoded = environment.HOSTMGR_ADMIN_PASSWORD_B64;
  if (typeof encoded === 'string' && encoded) {
    try {
      const decoded = Buffer.from(encoded, 'base64');
      if (decoded.length && decoded.toString('base64') === encoded) return decoded.toString('utf8');
    } catch { /* Fall through to the legacy value. */ }
  }
  return environment.HOSTMGR_ADMIN_PASSWORD;
}

export function validateStoredPassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128 || /[\r\n\0]/.test(password)) {
    throw new Error('Password must be between 12 and 128 characters and must not contain a line break.');
  }
  return password;
}

export function renderPasswordConfig(existing, password) {
  validateStoredPassword(password);
  const retained = String(existing)
    .split(/\r?\n/)
    .filter((line) => !/^HOSTMGR_ADMIN_PASSWORD(?:_B64)?=/.test(line));
  while (retained.length && retained.at(-1) === '') retained.pop();
  retained.push(`HOSTMGR_ADMIN_PASSWORD_B64=${Buffer.from(password, 'utf8').toString('base64')}`);
  return `${retained.join('\n')}\n`;
}

export async function updateStoredPassword(password, configPath = DEFAULT_CONFIG_PATH) {
  validateStoredPassword(password);
  const [existing, details] = await Promise.all([readFile(configPath, 'utf8'), stat(configPath)]);
  const temporaryPath = `${configPath}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await writeFile(temporaryPath, renderPasswordConfig(existing, password), { mode: 0o640 });
    await chown(temporaryPath, details.uid, details.gid);
    await chmod(temporaryPath, 0o640);
    await rename(temporaryPath, configPath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

export function generateResetPassword() {
  return randomBytes(24).toString('base64url');
}

export async function invalidateStoredSessions(databasePath = DEFAULT_STATE_DATABASE_PATH) {
  if (!await access(databasePath).then(() => true).catch(() => false)) return;
  const database = new DatabaseSync(databasePath);
  try {
    database.exec('BEGIN IMMEDIATE');
    database.prepare('DELETE FROM sessions').run();
    database.prepare('INSERT INTO audit_events (id, occurred_at, payload) VALUES (?, ?, ?)').run(
      randomUUID(),
      new Date().toISOString(),
      JSON.stringify({ id: randomUUID(), at: new Date().toISOString(), action: 'auth.password_reset', outcome: 'success', actor: 'root', detail: 'Owner password reset through SSH; existing sessions were invalidated' })
    );
    database.exec('COMMIT');
  } catch (error) {
    try { database.exec('ROLLBACK'); } catch { /* The transaction may not have opened. */ }
    throw error;
  } finally { database.close(); }
}

function restartDashboardService() {
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/systemctl', ['restart', 'dashboard-portal.service'], { stdio: 'ignore' });
    child.once('error', reject);
    child.once('close', (code) => code === 0 ? resolve() : reject(new Error('Dashboard Portal service could not be restarted.')));
  });
}

async function runResetCommand() {
  if (process.getuid?.() !== 0) throw new Error('Run this command with sudo.');
  if (process.argv.length !== 3 || process.argv[2] !== '--reset-pwd') throw new Error('Usage: dashboard-portal --reset-pwd');
  const password = generateResetPassword();
  await updateStoredPassword(password);
  await invalidateStoredSessions();
  await restartDashboardService();
  process.stdout.write(`Dashboard Portal password reset. Store this password now; it will not be shown again:\n${password}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runResetCommand().catch((error) => {
    process.stderr.write(`Dashboard Portal password reset failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
