#!/usr/bin/env node
import { createHash, sign } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from './software-update.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const options = parseOptions(process.argv.slice(2));
const packageInfo = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const version = packageInfo.version;
if (!/^\d+\.\d+\.\d+$/.test(version)) fatal('package.json version must use major.minor.patch format.');
const output = resolve(options.out);
await mkdir(output, { recursive: true, mode: 0o700 });
const archiveName = `dashboard-portal-${version}.tar.gz`;
const archive = join(output, archiveName);
await run('tar', ['--create', '--gzip', '--file', archive, '--exclude=.git', '--exclude=node_modules', '--exclude=data', '--exclude=dist', '--exclude=.env', '.'], root);
const archiveSha256 = await digest(archive);
const payload = {
  channel: options.channel ?? 'stable',
  version,
  publishedAt: new Date().toISOString(),
  archiveUrl: options['archive-url'],
  archiveSha256,
  notes: options.notes ?? ''
};
const privateKey = await readFile(resolve(options['private-key']), 'utf8');
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
  const allowed = new Set(['out', 'archive-url', 'private-key', 'channel', 'notes']);
  if (!values.out || !values['archive-url'] || !values['private-key'] || Object.keys(values).some((key) => !allowed.has(key))) usage();
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

async function digest(file) {
  const content = await readFile(file);
  return createHash('sha256').update(content).digest('hex');
}

function usage() {
  console.error('Usage: npm run release:prepare -- --out=dist --archive-url=https://host/dashboard-portal-<version>.tar.gz --private-key=/secure/key.pem [--channel=stable] [--notes=...]');
  process.exit(64);
}

function fatal(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}
