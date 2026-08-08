import test from 'node:test';
import assert from 'node:assert/strict';
import { SecretVault, validateEnvironmentContent, validateHttpsCredential } from '../src/core.mjs';

const vault = new SecretVault(Buffer.alloc(32, 9).toString('base64'));

test('secret vault encrypts and decrypts without retaining plaintext in payload', () => {
  const payload = vault.encrypt('ghp_this_token_must_stay_private');
  assert.equal(JSON.stringify(payload).includes('ghp_this_token'), false);
  assert.equal(vault.decrypt(payload), 'ghp_this_token_must_stay_private');
});

test('environment content exposes keys only and rejects malformed values', () => {
  const environment = validateEnvironmentContent('DATABASE_URL=postgres://secret\n# note\nAPI_KEY=value\n');
  assert.deepEqual(environment.keys, ['API_KEY', 'DATABASE_URL']);
  assert.throws(() => validateEnvironmentContent('export API_KEY=value'), /KEY=value/);
  assert.deepEqual(validateHttpsCredential({ name: 'github-personal', token: 'ghp_token_value' }), { name: 'github-personal', token: 'ghp_token_value' });
});
