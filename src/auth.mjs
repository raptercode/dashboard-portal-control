import { randomBytes, scrypt, scryptSync, timingSafeEqual } from 'node:crypto';
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

// The same check on the libuv thread pool. scryptSync holds the one JavaScript thread for tens of
// milliseconds, which is fine for an authenticated password change but not for sign-in, which a
// stranger can ask for as fast as they like: every guess would stall every other request.
export function verifyPasswordAsync(password, stored) {
  if (!stored || stored.algorithm !== 'scrypt' || typeof stored.salt !== 'string' || typeof stored.hash !== 'string') return Promise.resolve(false);
  if (typeof password !== 'string') return Promise.resolve(false);
  return new Promise((resolve) => {
    try {
      const expected = Buffer.from(stored.hash, 'base64');
      scrypt(password, Buffer.from(stored.salt, 'base64'), 64, stored.params ?? SCRYPT_PARAMS, (error, actual) => {
        resolve(!error && actual.length === expected.length && timingSafeEqual(actual, expected));
      });
    } catch {
      resolve(false);
    }
  });
}

export class GateFullError extends Error {
  constructor() { super('Too many sign-ins are being checked at once.'); this.name = 'GateFullError'; }
}

// Runs at most `limit` tasks at a time and keeps at most `maxQueue` more waiting; past that it
// refuses at once instead of letting an unbounded line build up. Used so that a flood of password
// checks occupies a couple of pool threads and cannot starve everything else that needs one.
// A `trusted` task may also use `reservedQueue` extra places, so a flood that fills the ordinary
// queue still leaves room for someone the caller has reason to believe is not part of it.
export function createGate(limit, maxQueue, reservedQueue = 0) {
  let active = 0;
  const waiting = [];
  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else active -= 1;
  };
  return async function run(task, { trusted = false } = {}) {
    if (active >= limit) {
      if (waiting.length >= maxQueue + (trusted ? reservedQueue : 0)) throw new GateFullError();
      // The slot is handed over by release(), which leaves `active` unchanged for the next task.
      await new Promise((resolve) => waiting.push(resolve));
    } else {
      active += 1;
    }
    try { return await task(); } finally { release(); }
  };
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
