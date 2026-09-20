import { isAbsolute, relative, resolve } from 'node:path';
import { realpath, stat, readFile } from 'node:fs/promises';
import { InputError } from './core.mjs';

const MAX_INSPECT_BYTES = 256 * 1024;
const COMPOSE_FILES = Object.freeze(['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml']);

const FRAMEWORK_LABELS = Object.freeze({
  next: 'Next.js', nuxt: 'Nuxt', express: 'Express', nestjs: 'NestJS', fastify: 'Fastify',
  hono: 'Hono', remix: 'Remix', sveltekit: 'SvelteKit', astro: 'Astro', angular: 'Angular',
  elysia: 'Elysia', django: 'Django', flask: 'Flask', fastapi: 'FastAPI', laravel: 'Laravel',
  codeigniter: 'CodeIgniter', symfony: 'Symfony', slim: 'Slim', cakephp: 'CakePHP'
});

/**
 * Inspects only checked-out metadata. It never executes repository code and
 * refuses to follow a repository symlink outside of the requested checkout.
 */
export async function scanProjectRuntimeDirectory(repositoryRoot, directory = '/') {
  const root = await realpath(repositoryRoot);
  const target = resolve(root, `.${directory}`);
  if (!inside(root, target)) throw new InputError('Repository directory is invalid.');
  const appRoot = await realpath(target).catch(() => null);
  if (!appRoot || !inside(root, appRoot)) throw new InputError('The selected directory was not found inside the repository.');

  const [packageText, packageLock, bunLock, bunConfig, dockerfile, goMod, requirements, pyproject, pythonMain, managePy, composerText, artisan, spark, ...composeTexts] = await Promise.all([
    safeRead(root, appRoot, 'package.json'),
    safeRead(root, appRoot, 'package-lock.json'),
    safeRead(root, appRoot, 'bun.lock'),
    safeRead(root, appRoot, 'bunfig.toml'),
    safeRead(root, appRoot, 'Dockerfile'),
    safeRead(root, appRoot, 'go.mod'),
    safeRead(root, appRoot, 'requirements.txt'),
    safeRead(root, appRoot, 'pyproject.toml'),
    safeRead(root, appRoot, 'main.py'),
    safeRead(root, appRoot, 'manage.py'),
    safeRead(root, appRoot, 'composer.json'),
    safeRead(root, appRoot, 'artisan'),
    safeRead(root, appRoot, 'spark'),
    ...COMPOSE_FILES.map((file) => safeRead(root, appRoot, file))
  ]);

  let packageJson = null;
  let packageWarning = null;
  if (packageText) {
    try { packageJson = JSON.parse(packageText); }
    catch { packageWarning = 'พบ package.json แต่ไฟล์ไม่ใช่ JSON ที่อ่านได้'; }
  }
  let composerJson = null;
  if (composerText) {
    try { composerJson = JSON.parse(composerText); }
    catch { composerJson = {}; }
  }
  const composeIndex = composeTexts.findIndex(Boolean);
  const composeFile = composeIndex >= 0 ? COMPOSE_FILES[composeIndex] : null;
  const composeServices = composeIndex >= 0 ? composeServiceNames(composeTexts[composeIndex]) : [];
  const packageManager = typeof packageJson?.packageManager === 'string' ? packageJson.packageManager.toLowerCase() : '';
  const bun = Boolean(bunLock || bunConfig || packageManager.startsWith('bun@'));
  const node = Boolean(packageJson || packageLock);
  const scripts = packageScripts(packageJson);
  const phpKind = phpFramework(composerJson, artisan, spark);
  const evidence = [
    ...(requirements !== null ? [{ kind: 'python-requirements', path: 'requirements.txt', label: 'Python dependencies' }] : []),
    ...(pyproject !== null ? [{ kind: 'python-project', path: 'pyproject.toml', label: 'Python project' }] : []),
    ...(pythonMain !== null ? [{ kind: 'python-entry', path: 'main.py', label: 'Python entry' }] : []),
    ...(managePy !== null ? [{ kind: 'django-manage', path: 'manage.py', label: 'Django manage.py' }] : []),
    ...(composerJson ? [{ kind: 'php-composer', path: 'composer.json', label: 'PHP Composer' }] : []),
    ...(artisan !== null ? [{ kind: 'php-artisan', path: 'artisan', label: 'Laravel artisan' }] : []),
    ...(spark !== null ? [{ kind: 'php-spark', path: 'spark', label: 'CodeIgniter spark' }] : []),
    ...(goMod ? [{ kind: 'go-module', path: 'go.mod', label: 'Go module' }] : []),
    ...(composeFile ? [{ kind: 'compose', path: composeFile, label: 'Docker Compose' }] : []),
    ...(dockerfile ? [{ kind: 'dockerfile', path: 'Dockerfile', label: 'Dockerfile' }] : []),
    ...(packageJson ? [{ kind: 'package', path: 'package.json', label: 'Node package' }] : []),
    ...(bunLock ? [{ kind: 'bun-lock', path: 'bun.lock', label: 'Bun lockfile' }] : []),
    ...(bunConfig ? [{ kind: 'bun-config', path: 'bunfig.toml', label: 'Bun configuration' }] : []),
    ...(packageLock ? [{ kind: 'node-lock', path: 'package-lock.json', label: 'npm lockfile' }] : [])
  ];

  const framework = packageFramework(packageJson);
  const phpProject = Boolean(phpKind || artisan !== null || spark !== null);
  const pythonProject = requirements !== null || pyproject !== null || pythonMain !== null || managePy !== null;
  const candidates = [];

  if (composeFile) {
    candidates.push({
      runtime: 'docker-compose',
      framework: null,
      confidence: composeServices.length ? 'high' : 'needs-review',
      composeFile,
      composeService: composeServices[0] ?? null,
      composeServices,
      buildScript: null,
      startScript: null,
      notice: composeServices.length
        ? `พบ ${composeFile} และ service ${composeServices[0]}`
        : `พบ ${composeFile}; เลือก web service ก่อน sync`
    });
  }
  if (phpProject) {
    candidates.push({
      runtime: 'php',
      framework: phpKind,
      confidence: phpKind ? 'high' : 'needs-review',
      composeFile: null,
      composeService: null,
      composeServices: [],
      buildScript: null,
      startScript: null,
      ...phpPreset(phpKind),
      notice: phpKind
        ? `พบ ${frameworkLabel(phpKind)}; ตรวจ document root และวิธีรันก่อน deploy`
        : 'พบ PHP project; ตรวจ document root และ Composer ก่อน deploy'
    });
  }
  if (goMod) {
    candidates.push({
      runtime: 'go',
      framework: null,
      confidence: 'needs-review',
      composeFile: null,
      composeService: null,
      composeServices: [],
      buildScript: null,
      startScript: null,
      goPackage: '.',
      notice: 'พบ go.mod; เลือก main package เช่น . หรือ ./cmd/api และให้แอปอ่าน PORT จาก environment'
    });
  }
  if (pythonProject) {
    const pythonKind = pythonFramework(requirements, pyproject, managePy);
    candidates.push({
      runtime: 'python',
      framework: pythonKind,
      confidence: 'needs-review',
      composeFile: null,
      composeService: null,
      composeServices: [],
      buildScript: null,
      startScript: null,
      ...pythonPreset(pythonKind),
      pythonInstall: requirements !== null ? 'requirements' : pyproject !== null ? 'project' : 'none',
      pythonRequirements: 'requirements.txt',
      notice: pythonKind
        ? `พบ ${frameworkLabel(pythonKind)}; ตรวจ entry point ก่อน deploy ระบบจะสร้าง .venv และติดตั้งด้วย user ของโปรเจกต์`
        : 'พบ Python project; ตรวจชนิดแอปและ entry point ก่อน deploy ระบบจะสร้าง .venv และติดตั้งด้วย user ของโปรเจกต์'
    });
  }
  if (bun) {
    candidates.push({
      runtime: 'bun',
      framework,
      confidence: packageJson ? 'high' : 'needs-review',
      composeFile: null,
      composeService: null,
      composeServices: [],
      ...scripts,
      notice: packageWarning ?? (framework
        ? `พบ ${frameworkLabel(framework)} บน Bun`
        : (dockerfile
          ? 'พบ Dockerfile ด้วย แต่ไม่มี Compose file; เลือก Bun จากไฟล์ project'
          : 'ตรวจพบ Bun จาก lockfile, config หรือ package manager'))
    });
  }
  if (node) {
    candidates.push({
      runtime: 'node',
      framework,
      confidence: packageJson ? 'high' : 'needs-review',
      composeFile: null,
      composeService: null,
      composeServices: [],
      ...scripts,
      notice: packageWarning ?? (framework
        ? `พบ ${frameworkLabel(framework)} จาก package metadata`
        : (dockerfile
          ? 'พบ Dockerfile ด้วย แต่ไม่มี Compose file; เลือก Node จาก package metadata'
          : 'ตรวจพบ Node.js project จาก package metadata'))
    });
  }
  if (composerJson && !phpProject) {
    candidates.push({
      runtime: 'php',
      framework: null,
      confidence: 'needs-review',
      composeFile: null,
      composeService: null,
      composeServices: [],
      buildScript: null,
      startScript: null,
      ...phpPreset(null),
      notice: 'พบ composer.json; ตรวจ document root และวิธีรันก่อน deploy'
    });
  }

  const recommended = candidates[0];
  if (!recommended) {
    return {
      available: false,
      recommendedRuntime: null,
      recommendedFramework: null,
      candidates: [],
      confidence: 'unknown',
      evidence,
      composeFile: null,
      composeService: null,
      composeServices: [],
      buildScript: null,
      startScript: null,
      notice: dockerfile
        ? 'พบ Dockerfile แต่ยังไม่พบ Compose file ที่ Portal รองรับ; เพิ่ม compose.yaml แล้วตรวจอีกครั้ง'
        : 'ไม่พบ Python metadata, PHP Composer, go.mod, package.json, Bun metadata หรือ Compose file ใน directory นี้; เลือก runtime เองได้'
    };
  }
  return {
    available: true,
    recommendedRuntime: recommended.runtime,
    recommendedFramework: recommended.framework || null,
    candidates,
    confidence: recommended.confidence,
    evidence,
    composeFile: composeFile || recommended.composeFile || null,
    composeService: composeServices[0] ?? recommended.composeService ?? null,
    composeServices,
    buildScript: recommended.buildScript ?? null,
    startScript: recommended.startScript ?? null,
    goPackage: recommended.goPackage,
    pythonMode: recommended.pythonMode,
    pythonEntry: recommended.pythonEntry,
    pythonInstall: recommended.pythonInstall,
    pythonRequirements: recommended.pythonRequirements,
    phpMode: recommended.phpMode,
    phpDocroot: recommended.phpDocroot,
    phpRouter: recommended.phpRouter,
    phpInstall: recommended.phpInstall,
    notice: recommended.notice
  };
}

