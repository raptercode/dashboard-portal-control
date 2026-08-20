import test from 'node:test';
import assert from 'node:assert/strict';
import { InputError } from '../src/core.mjs';
import { checkDomainDns, hostExpectedAddresses } from '../src/dns-check.mjs';

const noLookup = async () => {
  throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
};

test('hostExpectedAddresses uses configured public addresses instead of NIC inventory', () => {
  const addresses = hostExpectedAddresses(
    { HOSTMGR_PUBLIC_IP: '157.245.1.2, 2001:db8::1' },
    () => ({ eth0: [{ address: '10.0.0.5', internal: true }, { address: '203.0.113.9', internal: false }], lo: [{ address: '127.0.0.1', internal: true }] }),
  );
  assert.deepEqual(addresses, ['157.245.1.2', '2001:db8::1']);
});

test('hostExpectedAddresses falls back to public NIC addresses only', () => {
  const addresses = hostExpectedAddresses(
    {},
    () => ({
      eth0: [{ address: '203.0.113.9', internal: false }, { address: '10.0.0.5', internal: false }],
      docker0: [{ address: '172.20.0.1', internal: false }, { address: 'fe80::1', internal: false }],
      lo: [{ address: '127.0.0.1', internal: true }],
    }),
  );
  assert.deepEqual(addresses, ['203.0.113.9']);
});

test('hostExpectedAddresses survives uv_interface_addresses system errors', () => {
  const addresses = hostExpectedAddresses(
    { HOSTMGR_PUBLIC_IP: '203.0.113.9' },
    () => {
      throw Object.assign(new Error('A system error occurred: uv_interface_addresses returned Unknown system error 97'), {
        code: 'ERR_SYSTEM_ERROR',
        errno: 97,
        syscall: 'uv_interface_addresses',
      });
    },
  );
  assert.deepEqual(addresses, ['203.0.113.9']);
});

test('checkDomainDns reports ok, mismatch, and unresolved', async () => {
  const ok = await checkDomainDns('App.Example.test', {
    expected: ['203.0.113.9'],
    lookup: async () => [{ address: '203.0.113.9', family: 4 }],
    resolve4: async () => ['198.51.100.4'],
    resolve6: async () => { throw new Error('no AAAA'); },
  });
  assert.deepEqual(ok, { hostname: 'app.example.test', resolved: ['203.0.113.9'], expected: ['203.0.113.9'], matched: true, status: 'ok' });

  const mismatch = await checkDomainDns('app.example.test', {
    expected: ['203.0.113.9'],
    lookup: noLookup,
    resolve4: async () => ['198.51.100.4'],
    resolve6: async () => [],
  });
  assert.equal(mismatch.status, 'mismatch');
  assert.equal(mismatch.matched, false);

  const unresolved = await checkDomainDns('missing.example.test', {
    expected: ['203.0.113.9'],
    lookup: noLookup,
    resolve4: async () => { throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }); },
    resolve6: async () => { throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }); },
  });
  assert.deepEqual(unresolved, { hostname: 'missing.example.test', resolved: [], expected: ['203.0.113.9'], matched: false, status: 'unresolved' });
});

test('checkDomainDns falls back to public resolvers when the host stub has no record', async () => {
  const result = await checkDomainDns('app.example.test', {
    expected: ['187.52.115.194'],
    lookup: noLookup,
    resolve4: async () => { throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }); },
    resolve6: async () => { throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }); },
    publicResolve4: async () => ['187.52.115.194'],
    publicResolve6: async () => [],
  });
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.resolved, ['187.52.115.194']);
});

test('checkDomainDns identifies a Cloudflare-proxied record without treating it as an origin match', async () => {
  const result = await checkDomainDns('app.example.test', {
    expected: ['203.0.113.9'],
    lookup: async () => [{ address: '104.21.51.31', family: 4 }, { address: '172.67.220.8', family: 4 }],
  });
  assert.equal(result.status, 'proxied');
  assert.equal(result.matched, false);
  assert.deepEqual(result.proxy, { detected: true, provider: 'Cloudflare' });
  assert.match(result.detail, /DNS only/);
});

test('checkDomainDns rejects invalid hostnames', async () => {
  await assert.rejects(() => checkDomainDns('not a domain'), InputError);
});

test('checkDomainDns soft-fails unexpected resolver or NIC errors', async () => {
  const brokenNics = await checkDomainDns('app.example.test', {
    expected: undefined,
    networkInterfaces: () => { throw new Error('nic enumeration failed'); },
    env: {},
    lookup: async () => [{ address: '203.0.113.9', family: 4 }],
    resolve4: async () => ['203.0.113.9'],
    resolve6: async () => [],
  });
  assert.equal(brokenNics.status, 'mismatch');
  assert.deepEqual(brokenNics.resolved, ['203.0.113.9']);
  assert.deepEqual(brokenNics.expected, []);

  const brokenResolver = await checkDomainDns('app.example.test', {
    expected: ['203.0.113.9'],
    lookup: noLookup,
    resolve4: async () => { throw Object.assign(new Error('resolver exploded'), { code: 'ESERVFAIL' }); },
    resolve6: async () => { throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }); },
  });
  assert.equal(brokenResolver.status, 'unresolved');

  const nonArray = await checkDomainDns('app.example.test', {
    expected: ['203.0.113.9'],
    lookup: async () => undefined,
    resolve4: async () => undefined,
    resolve6: async () => 'not-an-array',
  });
  assert.equal(nonArray.status, 'unresolved');

  const unexpected = await checkDomainDns('app.example.test', {
    expected: ['203.0.113.9'],
    lookup: async () => { throw new Error('resolver pipe broken'); },
    resolve4: async () => { throw new Error('resolver pipe broken'); },
    resolve6: async () => { throw new Error('resolver pipe broken'); },
  });
  assert.equal(unexpected.status, 'error');
  assert.match(unexpected.detail, /DNS check failed/i);
});
