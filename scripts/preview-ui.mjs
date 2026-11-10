#!/usr/bin/env node
// Isolated local workspace. Nothing in this process controls the production host.
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createApplication } from '../src/server.mjs';

const port = Number(process.env.STRCKRO_PREVIEW_PORT || 4343);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid preview port.');
const directory = await mkdtemp(join(tmpdir(), 'strckro-ui-preview-'));
const app = await createApplication({
  dataPath: join(directory, 'state.json'),
  projectRoot: join(directory, 'projects'),
  password: 'Strckro-Preview-2026!',
  ownerEmail: 'preview@strckro.local',
  secretKey: randomBytes(32).toString('base64'),
  mode: 'demo', sandboxClone: false, metricsEnabled: false,
  secureCookie: false, updateConfig: {},
  portAvailability: async () => true,
  acquireMaintenanceLease: async () => ({ assertHeld() {}, async release() {} })
});
await app.store.update(state => {
  const org = state.organizations[0];
  state.git.identity = { name: 'Strckro preview', email: 'preview@strckro.local' };
  for (const tool of Object.values(state.tools)) { tool.status = 'Installed'; tool.version ||= 'Preview'; }
  const now = Date.now();
  const specs = [
    ['storefront', 'Storefront', 'next', 'node', 'active', 'shop.example.test', 3001],
    ['payments-api', 'Payments API', 'hono', 'bun', 'active', 'api.example.test', 3002],
    ['background-jobs', 'Background jobs', '', 'node', 'idle', '', 3003],
    ['docs-site', 'Documentation', 'astro', 'node', 'failed', 'docs.example.test', 3004]
  ];
  state.projects = specs.map(([slug, name, framework, runtime, phase, domain, port], index) => {
    const createdAt = new Date(now - (index * 18 + 4) * 60000).toISOString();
    const releaseId = `preview-release-${index}`;
    return {
      slug, name, framework, runtime, port, organizationId: org.id, organization: org.name,
      repository: `https://github.com/strckro-demo/${slug}.git`, protocol: 'https', branch: 'main', directory: '/',
      nodeMajor: 24, buildScript: 'build', startScript: 'start', serviceType: slug === 'background-jobs' ? 'worker' : 'web',
      healthCheckEnabled: true, healthCheckPath: '/',
      // Three storage states in the demo: live, live in a nested folder, and not deployed yet.
      ...({ storefront: { storagePath: 'uploads' }, 'payments-api': { storagePath: 'public/uploads' }, 'docs-site': { storagePath: 'data' } }[slug] ?? {}),
      sync: { status: 'synced', revision: `${index + 1}c9e6af41092d8b3`, updatedAt: createdAt },
      domains: { hosts: domain ? [domain] : [], status: domain ? 'active' : 'pending' },
      environment: { keys: ['NODE_ENV', 'API_URL'] },
      deployment: { state: phase, activeReleaseId: phase === 'active' ? releaseId : null, previousReleaseId: null,
        releases: phase === 'idle' ? [] : [{ id: releaseId, revision: `${index + 1}c9e6af41092d8b3`, status: phase, createdAt, activatedAt: phase === 'active' ? createdAt : null, events: [] }] }
    };
  });
});
app.server.listen(port, '127.0.0.1', () => {
  console.log(`Strckro UI preview: http://127.0.0.1:${port}`);
  console.log('Demo login: preview@strckro.local / Strckro-Preview-2026!');
  console.log(`Temporary demo state: ${directory}`);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await app.close(); process.exit(0); });
