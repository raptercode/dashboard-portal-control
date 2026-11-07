#!/usr/bin/env node
import { createHash, sign } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from './software-update.mjs';
import { releaseBlockers } from './release-guard.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const options = parseOptions(process.argv.slice(2));
const packageInfo = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const version = packageInfo.version;
if (!/^\d+\.\d+\.\d+$/.test(version)) fatal('package.json version must use major.minor.patch format.');
const output = resolve(options.out);
await mkdir(output, { recursive: true, mode: 0o700 });
const archiveName = `strckro-${version}.tar.gz`;
const archive = join(output, archiveName);
// Archive committed Git content rather than the local checkout.  This keeps
// untracked files out and preserves the LF bytes stored for shell scripts when
// a release is prepared from Windows.
// That also means an uncommitted source file is silently absent. Refuse to build a
// release that imports files it does not contain; changes still in the working tree
// are only reported, because leaving them out of a release is sometimes the intent.
const { untracked, modified } = releaseBlockers(await capture('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], root));
if (modified.length) console.warn(`Warning: ${modified.length} file(s) have uncommitted changes that are NOT in this release: ${modified.slice(0, 8).join(', ')}${modified.length > 8 ? ', ...' : ''}`);
if (untracked.length && options['allow-untracked'] !== 'yes') {
  fatal(`These files are not committed, so the release would not contain them: ${untracked.join(', ')}. Commit them (or remove them), or pass --allow-untracked=yes if leaving them out is intended.`);
}
await run('git', ['archive', '--format=tar.gz', `--output=${archive}`, 'HEAD'], root);
const archiveSha256 = await digest(archive);
const payload = {
  channel: options.channel ?? 'stable',
  version,
  publishedAt: new Date().toISOString(),
  archiveUrl: options['archive-url'],
  archiveSha256,
  notes: options.notes ?? ''
};
// The private signing material must never be placed in a shell history or
// process argument list. Release workstations provide this path through a
// process-local environment variable instead.
const privateKeyPath = options['private-key'] ?? process.env.STRCKRO_UPDATE_PRIVATE_KEY_PATH ?? process.env.DASHBOARD_PORTAL_UPDATE_PRIVATE_KEY_PATH;
if (!privateKeyPath) fatal('A release signing key path is required through STRCKRO_UPDATE_PRIVATE_KEY_PATH (DASHBOARD_PORTAL_UPDATE_PRIVATE_KEY_PATH still works).');
const privateKey = await readFile(resolve(privateKeyPath), 'utf8');
const signature = sign(null, Buffer.from(canonicalJson(payload)), privateKey).toString('base64');
await writeFile(join(output, `${payload.channel}.json`), `${JSON.stringify({ payload, signature }, null, 2)}\n`, { mode: 0o644 });
await writeFile(join(output, `${archiveName}.sha256`), `${archiveSha256}  ${archiveName}\n`, { mode: 0o644 });
console.log(`Prepared ${archiveName} and ${payload.channel}.json in ${output}`);

function parseOptions(args) {
  const values = {};
  for (const arg of args) {
    const match = /^--([a-z-]+)=(.+)$/.exec(arg);
    if (!match || Object.hasOwn(values, match[1])) usage();
    values[match[1]] = match[2];
  }
  const allowed = new Set(['out', 'archive-url', 'private-key', 'channel', 'notes', 'allow-untracked']);
  if (!values.out || !values['archive-url'] || Object.keys(values).some((key) => !allowed.has(key))) usage();
  if (!values['archive-url'].startsWith('https://')) fatal('archive-url must use HTTPS.');
  if (values.channel && !/^[a-z0-9][a-z0-9-]{0,31}$/.test(values.channel)) fatal('channel is invalid.');
  return values;
}

function run(command, args, cwd) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd, shell: false, stdio: 'inherit' });
    child.once('error', reject);
    child.once('close', (code) => code === 0 ? resolveRun() : reject(new Error(`${command} failed (${code})`)));
  });
}

function capture(command, args, cwd) {
  return new Promise((resolveCapture, reject) => {
    const child = spawn(command, args, { cwd, shell: false, stdio: ['ignore', 'pipe', 'inherit'] });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.once('error', reject);
    child.once('close', (code) => code === 0 ? resolveCapture(output) : reject(new Error(`${command} failed (${code})`)));
  });
}

async function digest(file) {
  const content = await readFile(file);
  return createHash('sha256').update(content).digest('hex');
}

function usage() {
  console.error('Usage: STRCKRO_UPDATE_PRIVATE_KEY_PATH=/secure/key.pem npm run release:prepare -- --out=dist --archive-url=https://host/strckro-<version>.tar.gz [--channel=stable] [--notes=...] [--allow-untracked=yes]');
  process.exit(64);
}

function fatal(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}
