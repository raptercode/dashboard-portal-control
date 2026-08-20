import { isAbsolute, relative, resolve } from 'node:path';
import { realpath, stat, readFile } from 'node:fs/promises';
import { InputError } from './core.mjs';

const MAX_INSPECT_BYTES = 256 * 1024;
const COMPOSE_FILES = Object.freeze(['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml']);

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

  const [packageText, packageLock, bunLock, bunConfig, dockerfile, ...composeTexts] = await Promise.all([
    safeRead(root, appRoot, 'package.json'),
    safeRead(root, appRoot, 'package-lock.json'),
    safeRead(root, appRoot, 'bun.lock'),
    safeRead(root, appRoot, 'bunfig.toml'),
    safeRead(root, appRoot, 'Dockerfile'),
    ...COMPOSE_FILES.map((file) => safeRead(root, appRoot, file))
  ]);

  let packageJson = null;
  let packageWarning = null;
  if (packageText) {
    try { packageJson = JSON.parse(packageText); }
    catch { packageWarning = 'พบ package.json แต่ไฟล์ไม่ใช่ JSON ที่อ่านได้'; }
  }
  const composeIndex = composeTexts.findIndex(Boolean);
  const composeFile = composeIndex >= 0 ? COMPOSE_FILES[composeIndex] : null;
  const composeServices = composeIndex >= 0 ? composeServiceNames(composeTexts[composeIndex]) : [];
  const packageManager = typeof packageJson?.packageManager === 'string' ? packageJson.packageManager.toLowerCase() : '';
  const bun = Boolean(bunLock || bunConfig || packageManager.startsWith('bun@'));
  const node = Boolean(packageJson || packageLock);
  const scripts = packageScripts(packageJson);
  const evidence = [
    ...(composeFile ? [{ kind: 'compose', path: composeFile, label: 'Docker Compose' }] : []),
    ...(dockerfile ? [{ kind: 'dockerfile', path: 'Dockerfile', label: 'Dockerfile' }] : []),
    ...(packageJson ? [{ kind: 'package', path: 'package.json', label: 'Node package' }] : []),
    ...(bunLock ? [{ kind: 'bun-lock', path: 'bun.lock', label: 'Bun lockfile' }] : []),
    ...(bunConfig ? [{ kind: 'bun-config', path: 'bunfig.toml', label: 'Bun configuration' }] : []),
    ...(packageLock ? [{ kind: 'node-lock', path: 'package-lock.json', label: 'npm lockfile' }] : [])
  ];

  if (composeFile) {
    return {
      available: true,
      recommendedRuntime: 'docker-compose',
      confidence: composeServices.length ? 'high' : 'needs-review',
      evidence,
      composeFile,
      composeService: composeServices[0] ?? null,
      composeServices,
      buildScript: null,
      startScript: null,
      notice: composeServices.length
        ? `พบ ${composeFile} และ service ${composeServices[0]}`
        : `พบ ${composeFile}; เลือก web service ก่อน sync`
    };
  }
  if (bun) {
    return {
      available: true,
      recommendedRuntime: 'bun',
      confidence: packageJson ? 'high' : 'needs-review',
      evidence,
      composeFile: null,
      composeService: null,
      composeServices: [],
      ...scripts,
      notice: packageWarning ?? (dockerfile
        ? 'พบ Dockerfile ด้วย แต่ไม่มี Compose file; เลือก Bun จากไฟล์ project'
        : 'ตรวจพบ Bun จาก lockfile, config หรือ package manager')
    };
  }
  if (node) {
    return {
      available: true,
      recommendedRuntime: 'node',
      confidence: packageJson ? 'high' : 'needs-review',
      evidence,
      composeFile: null,
      composeService: null,
      composeServices: [],
      ...scripts,
      notice: packageWarning ?? (dockerfile
        ? 'พบ Dockerfile ด้วย แต่ไม่มี Compose file; เลือก Node จาก package metadata'
        : 'ตรวจพบ Node.js project จาก package metadata')
    };
  }
  return {
    available: false,
    recommendedRuntime: null,
    confidence: 'unknown',
    evidence,
    composeFile: null,
    composeService: null,
    composeServices: [],
    buildScript: null,
    startScript: null,
    notice: dockerfile
      ? 'พบ Dockerfile แต่ยังไม่พบ Compose file ที่ Portal รองรับ; เพิ่ม compose.yaml แล้วตรวจอีกครั้ง'
      : 'ไม่พบ package.json, Bun metadata หรือ Compose file ใน directory นี้; เลือก runtime เองได้'
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

function packageScripts(packageJson) {
  const scripts = packageJson?.scripts && typeof packageJson.scripts === 'object' && !Array.isArray(packageJson.scripts)
    ? packageJson.scripts
    : {};
  const named = (name) => typeof scripts[name] === 'string' && scripts[name].trim() ? name : null;
  return { buildScript: named('build'), startScript: named('start') };
}

// The helper remains the source of truth for Compose validation. This small
// parser only suggests a first service for a human to review in the wizard.
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
