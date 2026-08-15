import { InputError } from './core.mjs';

export const QUERY_MAX_ROWS = 200;
const QUERY_TIMEOUT_MS = 10_000;
const MAX_STATEMENT_CHARS = 20_000;
const MAX_CELL_CHARS = 2_000;

// Drivers are deliberately optional: the Portal core stays dependency-free,
// and each console unlocks only after the owner installs that one driver.
export const DATABASE_DRIVERS = Object.freeze({
  postgresql: Object.freeze({ install: 'pg', import: 'pg' }),
  mysql: Object.freeze({ install: 'mysql2', import: 'mysql2/promise' }),
  mongodb: Object.freeze({ install: 'mongodb', import: 'mongodb' }),
  redis: Object.freeze({ install: 'redis', import: 'redis' })
});

const SQL_READ_PATTERN = /^\s*(select|show|explain|describe|desc|with)\b/i;
const MONGO_READ_COMMANDS = new Set(['find', 'aggregate', 'count', 'distinct', 'listCollections', 'listIndexes', 'dbStats', 'collStats', 'ping', 'hello', 'buildInfo', 'serverStatus', 'explain', 'connectionStatus', 'getParameter']);
const REDIS_READ_COMMANDS = new Set(['GET', 'MGET', 'GETRANGE', 'STRLEN', 'EXISTS', 'TYPE', 'TTL', 'PTTL', 'KEYS', 'SCAN', 'HSCAN', 'SSCAN', 'ZSCAN', 'HGET', 'HGETALL', 'HMGET', 'HKEYS', 'HVALS', 'HLEN', 'LLEN', 'LRANGE', 'LINDEX', 'LPOS', 'SMEMBERS', 'SCARD', 'SISMEMBER', 'SRANDMEMBER', 'ZRANGE', 'ZRANGEBYSCORE', 'ZCARD', 'ZSCORE', 'XRANGE', 'XREVRANGE', 'XLEN', 'BITCOUNT', 'INFO', 'PING', 'ECHO', 'TIME', 'DBSIZE', 'MEMORY', 'OBJECT', 'RANDOMKEY', 'DUMP', 'COMMAND'])

export async function loadDriver(provider, importer = (name) => import(name)) {
  const driver = DATABASE_DRIVERS[provider];
  if (!driver) throw new InputError('Unsupported database provider.');
  try {
    return await importer(driver.import);
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND' || error?.code === 'MODULE_NOT_FOUND') return null;
    throw error;
  }
}

export async function driverAvailability(importer) {
  const entries = await Promise.all(Object.entries(DATABASE_DRIVERS).map(async ([provider, driver]) => {
    const module = await loadDriver(provider, importer).catch(() => null);
    return [provider, { package: driver.install, installed: Boolean(module) }];
  }));
  return Object.fromEntries(entries);
}

/**
 * Best-effort read/write classification used as a guardrail for the default
 * read-only console mode. It is not a security boundary — the owner can
 * always enable writes — so imperfect edges (data-modifying CTEs, aggregate
 * $out) are acceptable.
 */
export function statementIsReadOnly(provider, statement) {
  if (provider === 'redis') return REDIS_READ_COMMANDS.has(parseRedisCommand(statement)[0]?.toUpperCase() ?? '');
  if (provider === 'mongodb') {
    try {
      const command = JSON.parse(statement);
      const first = command && typeof command === 'object' && !Array.isArray(command) ? Object.keys(command)[0] : null;
      return Boolean(first && MONGO_READ_COMMANDS.has(first));
    } catch { return false; }
  }
  return SQL_READ_PATTERN.test(statement);
}

