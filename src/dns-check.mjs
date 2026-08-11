import dns from 'node:dns/promises';
import os from 'node:os';
import { InputError, validateDomain } from './core.mjs';

const DEFAULT_DNS_TIMEOUT_MS = 5_000;

export function hostExpectedAddresses(env = process.env, networkInterfaces = os.networkInterfaces) {
  const fromEnv = String(env?.HOSTMGR_PUBLIC_IP || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  // A configured public address is authoritative. Falling back to every NIC
  // exposed Docker bridges and link-local IPv6 addresses in the UI, none of
  // which is a DNS target an owner can use.
  if (fromEnv.length) return [...new Set(fromEnv)];
  const fromNics = [];
  try {
    for (const entries of Object.values(typeof networkInterfaces === 'function' ? networkInterfaces() || {} : {})) {
      for (const entry of entries || []) {
        if (!entry || entry.internal || typeof entry.address !== 'string' || !isPublicDnsTarget(entry.address)) continue;
        fromNics.push(entry.address);
      }
    }
  } catch {}
  return [...new Set([...fromEnv, ...fromNics])];
}

function isPublicDnsTarget(address) {
  const ipv4 = address.split('.').map(Number);
  if (ipv4.length === 4 && ipv4.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
    const [first, second] = ipv4;
    return first !== 10
      && !(first === 100 && second >= 64 && second <= 127)
      && !(first === 169 && second === 254)
      && !(first === 172 && second >= 16 && second <= 31)
      && !(first === 192 && second === 168);
  }
  const ipv6 = address.toLowerCase();
  return !ipv6.startsWith('fe80:') && !ipv6.startsWith('fc') && !ipv6.startsWith('fd');
}

function asAddressList(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === 'string' && item);
}

async function resolveWithLookup(hostname, lookup, timeoutMs) {
  const signal = AbortSignal.timeout(timeoutMs);
  const records = await lookup(hostname, { all: true, signal });
  if (!Array.isArray(records)) return [];
  return records
    .map((item) => (typeof item === 'string' ? item : item?.address))
    .filter((item) => typeof item === 'string' && item);
}

async function resolveRecordList(resolver, hostname, timeoutMs) {
  const signal = AbortSignal.timeout(timeoutMs);
  return asAddressList(await resolver(hostname, { signal }));
}

function isUnresolvedDnsError(error) {
  return ['ENOTFOUND', 'ENODATA', 'ESERVFAIL', 'ETIMEOUT', 'ABORT_ERR', 'UND_ERR_ABORTED'].includes(error?.code);
}

export async function checkDomainDns(input, options = {}) {
  const hostname = validateDomain({ hostname: typeof input === 'string' ? input : input?.hostname });
  try {
    const timeoutMs = Number.isInteger(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : DEFAULT_DNS_TIMEOUT_MS;
    const lookup = options.lookup ?? ((name, opts) => dns.lookup(name, opts));
    const resolve4 = options.resolve4 ?? ((name, opts) => dns.resolve4(name, opts));
    const resolve6 = options.resolve6 ?? ((name, opts) => dns.resolve6(name, opts));
    const expected = Array.isArray(options.expected)
      ? asAddressList(options.expected)
      : hostExpectedAddresses(options.env, options.networkInterfaces);
    const resolved = [];
    let sawResolverError = false;
    try {
      resolved.push(...await resolveWithLookup(hostname, lookup, timeoutMs));
    } catch (error) {
      if (!isUnresolvedDnsError(error)) sawResolverError = true;
    }
    if (!resolved.length) {
      try {
        resolved.push(...await resolveRecordList(resolve4, hostname, timeoutMs));
      } catch (error) {
        if (!isUnresolvedDnsError(error)) sawResolverError = true;
      }
      try {
        resolved.push(...await resolveRecordList(resolve6, hostname, timeoutMs));
      } catch (error) {
        if (!isUnresolvedDnsError(error)) sawResolverError = true;
      }
    }
    const uniqueResolved = [...new Set(resolved)];
    if (!uniqueResolved.length) {
      if (sawResolverError) {
        return {
          hostname,
          resolved: [],
          expected,
          matched: false,
          status: 'error',
          detail: 'DNS check failed. Verify network/DNS settings and try again.',
        };
      }
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
