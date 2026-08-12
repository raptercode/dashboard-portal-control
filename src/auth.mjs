import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { InputError } from './core.mjs';

const SCRYPT_PARAMS = Object.freeze({ N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
const SPECIAL = /[^A-Za-z0-9]/;

export function validateEmail(value, label = 'Email') {
  const email = requiredText(value, label, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new InputError(`${label} is invalid.`);
  return email;
}

export function validateStrongPassword(value, label = 'Password') {
  const password = requiredText(value, label, 128);
  if (password.length < 12) throw new InputError(`${label} must be at least 12 characters.`);
  if (/[\r\n\0\s]/.test(password)) throw new InputError(`${label} must not contain whitespace or line breaks.`);
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password) || !SPECIAL.test(password)) {
    throw new InputError(`${label} must include upper and lower case letters, a number, and a symbol.`);
  }
  return password;
}

export function validateOwnerBootstrap(input, options = {}) {
  const email = validateEmail(input?.email);
  const password = validateStrongPassword(input?.password);
  const confirmPassword = input?.confirmPassword;
  if (confirmPassword !== password) throw new InputError('Password confirmation does not match.');
  if (password.toLowerCase().includes(email.split('@')[0])) throw new InputError('Password must not contain the email local part.');
  const currentPassword = optionalText(input?.currentPassword, 128);
  if (options.requireCurrentPassword) {
    if (!currentPassword) throw new InputError('Current installer password is required.');
  }
  return { email, password, currentPassword: currentPassword || null };
}

export function validateOwnerLogin(input) {
  return {
    email: validateEmail(input?.email),
    password: requiredText(input?.password, 'Password', 128)
  };
}

export function hashPassword(password, salt = randomBytes(16)) {
  const digest = scryptSync(password, salt, 64, SCRYPT_PARAMS);
  return {
    algorithm: 'scrypt',
    salt: salt.toString('base64'),
    hash: digest.toString('base64'),
    params: SCRYPT_PARAMS
  };
}

export function verifyPassword(password, stored) {
  if (!stored || stored.algorithm !== 'scrypt' || typeof stored.salt !== 'string' || typeof stored.hash !== 'string') return false;
  if (typeof password !== 'string') return false;
  try {
    const actual = scryptSync(password, Buffer.from(stored.salt, 'base64'), 64, stored.params ?? SCRYPT_PARAMS);
    const expected = Buffer.from(stored.hash, 'base64');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function publicOwner(owner) {
  if (!owner) return null;
  return { email: owner.email, createdAt: owner.createdAt };
}

function requiredText(value, label, max) {
  if (typeof value !== 'string') throw new InputError(`${label} is required.`);
  const text = value.trim();
  if (!text || text.length > max) throw new InputError(`${label} is required.`);
  return text;
}

function optionalText(value, max) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > max) throw new InputError('Value is invalid.');
  return value;
}
