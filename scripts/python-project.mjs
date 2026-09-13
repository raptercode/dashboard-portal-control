import { delimiter, isAbsolute, join, relative } from 'node:path';
import { lstat, readFile, realpath, rm, writeFile } from 'node:fs/promises';

export function pythonSettings(input) {
  const pythonMode = input.pythonMode ?? 'script';
  const pythonEntry = input.pythonEntry ?? (pythonMode === 'script' ? 'main.py' : 'app:app');
  const pythonInstall = input.pythonInstall ?? 'requirements';
  const pythonRequirements = input.pythonRequirements ?? 'requirements.txt';
  if (!['script', 'asgi', 'wsgi'].includes(pythonMode)) throw new Error('Python run type is invalid.');
  if (!['requirements', 'project', 'none'].includes(pythonInstall)) throw new Error('Python dependency source is invalid.');
  if (pythonMode === 'script') validateLocalFile(pythonEntry, '.py', 'Python entry');
  else if (typeof pythonEntry !== 'string' || pythonEntry.length > 200 || !/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*:[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(pythonEntry)) throw new Error('Python application must use module:object syntax, for example app.main:app.');
  validateLocalFile(pythonRequirements, '.txt', 'Requirements file');
  return { pythonMode, pythonEntry, pythonInstall, pythonRequirements };
}

function validateLocalFile(value, extension, label) {
  if (typeof value !== 'string' || value.length > 240 || !/^[A-Za-z0-9_-][A-Za-z0-9_./-]*$/.test(value) || value.split('/').some((part) => !part || part === '.' || part === '..') || !value.endsWith(extension)) throw new Error(`${label} must be a local ${extension} file path, not a shell command.`);
}

export function pythonExecutable(releaseRoot, platform = process.platform) {
  return join(releaseRoot, '.venv', platform === 'win32' ? 'Scripts' : 'bin', platform === 'win32' ? 'python.exe' : 'python');
}

export function pythonStartArgs(input, port) {
  const { pythonMode, pythonEntry } = pythonSettings(input);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Python service port is invalid.');
  // Ignore ambient Python paths/user-site packages while retaining the app's
  // working directory for local imports. No shell or activation script needed.
  const args = ['-E', '-s', '-u'];
  if (pythonMode === 'asgi') return [...args, '-m', 'uvicorn', pythonEntry, '--host', '127.0.0.1', '--port', String(port)];
  if (pythonMode === 'wsgi') return [...args, '-m', 'gunicorn', '--bind', `127.0.0.1:${port}`, pythonEntry];
  return [...args, pythonEntry];
}

export async function assertPythonSource(root, input) {
  const settings = pythonSettings(input);
  if (!(await lstat(root)).isDirectory()) throw new Error('Python release must be a real directory.');
  const files = [
    ...(settings.pythonMode === 'script' ? [settings.pythonEntry] : []),
    ...(settings.pythonInstall === 'requirements' ? [settings.pythonRequirements] : []),
    ...(settings.pythonInstall === 'project' ? ['pyproject.toml'] : [])
  ];
  const actualRoot = await realpath(root);
  for (const file of files) {
    const actual = await realpath(join(root, file)).catch(() => null);
    const path = actual && relative(actualRoot, actual);
    if (!actual || path.startsWith('..') || isAbsolute(path) || !(await lstat(actual)).isFile()) throw new Error(`Python project file is missing or outside the release: ${file}`);
  }
  return settings;
}

export function pythonProcessEnvironment(releaseRoot, baseEnvironment = process.env) {
  const environment = Object.fromEntries(['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'TZ'].filter((key) => baseEnvironment[key]).map((key) => [key, baseEnvironment[key]]));
  const bin = join(releaseRoot, '.venv', process.platform === 'win32' ? 'Scripts' : 'bin');
  return {
    ...environment,
    PATH: [bin, ...(process.platform === 'win32' ? [baseEnvironment.PATH ?? ''] : ['/usr/local/bin', '/usr/bin', '/bin'])].join(delimiter),
    HOME: releaseRoot, VIRTUAL_ENV: join(releaseRoot, '.venv'),
    PYTHONNOUSERSITE: '1', PYTHONUNBUFFERED: '1',
    PIP_CONFIG_FILE: process.platform === 'win32' ? 'NUL' : '/dev/null',
    PIP_REQUIRE_VIRTUALENV: 'true'
  };
}

// Both venv creation and every pip/interpreter check must use this runner.
// The root helper supplies a real nonzero project uid/gid; it never executes
// Python project code (including build backends) as root.
export function pythonUserOptions(identity, releaseRoot) {
  if (!Number.isInteger(identity.uid) || identity.uid <= 0 || !Number.isInteger(identity.gid) || identity.gid <= 0) throw new Error('Python installation requires a non-root project user and group.');
  return { cwd: releaseRoot, uid: identity.uid, gid: identity.gid, env: pythonProcessEnvironment(releaseRoot), timeout: 300_000 };
}

export async function preparePythonEnvironment(releaseRoot, input, runAsProject, { interpreter = '/usr/bin/python3', platform = process.platform } = {}) {
  const settings = await assertPythonSource(releaseRoot, input);
  const executable = pythonExecutable(releaseRoot, platform);
  const marker = join(releaseRoot, '.hostmgr-python-ready');
  const expected = JSON.stringify({ ...settings, interpreter });
  const markerFile = await lstat(marker).catch(() => null);
  if (markerFile?.isFile() && await readFile(marker, 'utf8') === expected) {
    await verifyVenv();
    return { reused: true, executable };
  }
  await rm(marker, { force: true });
  // This exact path is below the validated release root; rm unlinks symlinks.
  await rm(join(releaseRoot, '.venv'), { recursive: true, force: true });
  try {
    await runAsProject(interpreter, ['-I', '-m', 'venv', '--copies', join(releaseRoot, '.venv')]);
    await verifyVenv();
    if (settings.pythonInstall !== 'none') {
      const install = settings.pythonInstall === 'project' ? ['.'] : ['-r', settings.pythonRequirements];
      await runAsProject(executable, ['-I', '-m', 'pip', '--require-virtualenv', '--disable-pip-version-check', 'install', '--no-input', '--no-cache-dir', '--no-user', '--prefix', join(releaseRoot, '.venv'), ...install]);
      await runAsProject(executable, ['-I', '-m', 'pip', '--require-virtualenv', '--disable-pip-version-check', 'check']);
    }
    if (settings.pythonMode !== 'script') {
      await runAsProject(executable, ['-I', '-c', `import ${settings.pythonMode === 'asgi' ? 'uvicorn' : 'gunicorn'}`]);
    }
    await writeFile(marker, expected, { mode: 0o600 });
    return { reused: false, executable };
  } catch (error) {
    await rm(marker, { force: true });
    throw error;
  }

  async function verifyVenv() {
    await runAsProject(executable, ['-I', '-c', 'import os,sys; assert sys.prefix != sys.base_prefix; assert os.path.realpath(sys.prefix) == os.path.realpath(sys.argv[1]); assert not hasattr(os,"geteuid") or os.geteuid() != 0', join(releaseRoot, '.venv')]);
  }
}
