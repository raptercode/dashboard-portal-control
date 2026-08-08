import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('installer systemd and Nginx heredocs contain no command substitutions', async () => {
  const script = await readFile(new URL('../dashboard-portal.sh', import.meta.url), 'utf8');
  const heredocs = [...script.matchAll(/<<EOF\r?\n([\s\S]*?)\r?\nEOF/g)].map((match) => match[1]);
  assert.equal(heredocs.length, 5);
  for (const body of heredocs) {
    assert.equal(body.includes('`'), false, 'unquoted heredocs must not execute backticks');
    assert.equal(body.includes('$('), false, 'unquoted heredocs must not execute command substitutions');
  }
});

test('installer allows AF_NETLINK so host NIC enumeration works under systemd', async () => {
  const script = await readFile(new URL('../dashboard-portal.sh', import.meta.url), 'utf8');
  const matches = [...script.matchAll(/RestrictAddressFamilies=([^\n]+)/g)].map((match) => match[1].trim());
  assert.equal(matches.length, 2);
  for (const value of matches) {
    assert.match(value, /\bAF_NETLINK\b/);
    assert.match(value, /\bAF_INET\b/);
    assert.match(value, /\bAF_UNIX\b/);
  }
});
