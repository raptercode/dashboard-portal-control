import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { formatDuration, notificationPayload, portalOrigin } from '../src/notifications.mjs';

const origin = 'https://portal.example.test';
const releaseId = '9f8e7d6c-1111-4222-8333-444455556666';
const project = () => ({
  name: 'Alternative API',
  slug: 'alternative-api',
  branch: 'main',
  runtime: 'node',
  framework: 'next',
  sync: { revision: 'fedcba9876543210' },
  domains: { hosts: ['api.example.test'] },
  deployment: { releases: [{ id: releaseId, revision: 'a1b2c3d4e5f60718' }] }
});
const job = (extra = {}) => ({
  id: 'job-1',
  releaseId,
  status: 'succeeded',
  startedAt: '2026-11-07T10:00:00.000Z',
  finishedAt: '2026-11-07T10:01:12.000Z',
  ...extra
});
const discord = (input) => notificationPayload('discord', { event: 'deployment.succeeded', project: project(), job: job(), detail: 'Deployment completed and the new release is active.', origin, ...input });

test('a successful deployment is an embed, sent by Strckro and naming the project inside', () => {
  const payload = discord();
  assert.equal(payload.username, 'Strckro');
  assert.equal(payload.avatar_url, `${origin}/ui/brand/logo.png`);
  assert.deepEqual(payload.allowed_mentions, { parse: [] });
  assert.equal(payload.content, undefined);
  const [embed] = payload.embeds;
  assert.equal(embed.title, '✅ Deployment succeeded');
  assert.equal(embed.url, `${origin}/projects#alternative-api`);
  assert.equal(embed.color, 0xd8ff70);
  assert.equal(embed.description, 'Deployment completed and the new release is active.');
  assert.deepEqual(embed.author, { name: 'Alternative API' });
  assert.deepEqual(embed.footer, { text: 'Strckro · portal.example.test', icon_url: `${origin}/ui/brand/logo.png` });
  assert.equal(embed.timestamp, '2026-11-07T10:01:12.000Z');
  assert.deepEqual(
    embed.fields.map((item) => [item.name, item.value]),
    [
      ['Runtime', 'Next.js'],
      ['Branch', '`main`'],
      // The commit of the release that was built, not of whatever was synced since.
      ['Commit', '`a1b2c3d`'],
      ['Release', '`9f8e7d6c`'],
      ['Duration', '1m 12s'],
      ['Domain', '[api.example.test](https://api.example.test)']
    ]
  );
  assert.ok(embed.fields.every((item) => item.inline === true));
});

test('a failed deployment is red, shows the reason in a code block and links no domain', () => {
  const payload = discord({
    event: 'deployment.failed',
    job: job({ status: 'failed' }),
    detail: 'npm run build exited with code 1\n```\n@everyone'
  });
  const [embed] = payload.embeds;
  assert.equal(embed.title, '❌ Deployment failed');
  assert.equal(embed.color, 0xff6b5a);
  assert.ok(embed.description.startsWith('```\nnpm run build exited with code 1'));
  assert.ok(embed.description.endsWith('\n```'));
  // The reason cannot close the code block early or ping anyone.
  assert.equal(embed.description.split('```').length - 1, 2);
  assert.deepEqual(payload.allowed_mentions, { parse: [] });
  assert.equal(embed.fields.some((item) => item.name === 'Domain'), false);
  assert.match(discord({ event: 'deployment.failed', detail: '' }).embeds[0].description, /No further detail was recorded\./);
});

test('whatever the project is called, Strckro is the sender and the name stays readable in the embed', () => {
  // Discord refuses some names as a sender ("discord", "clyde"); the sender never depends on the project.
  for (const name of ['Discord Bot', 'my CLYDE helper', 'x'.repeat(200)]) {
    const payload = discord({ project: { ...project(), name } });
    assert.equal(payload.username, 'Strckro');
    assert.equal(payload.embeds[0].author.name, name);
  }
  assert.equal(discord({ project: { ...project(), name: 'a\nb\u0007c' } }).embeds[0].author.name, 'a b c');
  assert.equal(discord({ project: { ...project(), name: '   ' } }).embeds[0].author.name, 'alternative-api');
});