export function parseRedisCommand(line) {
  const parts = String(line ?? '').match(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\S+/g) ?? [];
  return parts.map((part) => /^["']/.test(part) ? part.slice(1, -1).replace(/\\(.)/g, '$1') : part);
}

export async function runDatabaseQuery({ connection, secret = '', statement, allowWrite = false, importer } = {}) {
  const text = typeof statement === 'string' ? statement.trim() : '';
  if (!text || text.length > MAX_STATEMENT_CHARS) throw new InputError(`Provide a query of at most ${MAX_STATEMENT_CHARS.toLocaleString()} characters.`);
  const adapter = ADAPTERS[connection?.provider];
  if (!adapter) throw new InputError('Unsupported database provider.');
  // Malformed Mongo input must surface as a syntax problem, not as the
  // read-only guard refusing an unclassifiable statement.
  if (connection.provider === 'mongodb') parseMongoCommand(text);
  if (!allowWrite && !statementIsReadOnly(connection.provider, text)) {
    throw new InputError('This looks like a write command. Enable "allow write commands" to run it.');
  }
  const module = await loadDriver(connection.provider, importer);
  if (!module) {
    const driver = DATABASE_DRIVERS[connection.provider];
    throw new InputError(`The ${driver.install} driver is not installed. Run "npm install ${driver.install}" in the Portal directory, then restart the service.`);
  }
  const started = Date.now();
  const result = await adapter(module, connection, secret, text);
  return { provider: connection.provider, durationMs: Date.now() - started, ...result };
}

const ADAPTERS = { postgresql: queryPostgres, mysql: queryMysql, mongodb: queryMongo, redis: queryRedis };

async function queryPostgres(module, connection, secret, statement) {
  const { Client } = module.default ?? module;
  const client = new Client({
    host: connection.host,
    port: connection.port,
    database: connection.database || undefined,
    user: connection.username || undefined,
    password: secret || undefined,
    ssl: connection.tls ? true : undefined,
    connectionTimeoutMillis: QUERY_TIMEOUT_MS,
    query_timeout: QUERY_TIMEOUT_MS,
    statement_timeout: QUERY_TIMEOUT_MS
  });
  await client.connect();
  try {
    const outcome = await client.query({ text: statement, rowMode: 'array' });
    const result = Array.isArray(outcome) ? outcome[outcome.length - 1] : outcome;
    const allRows = result.rows ?? [];
    return {
      columns: (result.fields ?? []).map((field) => field.name),
      rows: allRows.slice(0, QUERY_MAX_ROWS).map((row) => row.map(formatCell)),
      rowCount: result.rowCount ?? allRows.length,
      command: result.command ?? null,
      truncated: allRows.length > QUERY_MAX_ROWS,
      notice: Array.isArray(outcome) ? `Executed ${outcome.length} statements; showing the last result.` : null
    };
  } finally { await client.end().catch(() => {}); }
}

async function queryMysql(module, connection, secret, statement) {
  const mysql = module.default ?? module;
  const client = await mysql.createConnection({
    host: connection.host,
    port: connection.port,
    database: connection.database || undefined,
    user: connection.username || undefined,
    password: secret || undefined,
    ssl: connection.tls ? {} : undefined,
    connectTimeout: QUERY_TIMEOUT_MS,
    rowsAsArray: true
  });
  try {
    const [payload, fields] = await client.query({ sql: statement, timeout: QUERY_TIMEOUT_MS });
    if (Array.isArray(payload)) {
      return {
        columns: (fields ?? []).map((field) => field.name),
        rows: payload.slice(0, QUERY_MAX_ROWS).map((row) => (Array.isArray(row) ? row : Object.values(row)).map(formatCell)),
        rowCount: payload.length,
        command: null,
        truncated: payload.length > QUERY_MAX_ROWS,
        notice: null
      };
    }
    return { columns: [], rows: [], rowCount: payload?.affectedRows ?? 0, command: 'OK', truncated: false, notice: `affectedRows=${payload?.affectedRows ?? 0}` };
  } finally { await client.end().catch(() => client.destroy?.()); }
}

async function queryRedis(module, connection, secret, statement) {
  const redis = module.default ?? module;
  const createClient = redis.createClient ?? module.createClient;
  const database = Number.parseInt(connection.database ?? '', 10);
  const client = createClient({
    socket: { host: connection.host, port: connection.port, connectTimeout: QUERY_TIMEOUT_MS, ...(connection.tls ? { tls: true } : {}) },
    username: connection.username || undefined,
    password: secret || undefined,
    database: Number.isInteger(database) ? database : undefined
  });
  client.on('error', () => {});
  await client.connect();
  try {
    return normalizeRedisReply(await client.sendCommand(parseRedisCommand(statement)));
  } finally {
    // node-redis v4 closes with quit(); v5 renamed it to close().
    if (typeof client.close === 'function') await Promise.resolve(client.close()).catch(() => {});
    else if (typeof client.quit === 'function') await client.quit().catch(() => client.disconnect?.());
  }
}

function normalizeRedisReply(reply) {
  if (reply === null || reply === undefined) return { columns: ['reply'], rows: [], rowCount: 0, command: null, truncated: false, notice: '(nil)' };
  if (Array.isArray(reply)) {
    return { columns: ['#', 'value'], rows: reply.slice(0, QUERY_MAX_ROWS).map((item, index) => [String(index), formatCell(item)]), rowCount: reply.length, command: null, truncated: reply.length > QUERY_MAX_ROWS, notice: null };
  }
  if (typeof reply === 'object' && !Buffer.isBuffer(reply)) {
    const entries = Object.entries(reply);
    return { columns: ['field', 'value'], rows: entries.slice(0, QUERY_MAX_ROWS).map(([field, value]) => [field, formatCell(value)]), rowCount: entries.length, command: null, truncated: entries.length > QUERY_MAX_ROWS, notice: null };
  }
  return { columns: ['reply'], rows: [[formatCell(reply)]], rowCount: 1, command: null, truncated: false, notice: null };
}

function parseMongoCommand(statement) {
  let command;
  try { command = JSON.parse(statement); } catch { throw new InputError('MongoDB console expects a JSON command document, e.g. {"find":"users","limit":10}.'); }
  if (!command || typeof command !== 'object' || Array.isArray(command)) throw new InputError('MongoDB command must be a JSON object.');
  return command;
}

async function queryMongo(module, connection, secret, statement) {
  const command = parseMongoCommand(statement);
  const { MongoClient } = module.default ?? module;
  const client = new MongoClient(`mongodb://${connection.host}:${connection.port}`, {
    auth: connection.username ? { username: connection.username, password: secret || '' } : undefined,
    tls: connection.tls || undefined,
    directConnection: true,
    serverSelectionTimeoutMS: QUERY_TIMEOUT_MS,
    connectTimeoutMS: QUERY_TIMEOUT_MS,
    socketTimeoutMS: QUERY_TIMEOUT_MS
  });
  await client.connect();
  try {
    const reply = await client.db(connection.database || 'admin').command(command);
    const batch = reply?.cursor?.firstBatch;
    if (Array.isArray(batch)) {
      return { columns: ['document'], rows: batch.slice(0, QUERY_MAX_ROWS).map((doc) => [formatCell(doc)]), rowCount: batch.length, command: null, truncated: batch.length > QUERY_MAX_ROWS, notice: null };
    }
    return { columns: ['reply'], rows: [[formatCell(reply)]], rowCount: 1, command: null, truncated: false, notice: null };
  } finally { await client.close().catch(() => {}); }
}

function formatCell(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return `\\x${value.toString('hex').slice(0, MAX_CELL_CHARS)}`;
  const text = typeof value === 'object' ? safeJson(value) : String(value);
  return text.length > MAX_CELL_CHARS ? `${text.slice(0, MAX_CELL_CHARS)}…` : text;
}

function safeJson(value) {
  try { return JSON.stringify(value); } catch { return String(value); }
}
