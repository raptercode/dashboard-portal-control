import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, validateOwnerBootstrap, validateStrongPassword, verifyPassword } from '../src/auth.mjs';
import { InputError } from '../src/core.mjs';

test('strong passwords require mixed character classes', () => {
  assert.throws(() => validateStrongPassword('onlylowercase1!'), InputError);
  assert.throws(() => validateStrongPassword('ONLYUPPERCASE1!'), InputError);
  assert.throws(() => validateStrongPassword('NoNumberHere!!'), InputError);
  assert.throws(() => validateStrongPassword('NoSpecialChar1'), InputError);
  assert.equal(validateStrongPassword('ValidPass123!'), 'ValidPass123!');
});

test('owner bootstrap validates email confirmation and optional current password', () => {
  const created = validateOwnerBootstrap({
    email: 'Owner@Example.com',
    password: 'ValidPass123!',
    confirmPassword: 'ValidPass123!'
  });
  assert.equal(created.email, 'owner@example.com');
  assert.throws(() => validateOwnerBootstrap({
    email: 'owner@example.com',
    password: 'ValidPass123!',
    confirmPassword: 'ValidPass123!',
    currentPassword: ''
  }, { requireCurrentPassword: true }), InputError);
});

test('password hashes verify without storing plaintext', () => {
  const stored = hashPassword('ValidPass123!');
  assert.equal(verifyPassword('ValidPass123!', stored), true);
  assert.equal(verifyPassword('WrongPass123!', stored), false);
  assert.ok(!JSON.stringify(stored).includes('ValidPass123!'));
});
