import dns from 'node:dns/promises';
import os from 'node:os';
import { validateDomain } from './core.mjs';

export function hostExpectedAddresses(env = process.env, networkInterfaces = os.networkInterfaces) {
  const fromEnv = String(env.HOSTMGR_PUBLIC_IP || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const fromNics = [];
  for (const entries of Object.values(networkInterfaces() || {})) {
    for (const entry of entries || []) {
      if (!entry || entry.internal || !entry.address) continue;
      fromNics.push(entry.address);
    }
  }
  return [...new Set([...fromEnv, ...fromNics])];
}

export async function checkDomainDns(input, options = {}) {
  const hostname = validateDomain({ hostname: typeof input === 'string' ? input : input?.hostname });
  const resolve4 = options.resolve4 ?? ((name) => dns.resolve4(name));
  const resolve6 = options.resolve6 ?? ((name) => dns.resolve6(name));
  const expected = options.expected ?? hostExpectedAddresses(options.env, options.networkInterfaces);
  const resolved = [];
  try {
    resolved.push(...await resolve4(hostname));
  } catch { /* no A records */ }
  try {
    resolved.push(...await resolve6(hostname));
  } catch { /* no AAAA records */ }
  const uniqueResolved = [...new Set(resolved)];
  if (!uniqueResolved.length) {
    return { hostname, resolved: [], expected, matched: false, status: 'unresolved' };
  }
  const matched = uniqueResolved.some((address) => expected.includes(address));
  return { hostname, resolved: uniqueResolved, expected, matched, status: matched ? 'ok' : 'mismatch' };
}
