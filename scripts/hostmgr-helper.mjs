#!/usr/bin/env node
import { spawn } from 'node:child_process';

const packages = {
  nginx: ['nginx'],
  certbot: ['certbot'],
  git: ['git'],
  docker: ['docker.io', 'docker-compose-v2']
};

const [operation, tool] = process.argv.slice(2);
if (process.getuid?.() !== 0) fail('This helper must run as root.');
if (operation !== 'install-tool' || !Object.hasOwn(packages, tool)) fail('Unsupported privileged operation.');

try {
  await command('apt-get', ['install', '--yes', ...packages[tool]]);
  process.stdout.write(`${JSON.stringify({ ok: true, version: 'installed', tool })}\n`);
} catch (error) {
  process.stderr.write('The allowlisted package installation failed. Review the host audit log.\n');
  process.exitCode = 1;
}

function command(commandName, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(commandName, args, { shell: false, stdio: 'inherit' });
    child.once('error', reject);
    child.once('close', (code) => code === 0 ? resolve() : reject(new Error(`Exit ${code}`)));
  });
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}