test('without a known portal address there is no logo, no link and no domain in the footer', () => {
  const payload = discord({ origin: null });
  assert.equal(payload.avatar_url, undefined);
  assert.equal(payload.embeds[0].url, undefined);
  assert.deepEqual(payload.embeds[0].footer, { text: 'Strckro' });
  assert.equal(portalOrigin('portal.example.test'), 'https://portal.example.test');
  assert.equal(portalOrigin(' Portal.Example.Test '), 'https://portal.example.test');
  for (const bad of [undefined, '', 'localhost', 'a b.example.test', 'http://portal.example.test', 'portal.example.test/path', 'example.test:8443'])
    assert.equal(portalOrigin(bad), null, String(bad));
});

test('details that are not known are left out instead of shown as blanks', () => {
  const bare = notificationPayload('discord', {
    event: 'deployment.succeeded',
    project: { name: 'Bare', slug: 'bare', runtime: 'node' },
    job: { id: 'job-2', status: 'succeeded' },
    detail: 'done',
    origin
  });
  const [embed] = bare.embeds;
  assert.deepEqual(embed.fields.map((item) => item.name), ['Runtime']);
  assert.equal(embed.fields[0].value, 'Node.js');
  assert.equal(embed.timestamp, undefined);
  assert.equal(JSON.stringify(bare).includes('undefined'), false);
});

test('a huge name or failure message stays inside what Discord accepts', () => {
  const payload = discord({
    event: 'deployment.failed',
    project: { ...project(), name: 'N'.repeat(500), branch: 'b'.repeat(3000) },
    detail: 'x'.repeat(100000)
  });
  const [embed] = payload.embeds;
  assert.ok(embed.author.name.length <= 256);
  assert.ok(embed.title.length <= 256);
  assert.ok(embed.description.length <= 4096);
  assert.ok(embed.fields.length <= 25);
  for (const item of embed.fields) assert.ok(item.name.length <= 256 && item.value.length <= 1024);
  const total = [embed.title, embed.description, embed.footer.text, embed.author?.name ?? '', ...embed.fields.flatMap((item) => [item.name, item.value])].join('').length;
  assert.ok(total <= 6000, `embed text is ${total} characters`);
});

test('the other providers keep exactly the messages they had', () => {
  const input = { event: 'deployment.succeeded', project: project(), job: job(), detail: 'Deployment completed.', origin };
  const slack = notificationPayload('slack', input);
  assert.equal(slack.text, 'Deployment succeeded: Alternative API (alternative-api) — Deployment completed.');
  assert.deepEqual(slack.blocks, [{ type: 'section', text: { type: 'mrkdwn', text: '*Deployment succeeded*\nAlternative API (alternative-api)\nDeployment completed.' } }]);
  const chat = notificationPayload('google-chat', input);
  assert.equal(chat.cardsV2[0].cardId, 'hostmgr-job-1');
  assert.deepEqual(chat.cardsV2[0].card.header, { title: 'Deployment succeeded', subtitle: 'alternative-api' });
  assert.equal(chat.cardsV2[0].card.sections[0].widgets[1].decoratedText.text, `Release: ${releaseId}`);
  assert.deepEqual(notificationPayload('generic', input), {
    event: 'deployment.succeeded',
    project: { name: 'Alternative API', slug: 'alternative-api' },
    deployment: { jobId: 'job-1', releaseId, status: 'succeeded' },
    detail: 'Deployment completed.'
  });
});

test('how long a deployment took reads naturally', () => {
  const at = (seconds) => new Date(Date.UTC(2026, 10, 7, 10, 0, seconds)).toISOString();
  const start = at(0);
  assert.equal(formatDuration(start, at(45)), '45s');
  assert.equal(formatDuration(start, at(72)), '1m 12s');
  assert.equal(formatDuration(start, at(3723)), '1h 02m');
  assert.equal(formatDuration(undefined, at(5)), '');
  assert.equal(formatDuration(at(30), at(5)), '');
});

test('the server sends the portal address from its configuration with every delivery', async () => {
  const source = await readFile(new URL('../src/server.mjs', import.meta.url), 'utf8');
  assert.match(source, /options\.portalOrigin \?\? originOf\(process\.env\.HOSTMGR_PORTAL_DOMAIN\)/);
  assert.match(source, /notificationPayload\(hook\.provider, \{ event, project, job, detail, origin: portalOrigin \}\)/);
});
