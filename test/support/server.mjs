import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from '../../src/server.mjs';

export const OWNER_PASSWORD = 'correct-horse-battery-staple';

export async function start(options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'hostmgr-server-'));
  // Sync/deploy fixtures simulate runtimes; listening ports on the workstation
  // must not change their results. Port selection has dedicated tests below.
  const app = await createApplication({ dataPath: join(dir, 'state.json'), password: OWNER_PASSWORD, secretKey: Buffer.alloc(32, 7).toString('base64'), mode: 'demo', sandboxClone: false, metricsEnabled: false, portAvailability: async () => true, ...options });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const address = app.server.address();
  return { app, base: `http://127.0.0.1:${address.port}`, dataPath: options.dataPath ?? join(dir, 'state.json') };
}


export async function login(base, email = 'owner@local.test', password = OWNER_PASSWORD) {
  const response = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const body = await response.json();
  if (response.status !== 200) throw new Error('Login failed: ' + response.status + ' ' + JSON.stringify(body));
  return { cookie: response.headers.get('set-cookie').split(';')[0], 'content-type': 'application/json', 'x-csrf-token': body.csrfToken };
}

export async function request(base, path, headers = {}, method = 'GET', body) {
  const response = await fetch(base + path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, body: await response.json() };
}
