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

test('repository metadata detection recognises Next.js, Nuxt, and Django', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'hostmgr-framework-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'package.json'), JSON.stringify({ dependencies: { next: '15.0.0' }, scripts: { build: 'next build', start: 'next start' } }));
  const next = await scanProjectRuntimeDirectory(root, '/');
  assert.equal(next.recommendedRuntime, 'node');
  assert.equal(next.recommendedFramework, 'next');

  await writeFile(join(root, 'package.json'), JSON.stringify({ dependencies: { nuxt: '3.0.0' }, scripts: { build: 'nuxt build', start: 'nuxt start' } }));
  const nuxt = await scanProjectRuntimeDirectory(root, '/');
  assert.equal(nuxt.recommendedRuntime, 'node');
  assert.equal(nuxt.recommendedFramework, 'nuxt');

  await rm(join(root, 'package.json'));
  await writeFile(join(root, 'manage.py'), '#!/usr/bin/env python\n');
  await writeFile(join(root, 'requirements.txt'), 'Django>=5.0\n');
  const django = await scanProjectRuntimeDirectory(root, '/');
  assert.equal(django.recommendedRuntime, 'python');
  assert.equal(django.recommendedFramework, 'django');
  assert.equal(django.pythonMode, 'wsgi');
});

test('repository metadata detection recognises Express Nest Elysia Laravel and CodeIgniter', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'hostmgr-more-frameworks-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'package.json'), JSON.stringify({ dependencies: { express: '5.0.0' }, scripts: { start: 'node server.js' } }));
  const express = await scanProjectRuntimeDirectory(root, '/');
  assert.equal(express.recommendedRuntime, 'node');
  assert.equal(express.recommendedFramework, 'express');

  await writeFile(join(root, 'package.json'), JSON.stringify({ dependencies: { '@nestjs/core': '11.0.0' }, scripts: { build: 'nest build', start: 'node dist/main' } }));
  const nest = await scanProjectRuntimeDirectory(root, '/');
  assert.equal(nest.recommendedFramework, 'nestjs');

  await writeFile(join(root, 'package.json'), JSON.stringify({ dependencies: { elysia: '1.0.0' }, scripts: { start: 'bun src/index.ts' } }));
  await writeFile(join(root, 'bun.lock'), 'lockfile');
  const elysia = await scanProjectRuntimeDirectory(root, '/');
  assert.equal(elysia.recommendedRuntime, 'bun');
  assert.equal(elysia.recommendedFramework, 'elysia');

  await rm(join(root, 'package.json'));
  await rm(join(root, 'bun.lock'));
  await writeFile(join(root, 'composer.json'), JSON.stringify({ require: { 'laravel/framework': '^11.0' } }));
  await writeFile(join(root, 'artisan'), '#!/usr/bin/env php\n');
  const laravel = await scanProjectRuntimeDirectory(root, '/');
  assert.equal(laravel.recommendedRuntime, 'php');
  assert.equal(laravel.recommendedFramework, 'laravel');
  assert.equal(laravel.phpMode, 'artisan');

  await rm(join(root, 'artisan'));
  await writeFile(join(root, 'composer.json'), JSON.stringify({ require: { 'codeigniter4/framework': '^4.0' } }));
  await writeFile(join(root, 'spark'), '#!/usr/bin/env php\n');
  const ci = await scanProjectRuntimeDirectory(root, '/');
  assert.equal(ci.recommendedFramework, 'codeigniter');
  assert.equal(ci.phpMode, 'spark');
});

test('Compose remains recommended while package and PHP metadata stay available as alternatives', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'hostmgr-runtime-alts-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'compose.yaml'), 'services:\n  web:\n    build: .\n');
  await writeFile(join(root, 'package.json'), JSON.stringify({ dependencies: { elysia: '1.1.0' }, scripts: { start: 'bun src/index.ts' } }));
  await writeFile(join(root, 'bun.lock'), 'lockfile');
  await writeFile(join(root, 'composer.json'), JSON.stringify({ require: { 'laravel/framework': '^11.0' } }));
  await writeFile(join(root, 'artisan'), '#!/usr/bin/env php\n');

  const result = await scanProjectRuntimeDirectory(root, '/');

  assert.equal(result.recommendedRuntime, 'docker-compose');
  assert.equal(result.recommendedFramework, null);
  assert.deepEqual(result.candidates.map((item) => [item.runtime, item.framework]), [
    ['docker-compose', null],
    ['php', 'laravel'],
    ['bun', 'elysia'],
    ['node', 'elysia']
  ]);
  assert.equal(result.candidates.find((item) => item.runtime === 'php').phpMode, 'artisan');
  assert.equal(result.candidates.find((item) => item.runtime === 'bun').startScript, 'start');
});

test('a Dockerfile without Compose remains manual instead of producing an invalid Docker deployment', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'hostmgr-runtime-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'Dockerfile'), 'FROM node:24-alpine\n');

  const result = await scanProjectRuntimeDirectory(root, '/');

  assert.equal(result.recommendedRuntime, null);
  assert.match(result.notice, /Compose file/);
});
