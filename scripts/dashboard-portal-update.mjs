#!/usr/bin/env node
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { spawn } from 'node:child_process';
import { compareVersions, fetchVerifiedManifest, sha256File, softwareUpdateStatus, updateConfiguration } from './software-update.mjs';

const CONFIG_FILE = '/etc/dashboard-portal/dashboard-portal.env';
const PUBLIC_KEY_FILE = '/etc/dashboard-portal/update-public-key.pem';
const APP_ROOT = '/opt/dashboard-portal';
const MAX_ARCHIVE_BYTES = 128 * 1024 * 1024;

const args = process.argv.slice(2);
if (process.getuid?.() !== 0) fatal('Run this command with sudo.');

if (args[0] === 'configure-update') await configureUpdate(args.slice(1));
else if (args[0] === 'update') await update(args.slice(1));
else usage();

async function configureUpdate(values) {
  const options = parseOptions(values, ['manifest', 'public-key', 'channel']);
  if (!options.manifest || !options['public-key']) fatal('configure-update requires --manifest=https://... and --public-key=/path/to/public.pem');
  if (!options.manifest.startsWith('https://')) fatal('The update manifest must use HTTPS.');
  const source = resolve(options['public-key']);
  const sourceInfo = await stat(source).catch(() => null);
  if (!sourceInfo?.isFile()) fatal('The update public key file was not found.');
  const key = await readFile(source, 'utf8');
  if (!key.includes('BEGIN PUBLIC KEY')) fatal('The update key must be a PEM public key.');
  await copyFile(source, PUBLIC_KEY_FILE);
  await chmod(PUBLIC_KEY_FILE, 0o644);
  const config = await readConfig();
  config.HOSTMGR_UPDATE_MANIFEST_URL = options.manifest;
  config.HOSTMGR_UPDATE_PUBLIC_KEY_PATH = PUBLIC_KEY_FILE;
  config.HOSTMGR_UPDATE_CHANNEL = options.channel ?? 'stable';
  await writeConfig(config);
  const status = await softwareUpdateStatus({ config: updateConfiguration(config), currentVersion: await installedVersion() });
  if (!status.configured || status.status === 'unavailable') fatal('Configuration was saved, but the signed manifest could not be verified. Check the URL and public key.');
  console.log(`Software updates configured for ${status.channel}. Current version: ${status.currentVersion}.`);
}

async function update(values) {
  const options = parseOptions(values, ['channel']);
  const config = await readConfig();
  if (options.channel) config.HOSTMGR_UPDATE_CHANNEL = options.channel;
  const updateConfig = updateConfiguration(config);
  if (!updateConfig.configured) fatal(updateConfig.issue ?? 'Software update is not configured. Re-run the current Dashboard Portal installer, or configure a custom feed first.');
  const currentVersion = await installedVersion();
  const manifest = await fetchVerifiedManifest(updateConfig);
  if (options.check) {
    console.log(JSON.stringify({ currentVersion, availableVersion: manifest.version, available: manifest.version !== currentVersion, channel: updateConfig.channel }));
    return;
  }
  const comparison = compareVersions(manifest.version, currentVersion);
  if (comparison === 0) {
    console.log(`Dashboard Portal is already on ${currentVersion}.`);
    return;
  }
  if (comparison < 0) fatal(`Refusing to downgrade from ${currentVersion} to ${manifest.version}.`);
  const stage = await mkdtemp('/tmp/dashboard-portal-update-');
  try {
    const archive = join(stage, 'release.tar.gz');
    console.log(`Downloading Dashboard Portal ${manifest.version}...`);
    await download(manifest.archiveUrl, archive);
    const checksum = await sha256File(archive);
    if (checksum !== manifest.archiveSha256) fatal('Release archive checksum verification failed.');
    const extracted = join(stage, 'release');
    await mkdir(extracted, { mode: 0o700 });
    await run('/bin/tar', ['--extract', '--gzip', '--file', archive, '--directory', extracted, '--no-same-owner', '--no-same-permissions']);
    const releaseRoot = await releaseDirectory(extracted);
    console.log('Checksum and signature verified. Installing staged release...');
    await run('/usr/bin/bash', [join(releaseRoot, 'dashboard-portal.sh'), `--domain=${config.HOSTMGR_PORTAL_DOMAIN ?? ''}`, `--email=${config.HOSTMGR_ACME_EMAIL ?? ''}`], { cwd: releaseRoot, inherit: true });
    console.log(`Dashboard Portal updated to ${manifest.version}.`);
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

async function download(url, destination) {
  const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(60_000) });
  if (!response.ok || !response.body) fatal('Release archive could not be downloaded.');
  if (response.url && new URL(response.url).protocol !== 'https:') fatal('Release archive redirect must remain on HTTPS.');
  const length = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(length) && length > MAX_ARCHIVE_BYTES) fatal('Release archive is too large.');
  let downloaded = 0;
  const source = Readable.fromWeb(response.body).on('data', (chunk) => {
    downloaded += chunk.length;
    if (downloaded > MAX_ARCHIVE_BYTES) source.destroy(new Error('Release archive is too large.'));
  });
  await pipeline(source, createWriteStream(destination, { flags: 'wx', mode: 0o600 }));
}

