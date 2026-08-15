import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InputError } from '../src/core.mjs';
import { QUERY_MAX_ROWS, driverAvailability, loadDriver, parseRedisCommand, runDatabaseQuery, statementIsReadOnly } from '../src/db-query.mjs';
import { createApplication } from '../src/server.mjs';

const missingModule = () => { const error = new Error('not found'); error.code = 'ERR_MODULE_NOT_FOUND'; throw error; };

test('driver loading treats a missing optional dependency as absent, not an error', async () => {
  assert.equal(await loadDriver('postgresql', missingModule), null);
  const fake = { Client: class {} };
  assert.equal(await loadDriver('postgresql', async () => fake), fake);
  await assert.rejects(loadDriver('sqlite', async () => fake), InputError);
  const availability = await driverAvailability(missingModule);
  assert.deepEqual(availability.postgresql, { package: 'pg', installed: false });
  assert.deepEqual(Object.keys(availability).sort(), ['mongodb', 'mysql', 'postgresql', 'redis']);
});

test('read-only classification covers SQL, Redis commands, and Mongo command documents', () => {
  assert.equal(statementIsReadOnly('postgresql', 'SELECT * FROM users'), true);
  assert.equal(statementIsReadOnly('postgresql', '  explain analyze select 1'), true);
  assert.equal(statementIsReadOnly('postgresql', 'DELETE FROM users'), false);
  assert.equal(statementIsReadOnly('mysql', 'SHOW TABLES'), true);
  assert.equal(statementIsReadOnly('mysql', 'DROP TABLE users'), false);
  assert.equal(statementIsReadOnly('redis', 'GET mykey'), true);
  assert.equal(statementIsReadOnly('redis', 'del mykey'), false);
  assert.equal(statementIsReadOnly('mongodb', '{"find":"users","limit":5}'), true);
  assert.equal(statementIsReadOnly('mongodb', '{"insert":"users","documents":[]}'), false);
  assert.equal(statementIsReadOnly('mongodb', 'not-json'), false);
});

test('redis command parsing honors quoted arguments', () => {
  assert.deepEqual(parseRedisCommand('SET greeting "hello world"'), ['SET', 'greeting', 'hello world']);
  assert.deepEqual(parseRedisCommand("GET 'key with spaces'"), ['GET', 'key with spaces']);
  assert.deepEqual(parseRedisCommand('SCAN 0 MATCH user:*'), ['SCAN', '0', 'MATCH', 'user:*']);
});

test('write statements are rejected before any driver loads unless writes are allowed', async () => {
  const connection = { provider: 'postgresql', host: '127.0.0.1', port: 5432 };
  await assert.rejects(
    runDatabaseQuery({ connection, statement: 'DELETE FROM users', importer: () => assert.fail('driver must not load') }),
    /allow write/i
  );
});

test('a missing driver produces install guidance', async () => {
  const connection = { provider: 'redis', host: '127.0.0.1', port: 6379 };
  await assert.rejects(runDatabaseQuery({ connection, statement: 'PING', importer: missingModule }), /npm install redis/);
});

test('PostgreSQL results are normalized, capped, and cells stringified safely', async () => {
  const captured = {};
  class FakeClient {
    constructor(config) { captured.config = config; }
    async connect() {}
    async query(input) {
      captured.input = input;
      return {
        command: 'SELECT',
        rowCount: QUERY_MAX_ROWS + 50,
        fields: [{ name: 'id' }, { name: 'payload' }, { name: 'seen_at' }],
        rows: Array.from({ length: QUERY_MAX_ROWS + 50 }, (_, index) => [index, { nested: true }, new Date('2026-08-16T00:00:00.000Z')])
      };
    }
    async end() {}
  }
  const connection = { provider: 'postgresql', host: 'db.example.test', port: 5432, database: 'app', username: 'reader', tls: true };
  const result = await runDatabaseQuery({ connection, secret: 'pw', statement: 'SELECT * FROM events', importer: async () => ({ default: { Client: FakeClient } }) });
  assert.equal(captured.config.ssl, true);
  assert.equal(captured.input.rowMode, 'array');
  assert.equal(result.columns.length, 3);
  assert.equal(result.rows.length, QUERY_MAX_ROWS);
  assert.equal(result.truncated, true);
  assert.equal(result.rowCount, QUERY_MAX_ROWS + 50);
  assert.deepEqual(result.rows[0], ['0', '{"nested":true}', '2026-08-16T00:00:00.000Z']);
});

