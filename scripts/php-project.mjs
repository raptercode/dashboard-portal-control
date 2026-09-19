import { isAbsolute, join, relative } from 'node:path';
import { lstat, readFile, realpath, rm, writeFile } from 'node:fs/promises';

const COMPOSER_PATHS = Object.freeze(['/usr/local/bin/composer', '/usr/bin/composer']);

export function phpSettings(input) {
  const phpMode = input.phpMode ?? 'server';
  const phpDocroot = input.phpDocroot ?? 'public';
  const phpRouter = input.phpRouter ?? '';
  const phpInstall = input.phpInstall ?? 'composer';
  if (!['artisan', 'spark', 'server'].includes(phpMode)) throw new Error('PHP run type is invalid.');
  if (!['composer', 'none'].includes(phpInstall)) throw new Error('PHP dependency source is invalid.');
  validateLocalPath(phpDocroot, 'PHP document root');
  if (phpRouter) validateLocalFile(phpRouter, '.php', 'PHP router');
  return { phpMode, phpDocroot, phpRouter: phpRouter || '', phpInstall };
}

export function phpExecutable(platform = process.platform) {
  if (process.env.HOSTMGR_PHP_PATH) return process.env.HOSTMGR_PHP_PATH;
  return platform === 'win32' ? 'php.exe' : '/usr/bin/php';
}

export function phpComposerCandidates() {
  if (process.env.HOSTMGR_COMPOSER_PATH) return [process.env.HOSTMGR_COMPOSER_PATH];
  return [...COMPOSER_PATHS];
}

export function phpStartArgs(input, port) {
  const { phpMode, phpDocroot, phpRouter } = phpSettings(input);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PHP service port is invalid.');
  if (phpMode === 'artisan') return ['artisan', 'serve', '--host', '127.0.0.1', '--port', String(port)];
  if (phpMode === 'spark') return ['spark', 'serve', '--host', '127.0.0.1', '--port', String(port)];
  return ['-S', `127.0.0.1:${port}`, '-t', phpDocroot, ...(phpRouter ? [phpRouter] : [])];
}

export async function assertPhpSource(root, input) {
  const settings = phpSettings(input);
  if (!(await lstat(root)).isDirectory()) throw new Error('PHP release must be a real directory.');
  const actualRoot = await realpath(root);
  const required = [
    ...(settings.phpMode === 'artisan' ? [{ path: 'artisan', file: true }] : []),
    ...(settings.phpMode === 'spark' ? [{ path: 'spark', file: true }] : []),
    ...(settings.phpMode === 'server' ? [{ path: settings.phpDocroot, file: false }] : []),
    ...(settings.phpMode === 'server' && settings.phpRouter ? [{ path: settings.phpRouter, file: true }] : []),
    ...(settings.phpInstall === 'composer' ? [{ path: 'composer.json', file: true }] : [])
  ];
  for (const item of required) {
    const actual = await realpath(join(root, item.path)).catch(() => null);
    const path = actual && relative(actualRoot, actual);
    if (!actual || path.startsWith('..') || isAbsolute(path)) throw new Error(`PHP project file is missing or outside the release: ${item.path}`);
    const details = await lstat(actual);
    if (item.file ? !details.isFile() : !details.isDirectory()) throw new Error(`PHP project file is missing or outside the release: ${item.path}`);
  }
  return settings;
}

export function phpProcessEnvironment(releaseRoot, baseEnvironment = process.env) {
  const environment = Object.fromEntries(['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'TZ'].filter((key) => baseEnvironment[key]).map((key) => [key, baseEnvironment[key]]));
  return {
    ...environment,
    PATH: process.platform === 'win32' ? (baseEnvironment.PATH ?? '') : '/usr/local/bin:/usr/bin:/bin',
    HOME: releaseRoot,
    COMPOSER_HOME: join(releaseRoot, '.composer'),
    COMPOSER_CACHE_DIR: join(releaseRoot, '.composer', 'cache'),
    COMPOSER_NO_INTERACTION: '1'
  };
}

export function phpUserOptions(identity, releaseRoot) {
  if (!Number.isInteger(identity.uid) || identity.uid <= 0 || !Number.isInteger(identity.gid) || identity.gid <= 0) throw new Error('PHP installation requires a non-root project user and group.');
  return { cwd: releaseRoot, uid: identity.uid, gid: identity.gid, env: phpProcessEnvironment(releaseRoot), timeout: 300_000 };
}

export async function preparePhpEnvironment(releaseRoot, input, runAsProject, { php = phpExecutable(), composerCandidates = phpComposerCandidates() } = {}) {
  const settings = await assertPhpSource(releaseRoot, input);
  const marker = join(releaseRoot, '.hostmgr-php-ready');
  const expected = JSON.stringify({ ...settings, php });
  const markerFile = await lstat(marker).catch(() => null);
  if (markerFile?.isFile() && await readFile(marker, 'utf8') === expected) {
    await runAsProject(php, ['-v']);
    return { reused: true };
  }
  await rm(marker, { force: true });
  try {
    await runAsProject(php, ['-v']);
    if (settings.phpInstall === 'composer') {
      const composer = await resolveComposer(runAsProject, composerCandidates);
      await runAsProject(composer, ['install', '--no-dev', '--no-interaction', '--prefer-dist', '--no-progress', '--optimize-autoloader', '--no-ansi']);
    }
    await writeFile(marker, expected, { mode: 0o600 });
    return { reused: false };
  } catch (error) {
    await rm(marker, { force: true });
    throw error;
  }
}

async function resolveComposer(runAsProject, candidates) {
  for (const candidate of candidates) {
    try {
      await runAsProject(candidate, ['--version']);
      return candidate;
    } catch { /* continue */ }
  }
  throw new Error('Composer is missing. Install Composer on the host before deploying this PHP project.');
}

function validateLocalPath(value, label) {
  if (value === '.') return value;
  if (typeof value !== 'string' || value.length > 240 || !/^[A-Za-z0-9_-][A-Za-z0-9_./-]*$/.test(value) || value.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error(`${label} must be a local path, not a shell command.`);
}

function validateLocalFile(value, extension, label) {
  if (typeof value !== 'string' || value.length > 240 || !/^[A-Za-z0-9_-][A-Za-z0-9_./-]*$/.test(value) || value.split('/').some((part) => !part || part === '.' || part === '..') || !value.endsWith(extension)) throw new Error(`${label} must be a local ${extension} file path, not a shell command.`);
}