async function releaseDirectory(extracted) {
  const candidate = join(extracted, 'dashboard-portal.sh');
  if ((await stat(candidate).catch(() => null))?.isFile()) return extracted;
  const { readdir } = await import('node:fs/promises');
  const entries = await readdir(extracted, { withFileTypes: true });
  if (entries.length !== 1 || !entries[0].isDirectory()) fatal('Release archive has an unexpected layout.');
  const nested = join(extracted, entries[0].name);
  if (!(await stat(join(nested, 'dashboard-portal.sh')).catch(() => null))?.isFile()) fatal('Release archive does not contain the installer.');
  return nested;
}

async function installedVersion() {
  try { return JSON.parse(await readFile(join(APP_ROOT, 'package.json'), 'utf8')).version; } catch { fatal('The current Dashboard Portal installation is incomplete.'); }
}

async function readConfig() {
  const content = await readFile(CONFIG_FILE, 'utf8').catch(() => fatal('Dashboard Portal configuration was not found.'));
  return Object.fromEntries(content.split(/\r?\n/).filter(Boolean).map((line) => {
    const index = line.indexOf('=');
    return [line.slice(0, index), line.slice(index + 1)];
  }));
}

async function writeConfig(config) {
  const keys = Object.keys(config).filter((key) => /^[A-Z][A-Z0-9_]*$/.test(key)).sort();
  const content = `${keys.map((key) => `${key}=${config[key]}`).join('\n')}\n`;
  await writeFile(CONFIG_FILE, content, { mode: 0o640 });
  await chmod(CONFIG_FILE, 0o640);
}

function parseOptions(values, permitted) {
  const options = {};
  for (const value of values) {
    if (value === '--check') { options.check = true; continue; }
    const match = /^--([a-z-]+)=(.+)$/.exec(value);
    if (!match || !permitted.includes(match[1]) || Object.hasOwn(options, match[1])) usage();
    options[match[1]] = match[2];
  }
  return options;
}

function run(command, commandArgs, options = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, commandArgs, { shell: false, stdio: options.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'], cwd: options.cwd });
    let stderr = '';
    child.stderr?.on('data', (data) => { stderr += data; });
    child.once('error', reject);
    child.once('close', (code) => code === 0 ? resolveRun() : reject(new Error(`${command} failed (${code}): ${stderr.slice(0, 300)}`)));
  });
}

function usage() {
  console.error('Usage: sudo dashboard-portal update [--check] [--channel=stable]');
  console.error('       sudo dashboard-portal configure-update --manifest=https://... --public-key=/path/key.pem [--channel=stable]');
  process.exit(64);
}

function fatal(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}
