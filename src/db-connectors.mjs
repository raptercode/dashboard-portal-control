import net from 'node:net';
import { InputError } from './core.mjs';

export const DATABASE_PROVIDERS = Object.freeze({
  mongodb: { id: 'mongodb', label: 'MongoDB', defaultPort: 27017 },
  postgresql: { id: 'postgresql', label: 'PostgreSQL', defaultPort: 5432 },
  mysql: { id: 'mysql', label: 'MySQL', defaultPort: 3306 },
  redis: { id: 'redis', label: 'Redis', defaultPort: 6379 }
});

export function validateDatabaseConnectionInput(input) {
  const provider = input?.provider;
  if (!Object.hasOwn(DATABASE_PROVIDERS, provider)) throw new InputError('Unsupported database provider.');
  const name = requiredText(input?.name, 'Connection name', 80);
  if (!/^[a-z][a-z0-9-]{0,79}$/.test(name)) throw new InputError('Connection name must use lowercase letters, digits, and hyphens.');
  const host = requiredText(input?.host, 'Host', 253);
  if (/[\s/\\]/.test(host)) throw new InputError('Host is invalid.');
  const port = Number(input?.port ?? DATABASE_PROVIDERS[provider].defaultPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new InputError('Port must be between 1 and 65535.');
  const database = optionalText(input?.database, 128);
  const username = optionalText(input?.username, 128);
  const password = optionalSecret(input?.password, 4096);
  const tls = input?.tls === true;
  if ((provider === 'postgresql' || provider === 'mysql' || provider === 'mongodb') && !database) {
    throw new InputError('Database name is required for this provider.');
  }
  return { provider, name, host, port, database, username, password, tls };
}

export function publicDatabaseConnection(connection) {
  if (!connection) return connection;
  return {
    id: connection.id,
    name: connection.name,
    provider: connection.provider,
    host: connection.host,
    port: connection.port,
    database: connection.database,
    username: connection.username,
    tls: Boolean(connection.tls),
    hasPassword: Boolean(connection.encryptedSecret),
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
    lastCheckedAt: connection.lastCheckedAt ?? null,
    lastStatus: connection.lastStatus ?? null
  };
}

export async function probeDatabaseConnection(connection, secret = '') {
  const started = Date.now();
  await connectTcp(connection.host, connection.port, 4_000);
  return {
    ok: true,
    detail: `TCP reachable on ${connection.host}:${connection.port}`,
    latencyMs: Date.now() - started,
    authenticated: Boolean(secret || connection.username)
  };
}

function connectTcp(host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new InputError(`Could not reach ${host}:${port}.`));
    }, timeoutMs);
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.end();
      resolve();
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      reject(new InputError(error.message || `Could not reach ${host}:${port}.`));
    });
  });
}

function requiredText(value, label, max) {
  if (typeof value !== 'string') throw new InputError(`${label} is required.`);
  const text = value.trim();
  if (!text || text.length > max) throw new InputError(`${label} is required.`);
  return text;
}

function optionalText(value, max) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > max) throw new InputError('Value is invalid.');
  return value.trim();
}

function optionalSecret(value, max) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > max || /[\r\n\0]/.test(value)) throw new InputError('Password is invalid.');
  return value;
}
