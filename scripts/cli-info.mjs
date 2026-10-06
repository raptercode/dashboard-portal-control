#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { NODE_VERSIONS } from './node-versions.mjs';

const help = `Dashboard Portal CLI

Usage: dashboard-portal <command> [options]

Read-only commands (no sudo required):
  -h, --help                  Show all commands and options
  -v, --versions, --version    Show installed Portal and runtime versions
  <command> -h, --help         Show this command reference

Administrator commands (sudo required):
  update                      Download, verify and install the latest signed release
    --check                   Check available version without installing
    --channel=<channel>       Select update channel (default: stable)
  configure-update            Configure and verify the signed update feed
    --manifest=https://...    Signed manifest URL (required)
    --public-key=/path/...    Public signing key PEM (required)
    --channel=<channel>       Update channel (default: stable)
  --reset-pwd                 Reset administrator password interactively and restart Portal

Examples:
  dashboard-portal --help
  dashboard-portal --versions
  sudo dashboard-portal update --check
  sudo dashboard-portal update
  sudo dashboard-portal --reset-pwd
`;

const args = process.argv.slice(2);
if (!args.length || (args.length === 1 && ['-h', '--help'].includes(args[0])) || (args.length === 2 && ['update', 'configure-update', '--reset-pwd'].includes(args[0]) && ['-h', '--help'].includes(args[1]))) {
  process.stdout.write(help);
} else if (args.length === 1 && ['-v', '--versions', '--version'].includes(args[0])) {
  let version = 'unavailable (Portal metadata cannot be read)';
  try { version = JSON.parse(await readFile('/opt/dashboard-portal/package.json', 'utf8')).version; } catch { /* No config or secrets are needed. */ }
  console.log(`Dashboard Portal: ${version}\nCLI Node.js: ${process.version}`);
  const run = promisify(execFile);
  for (const [label, command, commandArgs] of [
    ...Object.entries(NODE_VERSIONS).map(([major, version]) => [`Node ${major}`, `/opt/node-v${version}/bin/node`, ['--version']]),
    ['Bun', '/usr/local/bin/bun', ['--version']],
    ['pnpm (optional)', '/usr/local/bin/pnpm', ['--config.manage-package-manager-versions=false', '--config.pm-on-fail=error', '--config.verify-deps-before-run=false', '--version']],
    ['Go', '/usr/local/go/bin/go', ['version']],
    ['Python', '/usr/bin/python3', ['--version']],
    ['PHP', '/usr/bin/php', ['--version']],
    ['Docker', '/usr/bin/docker', ['--version']],
    ['Git', '/usr/bin/git', ['--version']],
    ['Nginx', '/usr/sbin/nginx', ['-v']],
    ['Certbot', '/usr/bin/certbot', ['--version']]
  ]) {
    try {
      const { stdout, stderr } = await run(command, commandArgs, { timeout: 3000, maxBuffer: 8192 });
      console.log(`${label}: ${(stdout || stderr).trim().split(/\r?\n/)[0]}`);
    } catch (error) {
      console.log(`${label}: ${error.code === 'ENOENT' ? 'not installed' : 'unavailable (runtime probe failed)'}`);
    }
  }
} else {
  console.error('Unknown informational command. Use dashboard-portal --help.');
  process.exitCode = 64;
}