test('Redis replies normalize scalars, arrays, and hashes', async () => {
  const sent = [];
  const makeModule = (reply) => ({
    createClient: () => ({
      on() {},
      async connect() {},
      async sendCommand(parts) { sent.push(parts); return reply; },
      async quit() {}
    })
  });
  const connection = { provider: 'redis', host: '127.0.0.1', port: 6379, database: '2' };
  const scalar = await runDatabaseQuery({ connection, statement: 'GET greeting', importer: async () => makeModule('hello') });
  assert.deepEqual(scalar.rows, [['hello']]);
  assert.deepEqual(sent.at(-1), ['GET', 'greeting']);
  const hash = await runDatabaseQuery({ connection, statement: 'HGETALL user:1', importer: async () => makeModule({ name: 'a', age: 3 }) });
  assert.deepEqual(hash.columns, ['field', 'value']);
  assert.equal(hash.rowCount, 2);
  const nil = await runDatabaseQuery({ connection, statement: 'GET missing', importer: async () => makeModule(null) });
  assert.equal(nil.notice, '(nil)');
  assert.equal(nil.rowCount, 0);
});

test('MongoDB console requires a JSON command and renders cursor batches as documents', async () => {
  class FakeMongoClient {
    constructor(url, options) { FakeMongoClient.last = { url, options }; }
    async connect() {}
    db(name) {
      FakeMongoClient.dbName = name;
      return { command: async (command) => (command.find ? { cursor: { firstBatch: [{ _id: 1 }, { _id: 2 }] } } : { ok: 1 }) };
    }
    async close() {}
  }
  const importer = async () => ({ MongoClient: FakeMongoClient });
  const connection = { provider: 'mongodb', host: 'mongo.example.test', port: 27017, database: 'app', username: 'reader' };
  await assert.rejects(runDatabaseQuery({ connection, statement: 'find users', importer }), /JSON command/);
  const found = await runDatabaseQuery({ connection, secret: 'pw', statement: '{"find":"users"}', importer });
  assert.deepEqual(found.columns, ['document']);
  assert.equal(found.rowCount, 2);
  assert.equal(FakeMongoClient.dbName, 'app');
  assert.equal(FakeMongoClient.last.options.auth.username, 'reader');
  const ping = await runDatabaseQuery({ connection, statement: '{"ping":1}', importer });
  assert.deepEqual(ping.rows, [['{"ok":1}']]);
});

test('database query API enforces session and CSRF, and audits metadata without the query text', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'hostmgr-dbq-'));
  const fixedResult = { provider: 'postgresql', durationMs: 7, columns: ['x'], rows: [['1']], rowCount: 1, command: 'SELECT', truncated: false, notice: null };
  const seen = [];
  const app = await createApplication({
    dataPath: join(dir, 'state.sqlite'),
    password: 'correct-horse-battery-staple',
    secretKey: Buffer.alloc(32, 7).toString('base64'),
    mode: 'demo',
    sandboxClone: false,
    metricsEnabled: false,
    databaseDrivers: async () => ({ postgresql: { package: 'pg', installed: true } }),
    databaseQuery: async (input) => { seen.push(input); return fixedResult; }
  });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;

  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'owner@local.test', password: 'correct-horse-battery-staple' }) });
  const session = await login.json();
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const authed = { cookie, 'content-type': 'application/json', 'x-csrf-token': session.csrfToken };

  const created = await (await fetch(`${base}/api/databases`, { method: 'POST', headers: authed, body: JSON.stringify({ name: 'app-postgres', provider: 'postgresql', host: '127.0.0.1', port: 5432, database: 'app', username: 'reader', password: 'secret-pw' }) })).json();
  const id = created.connection.id;

  assert.equal((await fetch(`${base}/api/databases/${id}/query`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 401);
  assert.equal((await fetch(`${base}/api/databases/${id}/query`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '{}' })).status, 403);

  const listed = await (await fetch(`${base}/api/databases`, { headers: { cookie } })).json();
  assert.equal(listed.drivers.postgresql.installed, true);

  const ok = await (await fetch(`${base}/api/databases/${id}/query`, { method: 'POST', headers: authed, body: JSON.stringify({ statement: 'SELECT secret_column FROM t', allowWrite: false }) })).json();
  assert.deepEqual(ok.result, fixedResult);
  assert.equal(seen[0].statement, 'SELECT secret_column FROM t');
  assert.equal(seen[0].secret, 'secret-pw');

  const missing = await fetch(`${base}/api/databases/00000000-0000-0000-0000-000000000000/query`, { method: 'POST', headers: authed, body: JSON.stringify({ statement: 'SELECT 1' }) });
  assert.equal(missing.status, 404);

  const audit = await (await fetch(`${base}/api/audit`, { headers: { cookie } })).json();
  const event = audit.events.find((item) => item.action === 'database.query');
  assert.ok(event);
  assert.match(event.detail, /1 row\(s\) in 7 ms/);
  assert.doesNotMatch(JSON.stringify(event), /secret_column/);
});
