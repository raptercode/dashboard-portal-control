import { readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

function inside(root, path) {
  const part = relative(root, path);
  return part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part);
}

// Let Prisma resolve config/schema precedence itself; never evaluate project
// config in the Portal process or download a CLI through npx/bunx.
export async function detectPrismaProject(directory, manifest) {
  const dependencies = { ...manifest.dependencies, ...manifest.devDependencies };
  const candidates = ['schema.prisma', 'prisma/schema.prisma',
    ...['ts', 'js', 'mjs', 'cjs', 'mts', 'cts'].flatMap(extension => [`prisma.config.${extension}`, `.config/prisma.${extension}`])];
  const files = await Promise.all(candidates.map(path => stat(join(directory, path)).then(item => item.isFile()).catch(() => false)));
  if (!dependencies.prisma && !dependencies['@prisma/client'] && !manifest.prisma?.schema && !files.some(Boolean)) return null;
  const packageDirectory = join(directory, 'node_modules/prisma');
  let installed;
  try {
    installed = JSON.parse(await readFile(join(packageDirectory, 'package.json'), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('Prisma was detected but its local CLI is missing. Add prisma to the project dependencies or devDependencies and commit the lockfile.');
    throw new Error('The installed Prisma package metadata could not be read. Check the project dependencies and lockfile.');
  }
  const version = installed?.version;
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.test(version)) throw new Error('The installed Prisma version is invalid. Check the project dependencies and lockfile.');
  const major = version.split('.')[0];
  if (Number(major) < 2 || Number(major) > 8) throw new Error(`Prisma ${installed.version} is unsupported. Portal supports Prisma 2–7 generate and Prisma 8 contract emit.`);
  const bin = typeof installed.bin === 'string' ? installed.bin : installed.bin?.prisma;
  if (typeof bin !== 'string' || !bin) throw new Error('The installed Prisma package has no CLI entry point. Check the project dependencies and lockfile.');
  const cli = resolve(packageDirectory, bin);
  if (isAbsolute(bin) || !inside(packageDirectory, cli)) throw new Error('The Prisma CLI entry point must stay inside its package.');
  if (!await stat(cli).then(item => item.isFile()).catch(() => false)) throw new Error('The installed Prisma CLI entry point is missing. Check the project dependencies and lockfile.');
  // pnpm can link the entire package; a bin link must still stay within that
  // resolved package rather than selecting an unrelated executable.
  if (!inside(await realpath(packageDirectory), await realpath(cli))) throw new Error('The Prisma CLI entry point must stay inside its package.');
  return { cli, args: Number(major) === 8 ? ['contract', 'emit'] : ['generate'] };
}
