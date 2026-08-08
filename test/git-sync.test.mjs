import test from 'node:test';
import assert from 'node:assert/strict';
import { InputError, validateGitIdentity, validateProjectSync } from '../src/core.mjs';
import { safeGitSyncFailure } from '../src/server.mjs';

const base = { name: 'Demo app', slug: 'demo-app', branch: 'main', port: 3000 };

test('Git sync accepts HTTPS token references and host-managed SSH keys', () => {
  assert.deepEqual(validateGitIdentity({ name: 'Owner', email: 'owner@example.test' }), { name: 'Owner', email: 'owner@example.test' });
  const https = validateProjectSync({ ...base, repository: 'https://github.com/example/demo.git', protocol: 'https', credentialId: '00000000-0000-4000-8000-000000000001' });
  assert.equal(https.credentialId, '00000000-0000-4000-8000-000000000001');
  const ssh = validateProjectSync({ ...base, repository: 'git@github.com:example/demo.git', protocol: 'ssh' });
  assert.equal(ssh.sshKeyId, 'deploy-key-demo-app');
  assert.equal(ssh.credentialId, null);
});

test('Git sync refuses an inline token, protocol mismatch, and invalid identity', () => {
  assert.throws(() => validateProjectSync({ ...base, repository: 'https://github.com/example/demo.git', protocol: 'https', credentialId: 'ghp-secret-token' }), InputError);
  assert.throws(() => validateProjectSync({ ...base, repository: 'git@github.com:example/demo.git', protocol: 'https' }), InputError);
  assert.throws(() => validateGitIdentity({ name: 'Owner', email: 'not-an-email' }), InputError);
});

test('Git sync failures expose a safe actionable category without Git output', () => {
  assert.equal(safeGitSyncFailure(new Error('fatal: Remote branch main not found in upstream origin')), 'the configured branch was not found.');
  assert.equal(safeGitSyncFailure(new Error('fatal: destination path already exists and is not an empty directory.')), 'an incomplete project workspace could not be reset.');
  assert.equal(safeGitSyncFailure(new Error('fatal: Authentication failed for https://token@example.test/repo.git')), 'repository authentication was rejected.');
  assert.equal(safeGitSyncFailure(new Error('unexpected internal detail')), 'Git exited without a classified error.');
});
