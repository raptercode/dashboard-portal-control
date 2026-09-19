import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile, chmod, chown, symlink } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pythonSettings, pythonExecutable, pythonStartArgs, pythonProcessEnvironment, pythonUserOptions, preparePythonEnvironment } from '../scripts/python-project.mjs';
import { InputError, SecretVault, validateProjectSync } from '../src/core.mjs';
import { createRelease, renderSystemdUnit, validateNativeProject } from '../src/native-project.mjs';
import { preparePythonRelease } from '../src/server.mjs';
import { scanProjectRuntimeDirectory } from '../src/project-runtime.mjs';

const exec = promisify(execFile);
const project = { name: 'Python API', slug: 'python-api', repository: 'https://github.com/example/python.git', branch: 'main', port: 3100, runtime: 'python', pythonMode: 'script', pythonEntry: 'main.py', pythonInstall: 'requirements', pythonRequirements: 'requirements.txt' };

test('Python accepts typed entry points and requires a non-root installation identity', () => {
  const native = validateNativeProject(validateProjectSync(project));
  assert.equal(native.startScript, null);
  assert.equal(native.buildScript, null);
  assert.equal(createRelease(native).pythonEntry, 'main.py');
  assert.match(renderSystemdUnit(native), /User=hostmgr-python-api/);
  assert.match(renderSystemdUnit(native), /ExecStart=\/srv\/hostmgr\/projects\/python-api\/current\/\.venv\/bin\/python -E -s -u main.py/);
  assert.deepEqual(pythonStartArgs({ pythonMode: 'asgi', pythonEntry: 'app.main:app' }, 3100), ['-E', '-s', '-u', '-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '3100']);
  assert.deepEqual(pythonStartArgs({ pythonMode: 'wsgi', pythonEntry: 'project.wsgi:application' }, 3100).slice(-3), ['--bind', '127.0.0.1:3100', 'project.wsgi:application']);
  for (const pythonEntry of ['../main.py', '/tmp/main.py', 'main.py;id', 'main.py\n', 'main.py --flag']) assert.throws(() => validateProjectSync({ ...project, pythonEntry }), InputError);
  assert.throws(() => pythonSettings({ pythonMode: 'asgi', pythonEntry: 'app:create()' }));
  assert.throws(() => pythonSettings({ pythonRequirements: '../root.txt' }));
  assert.throws(() => pythonUserOptions({ uid: 0, gid: 1000 }, '/srv/project'), /non-root/);
  assert.throws(() => pythonUserOptions({ uid: 1000, gid: 0 }, '/srv/project'), /non-root/);
  const options = pythonUserOptions({ uid: 1001, gid: 1002 }, '/srv/project');
  assert.equal(options.uid, 1001);
  assert.equal(options.gid, 1002);
  const environment = pythonProcessEnvironment('/srv/project', { HOSTMGR_SECRET_KEY: 'secret', PYTHONHOME: '/root', PYTHONPATH: '/root', PIP_TARGET: '/root', PIP_USER: '1' });
  for (const key of ['HOSTMGR_SECRET_KEY', 'PYTHONHOME', 'PYTHONPATH', 'PIP_TARGET', 'PIP_USER']) assert.equal(environment[key], undefined);
  assert.equal(environment.PIP_REQUIRE_VIRTUALENV, 'true');
});

test('Python detection and source preflight exclude supplied venvs and reserve runtime paths', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'hostmgr-python-source-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, project.slug, 'repository');
  await mkdir(join(source, '.venv'), { recursive: true });
  await writeFile(join(source, '.venv', 'do-not-copy'), 'untrusted environment');
  await writeFile(join(source, '.hostmgr-python-ready'), 'untrusted marker');
  await writeFile(join(source, 'main.py'), 'print("test")\n');
  await writeFile(join(source, 'requirements.txt'), '');
  const detected = await scanProjectRuntimeDirectory(source);
  assert.equal(detected.recommendedRuntime, 'python');
  assert.equal(detected.pythonInstall, 'requirements');
  const release = createRelease(project);
  const vault = new SecretVault(Buffer.alloc(32, 7).toString('base64'));
  await preparePythonRelease(project, release, { environment: { encryptedContent: vault.encrypt('PORT=9999\nPATH=/root\nPYTHONHOME=/root\nAPI_KEY=test-secret\n') } }, vault, root);
  const candidate = join(root, project.slug, 'releases', release.id);
  await assert.rejects(stat(join(candidate, '.venv')), { code: 'ENOENT' });
  await assert.rejects(stat(join(candidate, '.hostmgr-python-ready')), { code: 'ENOENT' });
  const environment = await readFile(join(candidate, '.env'), 'utf8');
  assert.match(environment, /PORT=3100/);
  assert.match(environment, /VIRTUAL_ENV=\/srv\/hostmgr\/projects\/python-api\/releases\//);
  assert.doesNotMatch(environment, /\/root|PORT=9999/);
  assert.equal(await readFile(join(source, '.venv', 'do-not-copy'), 'utf8'), 'untrusted environment');
  await rm(join(source, 'requirements.txt'));
  assert.equal((await scanProjectRuntimeDirectory(source)).pythonInstall, 'none');
  await writeFile(join(source, 'pyproject.toml'), '[project]\nname="test"\n');
  assert.equal((await scanProjectRuntimeDirectory(source)).pythonInstall, 'project');
});

test('real Python venv installs an offline wheel, serves HTTP, reuses rollback dependencies and isolates failed releases', { timeout: 300_000 }, async (t) => {
  const interpreter = process.env.HOSTMGR_PYTHON_PATH || (process.platform === 'win32' ? 'python.exe' : '/usr/bin/python3');
  try { execFileSync(interpreter, ['-I', '-c', 'import venv,ensurepip'], { stdio: 'pipe' }); }
  catch { t.skip('Python with venv and ensurepip is required; set HOSTMGR_PYTHON_PATH.'); return; }
  const root = await mkdtemp(join(tmpdir(), 'hostmgr-python-venv-'));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  const first = join(root, 'release-one');
  await mkdir(first);
  // A tiny wheel keeps this integration test offline while exercising real pip.
  const wheel = join(first, 'portal_fixture-1.0-py3-none-any.whl');
  await exec(interpreter, ['-I', '-c', `import sys,zipfile
with zipfile.ZipFile(sys.argv[1], 'w') as z:
 z.writestr('portal_fixture.py', 'VALUE = "venv-only"\\n')
 z.writestr('portal_fixture-1.0.dist-info/METADATA', 'Metadata-Version: 2.1\\nName: portal-fixture\\nVersion: 1.0\\n')
 z.writestr('portal_fixture-1.0.dist-info/WHEEL', 'Wheel-Version: 1.0\\nGenerator: test\\nRoot-Is-Purelib: true\\nTag: py3-none-any\\n')
 z.writestr('portal_fixture-1.0.dist-info/RECORD', '')`, wheel]);
  await writeFile(join(first, 'requirements.txt'), '--no-index\n./portal_fixture-1.0-py3-none-any.whl\n');
  await writeFile(join(first, 'main.py'), `import http.server,os,sys,portal_fixture
assert sys.prefix != sys.base_prefix
class Handler(http.server.BaseHTTPRequestHandler):
 def do_GET(self):
  self.send_response(200); self.end_headers(); self.wfile.write(portal_fixture.VALUE.encode())
http.server.HTTPServer((os.environ['HOST'],int(os.environ['PORT'])),Handler).serve_forever()
`);
  const identity = process.platform === 'win32' ? null : { uid: process.getuid() || 65534, gid: process.getgid() || 65534 };
  if (identity && process.getuid() === 0) {
    await chmod(root, 0o755);
    await chown(first, identity.uid, identity.gid);
  }
  const options = (directory) => identity ? pythonUserOptions(identity, directory) : { cwd: directory, env: pythonProcessEnvironment(directory), timeout: 120_000 };
  const calls = [];
  const run = (directory) => async (command, args) => { calls.push([command, args]); const result = await exec(command, args, options(directory)); return result.stdout; };
  await preparePythonEnvironment(first, project, run(first), { interpreter });
  assert.ok(calls.filter(([, args]) => args.includes('pip')).every(([command]) => command === pythonExecutable(first)));
  await assert.rejects(exec(interpreter, ['-I', '-c', 'import portal_fixture']), /portal_fixture/);
  assert.match((await exec(pythonExecutable(first), ['-I', '-c', 'import portal_fixture; print(portal_fixture.VALUE)'], options(first))).stdout, /venv-only/);
  assert.match(await readFile(join(first, '.venv', 'pyvenv.cfg'), 'utf8'), /include-system-site-packages = false/);
  const listener = createServer();
  await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  const current = join(root, 'current');
  await symlink(first, current, process.platform === 'win32' ? 'junction' : 'dir');
  const child = spawn(pythonExecutable(current), pythonStartArgs(project, port), { ...options(first), env: { ...options(first).env, HOST: '127.0.0.1', PORT: String(port) }, stdio: 'ignore' });
  const closed = new Promise((resolve) => child.once('close', resolve));
  t.after(async () => { child.kill(); await closed; });
  let response;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(200) }).catch(() => null);
    if (response?.ok) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(await response?.text(), 'venv-only');
  calls.length = 0;
  assert.equal((await preparePythonEnvironment(first, project, run(first), { interpreter })).reused, true);
  assert.ok(calls.every(([, args]) => !args.includes('pip')), 'rollback must not reinstall dependencies');
  const second = join(root, 'release-two');
  await mkdir(second);
  await writeFile(join(second, 'main.py'), 'print("test")\n');
  await writeFile(join(second, 'requirements.txt'), '--no-index\n./missing-1.0-py3-none-any.whl\n');
  if (identity && process.getuid() === 0) await chown(second, identity.uid, identity.gid);
  await assert.rejects(preparePythonEnvironment(second, project, run(second), { interpreter }));
  await assert.rejects(stat(join(second, '.hostmgr-python-ready')), { code: 'ENOENT' });
  assert.equal(await (await fetch(`http://127.0.0.1:${port}/`)).text(), 'venv-only');
  const packaged = join(root, 'release-package');
  await mkdir(packaged);
  await writeFile(join(packaged, 'main.py'), 'import portal_fixture\n');
  await writeFile(join(packaged, 'pyproject.toml'), '[build-system]\nrequires = []\nbuild-backend = "backend"\nbackend-path = ["."]\n');
  await writeFile(join(packaged, 'backend.py'), `import os,pathlib,zipfile
def build_wheel(wheel_directory,config_settings=None,metadata_directory=None):
 assert not hasattr(os,'geteuid') or os.geteuid() != 0
 pathlib.Path('backend-user.txt').write_text(str(os.geteuid()) if hasattr(os,'geteuid') else 'windows-user')
 filename='portal_fixture-1.0-py3-none-any.whl'
 with zipfile.ZipFile(str(pathlib.Path(wheel_directory)/filename),'w') as z:
  z.writestr('portal_fixture.py','VALUE="project-venv"\\n')
  z.writestr('portal_fixture-1.0.dist-info/METADATA','Metadata-Version: 2.1\\nName: portal-fixture\\nVersion: 1.0\\n')
  z.writestr('portal_fixture-1.0.dist-info/WHEEL','Wheel-Version: 1.0\\nGenerator: test\\nRoot-Is-Purelib: true\\nTag: py3-none-any\\n')
  z.writestr('portal_fixture-1.0.dist-info/RECORD','')
 return filename
`);
  if (identity && process.getuid() === 0) await chown(packaged, identity.uid, identity.gid);
  await preparePythonEnvironment(packaged, { ...project, pythonInstall: 'project' }, run(packaged), { interpreter });
  assert.equal(await readFile(join(packaged, 'backend-user.txt'), 'utf8'), identity ? String(identity.uid) : 'windows-user');
  assert.match((await exec(pythonExecutable(packaged), ['-I', '-c', 'import portal_fixture; print(portal_fixture.VALUE)'], options(packaged))).stdout, /project-venv/);
  child.kill();
  await closed;
});
