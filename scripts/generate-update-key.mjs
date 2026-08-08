#!/usr/bin/env node
import { generateKeyPairSync } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const values = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const match = /^--([a-z-]+)=(.+)$/.exec(arg);
  if (!match) usage();
  return [match[1], match[2]];
}));
if (!values.out || Object.keys(values).some((key) => key !== 'out')) usage();

const output = resolve(values.out);
await mkdir(output, { recursive: true, mode: 0o700 });
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
await writeFile(resolve(output, 'dashboard-portal-update-private.pem'), privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' });
await writeFile(resolve(output, 'dashboard-portal-update-public.pem'), publicKey.export({ type: 'spki', format: 'pem' }), { mode: 0o644, flag: 'wx' });
console.log(`Created signing key pair in ${output}`);
console.log('Keep dashboard-portal-update-private.pem outside the repository and store it only as a CI secret.');

function usage() {
  console.error('Usage: node scripts/generate-update-key.mjs --out=/secure/directory');
  process.exit(64);
}
