import test from 'node:test';
import assert from 'node:assert/strict';
import { generateResetPassword, passwordFromEnvironment, renderPasswordConfig } from '../scripts/password-config.mjs';

test('password configuration writes only a Base64 value and replaces legacy plaintext', () => {
  const rendered = renderPasswordConfig('HOSTMGR_ADMIN_PASSWORD=old-value\nHOSTMGR_MODE=host\n', 'new-correct-horse-battery');
  assert.equal(rendered.includes('HOSTMGR_ADMIN_PASSWORD=old-value'), false);
  assert.match(rendered, /HOSTMGR_ADMIN_PASSWORD_B64=bmV3LWNvcnJlY3QtaG9yc2UtYmF0dGVyeQ==/);
  assert.equal(passwordFromEnvironment({ HOSTMGR_ADMIN_PASSWORD_B64: 'bmV3LWNvcnJlY3QtaG9yc2UtYmF0dGVyeQ==' }), 'new-correct-horse-battery');
  assert.equal(passwordFromEnvironment({ HOSTMGR_ADMIN_PASSWORD: 'legacy-password' }), 'legacy-password');
});

test('generated reset passwords are URL-safe and long enough for login', () => {
  assert.match(generateResetPassword(), /^[A-Za-z0-9_-]{32}$/);
});
