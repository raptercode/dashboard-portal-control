import dns from 'node:dns/promises';
import os from 'node:os';
import { InputError, validateDomain } from './core.mjs';

const DEFAULT_DNS_TIMEOUT_MS = 5_000;
const CLOUDFLARE_IPV4_CIDRS = [
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22',
  '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20',
  '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13',
  '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22'
].map(parseIpv4Cidr);

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

const PUBLIC_DNS_SERVERS = Object.freeze(['1.1.1.1', '8.8.8.8']);

async function resolveWithLookup(hostname, lookup, timeoutMs) {
  const signal = AbortSignal.timeout(timeoutMs);
  const records = await lookup(hostname, { all: true, order: 'ipv4first', signal });
  if (!Array.isArray(records)) return [];
  return records
    .map((item) => (typeof item === 'string' ? item : item?.address))
    .filter((item) => typeof item === 'string' && item);
}

async function resolveFromPublicDns(hostname, timeoutMs, options = {}) {
  if (options.lookup || options.resolve4 || options.resolve6) {
    if (!options.publicResolve4 && !options.publicResolve6) return [];
    const addresses = [];
    try {
      if (options.publicResolve4) addresses.push(...await resolveRecordList(options.publicResolve4, hostname, timeoutMs));
    } catch (error) {
      if (!isUnresolvedDnsError(error)) throw error;
    }
    try {
      if (options.publicResolve6) addresses.push(...await resolveRecordList(options.publicResolve6, hostname, timeoutMs));
    } catch (error) {
      if (!isUnresolvedDnsError(error)) throw error;
    }
    return addresses;
  }
  const Resolver = options.Resolver ?? dns.Resolver;
  const resolver = new Resolver();
  resolver.setServers(options.publicDnsServers ?? [...PUBLIC_DNS_SERVERS]);
  const addresses = [];
  try {
    addresses.push(...await resolveRecordList((name, opts) => resolver.resolve4(name, opts), hostname, timeoutMs));
  } catch (error) {
    if (!isUnresolvedDnsError(error)) throw error;
  }
  try {
    addresses.push(...await resolveRecordList((name, opts) => resolver.resolve6(name, opts), hostname, timeoutMs));
  } catch (error) {
    if (!isUnresolvedDnsError(error)) throw error;
  }
  return addresses;
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
    if (!resolved.length) {
      try {
        resolved.push(...await resolveFromPublicDns(hostname, timeoutMs, options));
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
    const cloudflareProxy = !matched && uniqueResolved.every(isCloudflareIpv4);
    if (cloudflareProxy) {
      return {
        hostname,
        resolved: uniqueResolved,
        expected,
        matched: false,
        status: 'proxied',
        proxy: { detected: true, provider: 'Cloudflare' },
        detail: 'DNS is routed through Cloudflare Proxy. Use DNS only and disable forced HTTPS while issuing the first HTTP-01 certificate.'
      };
    }
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

async function resolveMxRecords(hostname, options = {}) {
  const timeoutMs = Number.isInteger(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : DEFAULT_DNS_TIMEOUT_MS;
  const resolveMx = options.resolveMx ?? ((name, opts) => dns.resolveMx(name, opts));
  const records = await resolveMx(hostname, { signal: AbortSignal.timeout(timeoutMs) });
  if (!Array.isArray(records)) return [];
  return records.filter((item) => item && typeof item.exchange === 'string');
}

// Node returns TXT records as string chunks per record; join each record so
// long values (DKIM keys) compare as one string.
async function resolveTxtRecords(hostname, options = {}) {
  const timeoutMs = Number.isInteger(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : DEFAULT_DNS_TIMEOUT_MS;
  const resolveTxt = options.resolveTxt ?? ((name, opts) => dns.resolveTxt(name, opts));
  const records = await resolveTxt(hostname, { signal: AbortSignal.timeout(timeoutMs) });
  if (!Array.isArray(records)) return [];
  return records.map((chunks) => (Array.isArray(chunks) ? chunks.join('') : String(chunks ?? ''))).filter(Boolean);
}

function recordResult(status, detail = null) {
  return { status, checkedAt: new Date().toISOString(), detail };
}

function unresolvedOrError(error, notFoundDetail) {
  if (isUnresolvedDnsError(error)) return recordResult('not_found', notFoundDetail);
  return recordResult('error', 'DNS check failed. Verify network/DNS settings and try again.');
}

const stripDot = (value) => String(value ?? '').toLowerCase().replace(/\.$/, '');

export async function checkMailMx(mailDomain, expectedHostname, options = {}) {
  try {
    const records = await resolveMxRecords(mailDomain, options);
    if (!records.length) return recordResult('not_found', 'No MX record was found.');
    const expected = stripDot(expectedHostname);
    if (records.some((item) => stripDot(item.exchange) === expected)) return recordResult('verified');
    return recordResult('mismatch', `MX points to ${records.map((item) => stripDot(item.exchange)).join(', ')} instead of ${expected}.`);
  } catch (error) {
    return unresolvedOrError(error, 'No MX record was found.');
  }
}

export async function checkSpfRecord(mailDomain, expectedToken, options = {}) {
  try {
    const records = (await resolveTxtRecords(mailDomain, options)).filter((value) => /^v=spf1(\s|$)/i.test(value.trim()));
    if (!records.length) return recordResult('not_found', 'No SPF (v=spf1) TXT record was found.');
    // More than one v=spf1 record is a spec violation most receivers treat as
    // a permanent SPF failure, so surface it even when the token is present.
    if (records.length > 1) return recordResult('mismatch', `Found ${records.length} v=spf1 records; SPF allows exactly one.`);
    const tokens = records[0].trim().split(/\s+/).map((token) => token.toLowerCase());
    if (tokens.includes(String(expectedToken).toLowerCase())) return recordResult('verified');
    return recordResult('mismatch', `SPF record exists but is missing "${expectedToken}".`);
  } catch (error) {
    return unresolvedOrError(error, 'No SPF (v=spf1) TXT record was found.');
  }
}

export async function checkDkimRecord(selector, mailDomain, expectedPublicKey, options = {}) {
  try {
    const records = await resolveTxtRecords(`${selector}._domainkey.${mailDomain}`, options);
    if (!records.length) return recordResult('not_found', 'No DKIM TXT record was found at the selector.');
    const published = records.map((value) => value.match(/(?:^|;)\s*p=([^;\s]*)/)?.[1]).filter(Boolean);
    if (!published.length) return recordResult('mismatch', 'A TXT record exists at the selector but has no p= public key.');
    if (published.some((key) => key === expectedPublicKey)) return recordResult('verified');
    return recordResult('mismatch', 'The published DKIM public key does not match the key this Portal generated.');
  } catch (error) {
    return unresolvedOrError(error, 'No DKIM TXT record was found at the selector.');
  }
}

export async function checkDmarcRecord(mailDomain, options = {}) {
  try {
    const records = (await resolveTxtRecords(`_dmarc.${mailDomain}`, options)).filter((value) => /^v=DMARC1(\s*;|$)/i.test(value.trim()));
    if (!records.length) return recordResult('not_found', 'No DMARC TXT record was found at _dmarc.');
    if (!/(?:^|;)\s*p=/.test(records[0])) return recordResult('mismatch', 'DMARC record exists but has no p= policy tag.');
    return recordResult('verified');
  } catch (error) {
    return unresolvedOrError(error, 'No DMARC TXT record was found at _dmarc.');
  }
}

export async function checkPtrRecord(mailHostname, options = {}) {
  const timeoutMs = Number.isInteger(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : DEFAULT_DNS_TIMEOUT_MS;
  const reverse = options.reverse ?? ((ip) => dns.reverse(ip));
  const addresses = Array.isArray(options.addresses) ? options.addresses : hostExpectedAddresses(options.env, options.networkInterfaces);
  if (!addresses.length) return recordResult('error', 'No public host address is known. Set HOSTMGR_PUBLIC_IP to check PTR.');
  const expected = stripDot(mailHostname);
  const details = [];
  for (const address of addresses) {
    try {
      const names = asAddressList(await Promise.race([
        reverse(address),
        new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'ETIMEOUT' })), timeoutMs))
      ]));
      if (names.some((name) => stripDot(name) === expected)) return recordResult('verified');
      details.push(`${address} → ${names.length ? names.map(stripDot).join(', ') : '(no PTR)'}`);
    } catch (error) {
      if (isUnresolvedDnsError(error)) details.push(`${address} → (no PTR)`);
      else details.push(`${address} → (lookup failed)`);
    }
  }
  return recordResult('mismatch', `No PTR resolves to ${expected}. ${details.join('; ')}`.slice(0, 240));
}

/**
 * A proxied (orange-cloud) mail hostname breaks SMTP entirely — CDNs only
 * proxy HTTP(S). This checks the hostname's A/AAAA and flags Cloudflare IPs.
 */
export async function checkMailHostnameDns(hostname, options = {}) {
  const result = await checkDomainDns(hostname, options);
  return { ...result, proxied: result.status === 'proxied' };
}

function parseIpv4Cidr(value) {
  const [address, length] = value.split('/');
  const prefix = Number(length);
  return { network: ipv4ToNumber(address), mask: prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0 };
}

function ipv4ToNumber(address) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return parts.reduce((value, part) => ((value << 8) | part) >>> 0, 0);
}

function isCloudflareIpv4(address) {
  const value = ipv4ToNumber(address);
  return value !== null && CLOUDFLARE_IPV4_CIDRS.some(({ network, mask }) => (value & mask) === (network & mask));
}
