import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InputError, validateGitIdentity, validateProjectSync } from '../src/core.mjs';
import { cloneInSandbox, safeGitSyncFailure } from '../src/server.mjs';

const base = { name: 'Demo app', slug: 'demo-app', branch: 'main', port: 3000 };

function git(args, cwd) {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

async function makeLocalRepo(dir, filename, content) {
  await mkdir(dir, { recursive: true });
  git(['init', '-q', '-b', 'main'], dir);
  await writeFile(join(dir, filename), content);
  git(['add', filename], dir);
  git(['-c', 'user.email=fixture@example.test', '-c', 'user.name=Fixture', 'commit', '-q', '-m', 'seed'], dir);
  return dir;
}

test('Git sync derives the protocol from the remote URL and accepts token references or host-managed SSH keys', () => {
  assert.deepEqual(validateGitIdentity({ name: 'Owner', email: 'owner@example.test' }), { name: 'Owner', email: 'owner@example.test' });
  const https = validateProjectSync({ ...base, repository: 'https://github.com/example/demo.git', credentialId: '00000000-0000-4000-8000-000000000001' });
  assert.equal(https.protocol, 'https');
  assert.equal(https.credentialId, '00000000-0000-4000-8000-000000000001');
  const ssh = validateProjectSync({ ...base, repository: 'git@github.com:example/demo.git', protocol: 'https' });
  assert.equal(ssh.protocol, 'ssh');
  assert.equal(ssh.sshKeyId, 'deploy-key-demo-app');
  assert.equal(ssh.credentialId, null);
});

test('Git sync refuses an inline token and invalid identity', () => {
  assert.throws(() => validateProjectSync({ ...base, repository: 'https://github.com/example/demo.git', protocol: 'https', credentialId: 'ghp-secret-token' }), InputError);
  assert.throws(() => validateGitIdentity({ name: 'Owner', email: 'not-an-email' }), InputError);
});

test('Git sync failures expose a safe actionable category without Git output', () => {
  assert.equal(safeGitSyncFailure(new Error('fatal: Remote branch main not found in upstream origin')), 'the configured branch was not found.');
  assert.equal(safeGitSyncFailure(new Error('fatal: destination path already exists and is not an empty directory.')), 'an incomplete project workspace could not be reset.');
  assert.equal(safeGitSyncFailure(new Error('fatal: Authentication failed for https://token@example.test/repo.git')), 'repository authentication was rejected.');
  assert.equal(safeGitSyncFailure(new Error('unexpected internal detail')), 'Git exited without a classified error.');
});

test('re-syncing an existing project after its repository URL changes repoints origin instead of keeping the old clone', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'hostmgr-git-sync-'));
  const repoA = await makeLocalRepo(join(root, 'repo-a'), 'marker.txt', 'repo-a');
  const repoB = await makeLocalRepo(join(root, 'repo-b'), 'marker.txt', 'repo-b');
  const projectRoot = join(root, 'projects');
  const project = { ...base, slug: 'rebased-app', protocol: 'https', repository: repoA };

  const first = await cloneInSandbox(project, null, null, projectRoot);
  assert.equal(first.status, 'synced');
  assert.equal(await readFile(join(projectRoot, 'rebased-app', 'repository', 'marker.txt'), 'utf8'), 'repo-a');

  const second = await cloneInSandbox({ ...project, repository: repoB }, null, null, projectRoot);
  assert.equal(second.status, 'synced');
  assert.equal(await readFile(join(projectRoot, 'rebased-app', 'repository', 'marker.txt'), 'utf8'), 'repo-b');
});
