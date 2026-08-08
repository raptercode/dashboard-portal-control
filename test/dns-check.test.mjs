import test from 'node:test';
import assert from 'node:assert/strict';
import { InputError } from '../src/core.mjs';
import { checkDomainDns, hostExpectedAddresses } from '../src/dns-check.mjs';

test('hostExpectedAddresses merges env and non-internal NIC addresses', () => {
  const addresses = hostExpectedAddresses(
    { HOSTMGR_PUBLIC_IP: '157.245.1.2, 2001:db8::1' },
    () => ({ eth0: [{ address: '10.0.0.5', internal: true }, { address: '203.0.113.9', internal: false }], lo: [{ address: '127.0.0.1', internal: true }] }),
  );
  assert.deepEqual(addresses, ['157.245.1.2', '2001:db8::1', '203.0.113.9']);
});

test('checkDomainDns reports ok, mismatch, and unresolved', async () => {
  const ok = await checkDomainDns('App.Example.test', {
    expected: ['203.0.113.9'],
    resolve4: async () => ['203.0.113.9'],
    resolve6: async () => { throw new Error('no AAAA'); },
  });
  assert.deepEqual(ok, { hostname: 'app.example.test', resolved: ['203.0.113.9'], expected: ['203.0.113.9'], matched: true, status: 'ok' });

  const mismatch = await checkDomainDns('app.example.test', {
    expected: ['203.0.113.9'],
    resolve4: async () => ['198.51.100.4'],
    resolve6: async () => [],
  });
  assert.equal(mismatch.status, 'mismatch');
  assert.equal(mismatch.matched, false);

  const unresolved = await checkDomainDns('missing.example.test', {
    expected: ['203.0.113.9'],
    resolve4: async () => { throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }); },
    resolve6: async () => { throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }); },
  });
  assert.deepEqual(unresolved, { hostname: 'missing.example.test', resolved: [], expected: ['203.0.113.9'], matched: false, status: 'unresolved' });
});

test('checkDomainDns rejects invalid hostnames', async () => {
  await assert.rejects(() => checkDomainDns('not a domain'), InputError);
});