function inside(root, target) {
  const path = relative(root, target);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}

async function safeRead(root, appRoot, name) {
  const candidate = resolve(appRoot, name);
  if (!inside(appRoot, candidate)) return null;
  try {
    const actual = await realpath(candidate);
    if (!inside(root, actual)) return null;
    const details = await stat(actual);
    if (!details.isFile() || details.size > MAX_INSPECT_BYTES) return null;
    return await readFile(actual, 'utf8');
  } catch { return null; }
}

function packageFramework(packageJson) {
  const deps = { ...(packageJson?.dependencies || {}), ...(packageJson?.devDependencies || {}) };
  if (deps.next) return 'next';
  if (deps.nuxt || deps['@nuxt/kit']) return 'nuxt';
  if (deps['@nestjs/core']) return 'nestjs';
  if (deps['@remix-run/node'] || deps['@remix-run/react'] || deps['@remix-run/serve']) return 'remix';
  if (deps['@sveltejs/kit']) return 'sveltekit';
  if (deps.astro) return 'astro';
  if (deps['@angular/core']) return 'angular';
  if (deps.elysia) return 'elysia';
  if (deps.hono) return 'hono';
  if (deps.fastify) return 'fastify';
  if (deps.express) return 'express';
  return null;
}

function pythonFramework(requirements, pyproject, managePy) {
  if (managePy) return 'django';
  const hay = `${requirements || ''}\n${pyproject || ''}`;
  if (/(?:^|[\s"'=\/\[])django(?:[\s"'>=<,\]]|$)/im.test(hay)) return 'django';
  if (/(?:^|[\s"'=\/\[])fastapi(?:[\s"'>=<,\]]|$)/im.test(hay)) return 'fastapi';
  if (/(?:^|[\s"'=\/\[])flask(?:[\s"'>=<,\]]|$)/im.test(hay)) return 'flask';
  return null;
}

function pythonPreset(framework) {
  if (framework === 'django') return { pythonMode: 'wsgi', pythonEntry: 'config.wsgi:application' };
  if (framework === 'fastapi') return { pythonMode: 'asgi', pythonEntry: 'app:app' };
  if (framework === 'flask') return { pythonMode: 'wsgi', pythonEntry: 'app:app' };
  return { pythonMode: 'script', pythonEntry: 'main.py' };
}

function phpFramework(composerJson, artisan, spark) {
  const require = { ...(composerJson?.require || {}), ...(composerJson?.['require-dev'] || {}) };
  if (artisan || require['laravel/framework'] || require['laravel/lumen-framework']) return 'laravel';
  if (spark || require['codeigniter4/framework'] || require['codeigniter/framework']) return 'codeigniter';
  if (require['symfony/framework-bundle'] || require['symfony/symfony']) return 'symfony';
  if (require['slim/slim']) return 'slim';
  if (require['cakephp/cakephp']) return 'cakephp';
  return null;
}

function phpPreset(framework) {
  if (framework === 'laravel') return { phpMode: 'artisan', phpDocroot: 'public', phpRouter: '', phpInstall: 'composer' };
  if (framework === 'codeigniter') return { phpMode: 'spark', phpDocroot: 'public', phpRouter: '', phpInstall: 'composer' };
  if (framework === 'cakephp') return { phpMode: 'server', phpDocroot: 'webroot', phpRouter: 'webroot/index.php', phpInstall: 'composer' };
  if (framework === 'symfony' || framework === 'slim') return { phpMode: 'server', phpDocroot: 'public', phpRouter: 'public/index.php', phpInstall: 'composer' };
  return { phpMode: 'server', phpDocroot: 'public', phpRouter: '', phpInstall: 'composer' };
}

function frameworkLabel(framework) {
  return FRAMEWORK_LABELS[framework] || framework;
}

function packageScripts(packageJson) {
  const scripts = packageJson?.scripts && typeof packageJson.scripts === 'object' && !Array.isArray(packageJson.scripts)
    ? packageJson.scripts
    : {};
  const named = (name) => typeof scripts[name] === 'string' && scripts[name].trim() ? name : null;
  return { buildScript: named('build'), startScript: named('start') };
}

function composeServiceNames(content) {
  const lines = String(content ?? '').replace(/\r\n/g, '\n').split('\n');
  const servicesAt = lines.findIndex((line) => /^services\s*:\s*(?:#.*)?$/.test(line));
  if (servicesAt < 0) return [];
  const names = [];
  for (let index = servicesAt + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\S/.test(line) && line.trim() && !line.trim().startsWith('#')) break;
    const match = line.match(/^\s{2,}([A-Za-z0-9][A-Za-z0-9_.-]{0,79})\s*:\s*(?:#.*)?$/);
    if (match) names.push(match[1]);
  }
  return [...new Set(names)];
}
