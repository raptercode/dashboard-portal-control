import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectPrismaProject } from '../scripts/prisma-project.mjs';
import { generateCandidatePrisma } from '../src/server.mjs';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'portal-prisma-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function installedPrisma(directory, version = '7.0.0', bin = './build/index.js') {
  const packageDirectory = join(directory, 'node_modules/prisma');
  await mkdir(join(packageDirectory, bin, '..'), { recursive: true });
  await writeFile(join(packageDirectory, 'package.json'), JSON.stringify({ name: 'prisma', version, bin: { prisma: bin } }));
  await writeFile(join(packageDirectory, bin), '');
}

test('Prisma detection skips ordinary apps and requires the installed project CLI', async t => {
  const directory = await fixture(t);
  assert.equal(await detectPrismaProject(directory, {}), null);
  await assert.rejects(detectPrismaProject(directory, { dependencies: { '@prisma/client': '7' } }), /local CLI is missing/);
  await writeFile(join(directory, 'prisma.config.ts'), 'throw Error("must not evaluate inside Portal")');
  await assert.rejects(detectPrismaProject(directory, {}), /local CLI is missing/);
});

test('linked package resolution works with pnpm but rejects a CLI symlink outside that package', { skip: process.platform === 'win32' }, async t => {
  const directory = await fixture(t);
  const store = join(directory, 'node_modules/.pnpm/prisma@8');
  await installedPrisma(store, '8.0.0-rc.10', './dist/prisma.js');
  const packageDirectory = join(store, 'node_modules/prisma');
  await symlink(packageDirectory, join(directory, 'node_modules/prisma'));
  const manifest = { devDependencies: { prisma: '8.0.0-rc.10' } };
  assert.deepEqual((await detectPrismaProject(directory, manifest)).args, ['contract', 'emit']);
  const cli = join(packageDirectory, 'dist/prisma.js');
  await rm(cli);
  const outside = join(directory, 'outside.js');
  await writeFile(outside, '');
  await symlink(outside, cli);
  await assert.rejects(detectPrismaProject(directory, manifest), /inside its package/);
});

test('schema and package declarations trigger local generate with deployment env and selected Node', async t => {
  for (const source of ['schema', 'config', 'dependency', 'custom']) {
    const directory = await fixture(t);
    await installedPrisma(directory);
    let manifest = {};
    if (source === 'schema') { await mkdir(join(directory, 'prisma')); await writeFile(join(directory, 'prisma/schema.prisma'), ''); }
    if (source === 'config') { await mkdir(join(directory, '.config')); await writeFile(join(directory, '.config/prisma.ts'), ''); }
    if (source === 'dependency') manifest = { devDependencies: { prisma: '7' } };
    if (source === 'custom') manifest = { prisma: { schema: 'custom/schema.prisma' } };
    const events = [];
    let calls = 0;
    await generateCandidatePrisma({ runtime: 'node', nodeMajor: 24, candidatePort: 40419 }, directory, manifest,
      'DATABASE_URL=fixture-secret\n', (...event) => events.push(event), async (command, args, options) => {
        calls++;
        assert.equal(command, '/opt/node-v24.18.0/bin/node');
        assert.deepEqual(args, [join(directory, 'node_modules/prisma/build/index.js'), 'generate']);
        assert.equal(options.env.DATABASE_URL, 'fixture-secret');
        assert.equal(options.env.PRISMA_GENERATE_SKIP_AUTOINSTALL, '1');
        assert.equal(options.cwd, directory);
      });
    assert.equal(calls, 1);
    assert.match(events.at(-1)[2], /client generated/);
    await assert.rejects(generateCandidatePrisma({ runtime: 'node', candidatePort: 40419 }, directory, manifest,
      'DATABASE_URL=fixture-secret\n', undefined, async () => { throw Object.assign(new Error('failed'), { commandOutput: 'config failed fixture-secret' }); }),
      error => /generation failed/.test(error.message) && !error.failureLog.includes('fixture-secret'));
  }
});

test('Prisma 8 uses its declared dist CLI and emits contracts with Bun even without a build script', async t => {
  const directory = await fixture(t);
  await installedPrisma(directory, '8.0.0-rc.10', './dist/prisma.js');
  await writeFile(join(directory, 'prisma.config.ts'), 'throw Error("Portal must not import this config")');
  const manifest = { devDependencies: { prisma: '^8.0.0-rc.10' } };
  const events = [];
  let calls = 0;
  await generateCandidatePrisma({ runtime: 'bun', candidatePort: 40419 }, directory, manifest,
    'DATABASE_URL=fixture-secret\n', (...event) => events.push(event), async (command, args, options) => {
      calls++;
      assert.match(command, /bun/);
      assert.deepEqual(args, [join(directory, 'node_modules/prisma/dist/prisma.js'), 'contract', 'emit']);
      assert.equal(options.env.DATABASE_URL, 'fixture-secret');
      assert.equal(options.cwd, directory);
    });
  assert.equal(calls, 1);
  assert.match(events.at(-1)[2], /contract emitted/);
  await assert.rejects(generateCandidatePrisma({ runtime: 'bun' }, directory, manifest,
    'DATABASE_URL=fixture-secret\n', undefined, async () => { throw Object.assign(new Error('failed'), { commandOutput: 'config failed fixture-secret' }); }),
    error => /contract emission failed/.test(error.message) && !error.failureLog.includes('fixture-secret'));
});

test('installed version determines generation and bin can be a string or a nonstandard package path', async t => {
  const directory = await fixture(t);
  await installedPrisma(directory, '6.19.0', './cli/main.js');
  const file = join(directory, 'node_modules/prisma/package.json');
  await writeFile(file, JSON.stringify({ name: 'prisma', version: '6.19.0', bin: './cli/main.js' }));
  const plan = await detectPrismaProject(directory, { dependencies: { prisma: '*' } });
  assert.deepEqual(plan.args, ['generate']);
  assert.equal(plan.cli, join(directory, 'node_modules/prisma/cli/main.js'));
});

test('installed Prisma metadata fails clearly for a missing bin, unknown version or path outside the package', async t => {
  const directory = await fixture(t);
  await installedPrisma(directory);
  const file = join(directory, 'node_modules/prisma/package.json');
  const manifest = { devDependencies: { prisma: '*' } };
  for (const [metadata, message] of [
    [{ version: '7.0.0' }, /CLI entry point/],
    [{ version: '7.0.0', bin: { prisma: './missing.js' } }, /CLI entry point/],
    [{ version: '7.0.0', bin: { prisma: '../outside.js' } }, /inside its package/],
    [{ version: '9.0.0', bin: { prisma: './build/index.js' } }, /unsupported/],
    [{ version: 'invalid', bin: { prisma: './build/index.js' } }, /version/],
  ]) {
    await writeFile(file, JSON.stringify({ name: 'prisma', ...metadata }));
    await assert.rejects(detectPrismaProject(directory, manifest), message);
  }
});
