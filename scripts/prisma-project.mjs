import { stat } from 'node:fs/promises';
import { join } from 'node:path';

// Let Prisma resolve config/schema precedence itself; never evaluate project
// config in the Portal process or download a CLI through npx/bunx.
export async function detectPrismaProject(directory, manifest) {
  const dependencies = { ...manifest.dependencies, ...manifest.devDependencies };
  const candidates = ['schema.prisma', 'prisma/schema.prisma',
    ...['ts', 'js', 'mjs', 'cjs', 'mts', 'cts'].flatMap(extension => [`prisma.config.${extension}`, `.config/prisma.${extension}`])];
  const files = await Promise.all(candidates.map(path => stat(join(directory, path)).then(item => item.isFile()).catch(() => false)));
  if (!dependencies.prisma && !dependencies['@prisma/client'] && !manifest.prisma?.schema && !files.some(Boolean)) return null;
  const cli = join(directory, 'node_modules/prisma/build/index.js');
  if (!await stat(cli).then(item => item.isFile()).catch(() => false)) {
    throw new Error('Prisma was detected but its local CLI is missing. Add prisma to the project dependencies or devDependencies and commit the lockfile.');
  }
  return { cli, args: ['generate'] };
}
