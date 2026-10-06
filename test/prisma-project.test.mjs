import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectPrismaProject } from '../scripts/prisma-project.mjs';
import { generateCandidatePrisma } from '../src/server.mjs';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'portal-prisma-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('Prisma detection skips ordinary apps and requires the installed project CLI', async t => {
  const directory = await fixture(t);
  assert.equal(await detectPrismaProject(directory, {}), null);
  await assert.rejects(detectPrismaProject(directory, { dependencies: { '@prisma/client': '7' } }), /local CLI is missing/);
  await writeFile(join(directory, 'prisma.config.ts'), 'throw Error("must not evaluate inside Portal")');
  await assert.rejects(detectPrismaProject(directory, {}), /local CLI is missing/);
});

test('schema and package declarations trigger local generate with deployment env and selected Node', async t => {
  for (const source of ['schema', 'config', 'dependency', 'custom']) {
    const directory = await fixture(t);
    await mkdir(join(directory, 'node_modules/prisma/build'), { recursive: true });
    await writeFile(join(directory, 'node_modules/prisma/build/index.js'), '');
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
