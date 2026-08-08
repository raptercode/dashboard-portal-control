import dns from 'node:dns/promises';
import os from 'node:os';
import { InputError, validateDomain } from './core.mjs';

export function hostExpectedAddresses(env = process.env, networkInterfaces = os.networkInterfaces) {
  const fromEnv = String(env?.HOSTMGR_PUBLIC_IP || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const fromNics = [];
  try {
    for (const entries of Object.values(typeof networkInterfaces === 'function' ? networkInterfaces() || {} : {})) {
      for (const entry of entries || []) {
        if (!entry || entry.internal || typeof entry.address !== 'string' || !entry.address) continue;
        fromNics.push(entry.address);
      }
    }
  } catch {}
  return [...new Set([...fromEnv, ...fromNics])];
}

function asAddressList(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === 'string' && item);
}

export async function checkDomainDns(input, options = {}) {
  const hostname = validateDomain({ hostname: typeof input === 'string' ? input : input?.hostname });
  try {
    const resolve4 = options.resolve4 ?? ((name) => dns.resolve4(name));
    const resolve6 = options.resolve6 ?? ((name) => dns.resolve6(name));
    const expected = Array.isArray(options.expected)
      ? asAddressList(options.expected)
      : hostExpectedAddresses(options.env, options.networkInterfaces);
    const resolved = [];
    try {
      resolved.push(...asAddressList(await resolve4(hostname)));
    } catch {}
    try {
      resolved.push(...asAddressList(await resolve6(hostname)));
    } catch {}
    const uniqueResolved = [...new Set(resolved)];
    if (!uniqueResolved.length) {
      return { hostname, resolved: [], expected, matched: false, status: 'unresolved' };
    }
    const matched = uniqueResolved.some((address) => expected.includes(address));
    return { hostname, resolved: uniqueResolved, expected, matched, status: matched ? 'ok' : 'mismatch' };
  } catch (error) {
    if (error instanceof InputError) throw error;
    return {
      hostname,
      resolved: [],
      expected: [],
      matched: false,
      status: 'error',
      detail: 'DNS check failed. Verify network/DNS settings and try again.',
    };
  }
}
