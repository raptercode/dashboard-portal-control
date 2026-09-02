import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from '../src/server.mjs';

test('runtime detection API requires owner CSRF and returns only safe repository metadata', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'hostmgr-runtime-api-'));
  const app = await createApplication({
    dataPath: join(dir, 'state.sqlite'), password: 'correct-horse-battery-staple', secretKey: Buffer.alloc(32, 7).toString('base64'), mode: 'demo', sandboxClone: false, metricsEnabled: false,
    projectRuntimeDetector: async (input) => ({ available: true, recommendedRuntime: 'docker-compose', confidence: 'high', evidence: [{ kind: 'compose', path: 'compose.yaml', label: 'Docker Compose' }], composeFile: 'compose.yaml', composeService: 'web', composeServices: ['web'], buildScript: null, startScript: null, notice: `Detected ${input.branch}` })
  });
  await app.store.update((state) => { state.tools.git.status = 'Installed'; });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const body = { repository: 'https://github.com/example/project.git', branch: 'main', directory: '/', credentialId: '' };
  assert.equal((await fetch(`${base}/api/projects/runtime-detect`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).status, 401);
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'owner@local.test', password: 'correct-horse-battery-staple' }) });
  const session = await login.json();
  const cookie = login.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(`${base}/api/projects/runtime-detect`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) })).status, 403);
  const response = await fetch(`${base}/api/projects/runtime-detect`, { method: 'POST', headers: { cookie, 'content-type': 'application/json', 'x-csrf-token': session.csrfToken }, body: JSON.stringify(body) });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.detection.recommendedRuntime, 'docker-compose');
  assert.equal(payload.detection.composeService, 'web');
  assert.equal(JSON.stringify(payload).includes('correct-horse'), false);
});
