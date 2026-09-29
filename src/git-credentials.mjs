import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { InputError } from './core.mjs';

const execute = promisify(execFile);

// A credential may authenticate only to the original HTTPS authority. Git's
// default initial redirect and inherited URL rewrites must not forward it.
export async function prepareGitCredentials({ repository, credential, vault, scratchRoot, environment = process.env }) {
  let url;
  if (credential) {
    try { url = new URL(repository); } catch { throw new InputError('Invalid authenticated repository URL.'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.hostname.toLowerCase() !== credential.host) throw new InputError('Credential does not match a plain HTTPS repository URL.');
    if (!vault) throw new InputError('Credential vault is not configured.');
  }
  const directory = await mkdtemp(join(scratchRoot, '.git-auth-'));
  const cleanup = () => rm(directory, { recursive: true, force: true });
  try {
    const config = join(directory, 'config');
    const askpass = join(directory, 'askpass');
    await writeFile(config, '', { mode: 0o600 });
    const env = Object.fromEntries(Object.entries(environment).filter(([key]) => !/^(?:GIT_|HOSTMGR_GIT_|SSH_ASKPASS|SSH_ASKPASS_REQUIRE)/i.test(key)));
    Object.assign(env, {
      HOME: directory, XDG_CONFIG_HOME: directory,
      LC_ALL: 'C', LANG: 'C',
      GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_SYSTEM: config, GIT_CONFIG_GLOBAL: config,
      GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: askpass, GIT_ASKPASS_REQUIRE: 'force',
      GIT_LFS_SKIP_SMUDGE: '1'
    });
    let script = '#!/bin/sh\nexit 1\n';
    if (credential) {
      env.HOSTMGR_GIT_AUTHORITY = url.host;
      env.HOSTMGR_GIT_TOKEN_FILE = join(directory, 'token');
      await writeFile(env.HOSTMGR_GIT_TOKEN_FILE, vault.decrypt(credential.encryptedToken), { mode: 0o600 });
      script = '#!/bin/sh\ncase "$1" in\n  "Username for \'https://$HOSTMGR_GIT_AUTHORITY\': ") printf %s x-access-token ;;\n  "Password for \'https://x-access-token@$HOSTMGR_GIT_AUTHORITY\': ") cat "$HOSTMGR_GIT_TOKEN_FILE" ;;\n  *) exit 1 ;;\nesac\n';
    }
    await writeFile(askpass, script, { mode: 0o700 });
    const args = ['-c', 'credential.helper=', '-c', 'credential.useHttpPath=false', '-c', 'http.followRedirects=false', '-c', 'http.extraHeader=', '-c', `core.hooksPath=${directory}`];
    if (credential) args.push('-c', 'protocol.allow=never', '-c', 'protocol.https.allow=always');
    return { env, args, cwd: directory, repository: url?.href ?? repository, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

// Existing checkouts have their own config, which Git reads even with isolated
// global/system config. Refuse transport overrides before sending credentials.
export async function assertSafeGitRepositoryConfig(repositoryDirectory, authentication) {
  const { stdout } = await execute('git', [...authentication.args, '-C', repositoryDirectory, 'config', '--includes', '--show-scope', '--null', '--name-only', '--list'], { env: authentication.env, timeout: 10_000, maxBuffer: 1024 * 1024 });
  const fields = stdout.split('\0');
  for (let index = 0; index + 1 < fields.length; index += 2) {
    if (!['local', 'worktree'].includes(fields[index])) continue;
    const key = fields[index + 1];
    if (/^(?:url\.|http\.|credential\.|filter\.|core\.(?:askpass|hookspath|sshcommand)$|remote\..*\.(?:proxy|uploadpack|vcs)$)/i.test(key)) throw new InputError('Repository contains local Git transport overrides. Remove them before syncing with a saved credential.');
  }
}
