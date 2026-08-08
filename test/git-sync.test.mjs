import test from 'node:test';
import assert from 'node:assert/strict';
import { InputError, validateGitIdentity, validateProjectSync } from '../src/core.mjs';

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
