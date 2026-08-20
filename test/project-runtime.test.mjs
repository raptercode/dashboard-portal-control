import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanProjectRuntimeDirectory } from '../src/project-runtime.mjs';

test('repository metadata detection prefers a Compose project and suggests its first service', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'hostmgr-runtime-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'package.json'), JSON.stringify({ scripts: { build: 'vite build', start: 'node server.mjs' } }));
  await writeFile(join(root, 'compose.yaml'), 'services:\n  web:\n    build: .\n  worker:\n    image: busybox\n');

  const result = await scanProjectRuntimeDirectory(root, '/');

  assert.equal(result.recommendedRuntime, 'docker-compose');
  assert.equal(result.composeFile, 'compose.yaml');
  assert.equal(result.composeService, 'web');
  assert.deepEqual(result.composeServices, ['web', 'worker']);
});

test('repository metadata detection recognises Bun and Node scripts in a selected directory', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'hostmgr-runtime-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'apps', 'api'), { recursive: true });
  await writeFile(join(root, 'apps', 'api', 'package.json'), JSON.stringify({ packageManager: 'bun@1.3.13', scripts: { start: 'bun src/index.ts' } }));
  await writeFile(join(root, 'apps', 'api', 'bun.lock'), 'lockfile');

  const result = await scanProjectRuntimeDirectory(root, '/apps/api');

  assert.equal(result.recommendedRuntime, 'bun');
  assert.equal(result.buildScript, null);
  assert.equal(result.startScript, 'start');
  assert.ok(result.evidence.some((item) => item.kind === 'bun-lock'));
});

test('a Dockerfile without Compose remains manual instead of producing an invalid Docker deployment', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'hostmgr-runtime-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'Dockerfile'), 'FROM node:24-alpine\n');

  const result = await scanProjectRuntimeDirectory(root, '/');

  assert.equal(result.recommendedRuntime, null);
  assert.match(result.notice, /Compose file/);
});
