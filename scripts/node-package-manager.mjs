import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { nodeBin } from './node-versions.mjs';

export const PNPM_VERSION = '11.19.0';
export const PNPM_PATH = '/usr/local/bin/pnpm';

export async function readNodePackageManager(directory, nodeMajor = 24) {
  const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  const pnpmLock = await stat(join(directory, 'pnpm-lock.yaml')).then(item => item.isFile()).catch(() => false);
  return selectNodePackageManager(manifest, pnpmLock, nodeMajor);
}

export function selectNodePackageManager(manifest, pnpmLock, nodeMajor = 24) {
  const declared = manifest.packageManager;
  if (declared !== undefined && (typeof declared !== 'string' || !/^(npm|pnpm)@/.test(declared))) {
    throw new Error('Node projects support npm or pnpm in packageManager. Select the Bun runtime for Bun projects.');
  }
  if (declared?.startsWith('npm@') || (!declared && !pnpmLock)) return { name: 'npm' };
  const version = declared ? /^pnpm@(\d+\.\d+\.\d+)$/.exec(declared)?.[1] : null;
  if (declared && !version) throw new Error('Set packageManager to an exact pnpm version, for example pnpm@11.19.0.');
  if (version) validatePnpmVersion(version, nodeMajor);
  return { name: 'pnpm', version };
}

export function validatePnpmVersion(version, nodeMajor = 24) {
  if (!/^(8|9|10|11)\.\d+\.\d+$/.test(version)) throw new Error('Portal supports pnpm 8 through 11. Install a supported pnpm version before deploying.');
  if (version.startsWith('11.') && Number(nodeMajor) < 22) throw new Error('pnpm 11 requires Node 22.13 or newer. Select Node 22/24/26 or install and pin pnpm 10.');
}

export function pnpmCommand(project, args) {
  return {
    command: process.env.HOSTMGR_PNPM_PATH || PNPM_PATH,
    args: ['--config.manage-package-manager-versions=false', '--config.pm-on-fail=error', '--config.verify-deps-before-run=false', ...args]
  };
}

export async function assertPnpmAvailable(project, run, options = {}) {
  const invocation = pnpmCommand(project, ['--version']);
  let version;
  try { version = (await run(invocation.command, invocation.args, options)).trim(); }
  catch { throw new Error('pnpm is not installed or cannot run with the selected Node version. Install pnpm in Setup or over SSH before deploying.'); }
  validatePnpmVersion(version, project.nodeMajor || 24);
  const expected = project.packageManager?.version;
  if (expected && expected !== version) throw new Error(`This project requires pnpm ${expected}, but the host has ${version}. Install the matching version before deploying; Portal will not download or switch pnpm automatically.`);
  return version;
}

export function pnpmServiceStart(project) {
  const bin = nodeBin(project.nodeMajor || 24);
  return `/usr/bin/env PATH=${bin}:/usr/local/bin:/usr/bin:/bin ${PNPM_PATH} --config.manage-package-manager-versions=false --config.pm-on-fail=error --config.verify-deps-before-run=false run ${project.startScript}`;
}
