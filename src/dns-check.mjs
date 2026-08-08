import dns from 'node:dns/promises';
import os from 'node:os';
import { InputError, validateDomain } from './core.mjs';

const DEFAULT_DNS_TIMEOUT_MS = 5_000;

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
