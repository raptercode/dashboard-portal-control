import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InputError, SecretVault, validateProjectSync } from '../src/core.mjs';
import { createRelease, renderSystemdUnit, validateNativeProject } from '../src/native-project.mjs';
import { prepareGoRelease } from '../src/server.mjs';
import { scanProjectRuntimeDirectory } from '../src/project-runtime.mjs';

const project = { name: 'Go API', slug: 'go-api', repository: 'https://github.com/example/api.git', branch: 'main', directory: '/', port: 3100, runtime: 'go', goPackage: './cmd/api', healthCheckEnabled: true, healthCheckPath: '/ready' };

test('Go configuration accepts only a local package and executes a fixed binary', () => {
  const synced = validateProjectSync(project);
  assert.equal(synced.goPackage, './cmd/api');
  assert.equal(synced.startScript, null);
  const native = validateNativeProject(synced);
  assert.equal(native.buildScript, null);
  assert.equal(native.startScript, null);
  assert.equal(validateNativeProject({ ...project, goPackage: undefined }).goPackage, '.');
  for (const goPackage of ['../api', './cmd/../api', '-o /tmp/app', './...', 'main.go', './cmd/api;id', '/tmp/api', './cmd/api\n', './cmd\\api']) {
    assert.throws(() => validateProjectSync({ ...project, goPackage }), InputError);
    assert.throws(() => validateNativeProject({ ...project, goPackage }), InputError);
  }
  const unit = renderSystemdUnit(native);
  assert.match(unit, /ExecStart=\/srv\/hostmgr\/projects\/go-api\/current\/hostmgr-app\n/);
  assert.doesNotMatch(unit, /npm|bun|go run/);
  assert.match(unit, /Environment=PORT=3100/);
  assert.equal(createRelease(native).runtime, 'go');
});

test('Go detection reads go.mod in the selected directory and still prefers Compose', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'hostmgr-go-detect-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'api'));
  await writeFile(join(root, 'api', 'go.mod'), 'module example.com/api\ngo 1.22.0\n');
  await writeFile(join(root, 'api', 'package.json'), '{"scripts":{"build":"frontend"}}');
  const result = await scanProjectRuntimeDirectory(root, '/api');
  assert.equal(result.recommendedRuntime, 'go');
  assert.equal(result.goPackage, '.');
  assert.ok(result.evidence.some((item) => item.path === 'go.mod'));
  await writeFile(join(root, 'api', 'compose.yaml'), 'services:\n  web:\n    build: .\n');
  assert.equal((await scanProjectRuntimeDirectory(root, '/api')).recommendedRuntime, 'docker-compose');
});

test('real Go candidate builds a nested HTTP main package and rejects library and broken builds', { timeout: 180_000 }, async (t) => {
  const go = process.env.HOSTMGR_GO_PATH || (process.platform === 'win32' ? 'C:\\Program Files\\Go\\bin\\go.exe' : '/usr/local/bin/go');
  try { execFileSync(go, ['version'], { stdio: 'pipe' }); }
  catch { t.skip('Install Go or set HOSTMGR_GO_PATH to run the compiler integration test.'); return; }
  const previousGo = process.env.HOSTMGR_GO_PATH;
  const previousSecret = process.env.HOSTMGR_SECRET_KEY;
  process.env.HOSTMGR_SECRET_KEY = 'test-control-plane-secret';
  process.env.HOSTMGR_GO_PATH = go;
  const root = await mkdtemp(join(tmpdir(), 'hostmgr-go-build-'));
  t.after(async () => {
    if (previousGo === undefined) delete process.env.HOSTMGR_GO_PATH;
    else process.env.HOSTMGR_GO_PATH = previousGo;
    if (previousSecret === undefined) delete process.env.HOSTMGR_SECRET_KEY;
    else process.env.HOSTMGR_SECRET_KEY = previousSecret;
    await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  });
  const source = join(root, project.slug, 'repository');
  await mkdir(join(source, 'cmd', 'api'), { recursive: true });
  const module = 'module example.com/api\n\ngo 1.22.0\n';
  await writeFile(join(source, 'go.mod'), module);
  await writeFile(join(source, 'cmd', 'api', 'main.go'), `package main
import ("net/http"; "os"; "log")
func main() {
  if os.Getenv("HOSTMGR_SECRET_KEY") != "" { log.Fatal("control-plane environment leaked") }
  http.HandleFunc("/ready", func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("ready")) })
  log.Fatal(http.ListenAndServe(os.Getenv("HOST") + ":" + os.Getenv("PORT"), nil))
}
`);
  const listener = createServer();
  await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  const candidate = validateNativeProject({ ...project, candidatePort: port });
  const release = createRelease(candidate);
  const events = [];
  const vault = new SecretVault(Buffer.alloc(32, 7).toString('base64'));
  const stored = { environment: { encryptedContent: vault.encrypt('PORT=1\nHOST=invalid-host\nAPP_MODE=test\n') } };
  await prepareGoRelease(candidate, release, stored, vault, root, async (...event) => events.push(event));
  const binary = join(root, project.slug, 'releases', release.id, process.platform === 'win32' ? 'hostmgr-app.exe' : 'hostmgr-app');
  assert.ok((await stat(binary)).size > 0);
  const environment = await readFile(join(root, project.slug, 'releases', release.id, '.env'), 'utf8');
  assert.match(environment, /PORT=3100\nHOST=127.0.0.1/);
  assert.doesNotMatch(environment, /PORT=1\n|invalid-host/);
  assert.ok(events.some(([phase, status]) => phase === 'build' && status === 'passed'));
  assert.equal(await readFile(join(source, 'go.mod'), 'utf8'), module);
  await writeFile(join(source, 'library.go'), 'package api\n');
  const library = createRelease({ ...candidate, goPackage: '.' });
  await assert.rejects(prepareGoRelease({ ...candidate, goPackage: '.' }, library, {}, null, root), /executable main package/);
  await assert.rejects(stat(join(root, project.slug, 'releases', library.id)), { code: 'ENOENT' });
  await writeFile(join(source, 'cmd', 'api', 'main.go'), 'package main\nfunc main() { missing() }\n');
  const broken = createRelease(candidate);
  await assert.rejects(prepareGoRelease(candidate, broken, {}, null, root), /Go build failed/);
  assert.ok((await stat(binary)).size > 0, 'a failed build preserves the prior candidate');
});
