import { runtimeLabel } from '../public/ui/core/runtimes.js';

// What each notification provider receives. Pure functions: nothing here sends
// anything, so every payload shape can be tested without a network.

// Brand "signal" lime for a deployment that went live, a warm red for one that did not.
const COLORS = Object.freeze({ success: 0xd8ff70, failure: 0xff6b5a });
// Discord rejects a payload that exceeds any of these.
const LIMITS = Object.freeze({ title: 256, description: 4096, fieldName: 256, fieldValue: 1024, footer: 2048 });
const DETAIL_LIMIT = 1500;

// "https://portal.example.com" from a configured domain, or null when there is none to trust.
export function portalOrigin(domain) {
  const host = typeof domain === 'string' ? domain.trim().toLowerCase() : '';
  return /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host) ? `https://${host}` : null;
}

const clip = (value, max) => {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};
const plain = (value) => String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
const code = (value) => `\`${plain(value).replaceAll('`', "'")}\``;
const field = (name, value) => (value ? { name, value: clip(value, LIMITS.fieldValue), inline: true } : null);

// "45s", "1m 05s", "2h 03m"; empty when either time is missing or out of order.
export function formatDuration(startedAt, finishedAt) {
  const start = Date.parse(startedAt);
  const end = Date.parse(finishedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return '';
  const seconds = Math.round((end - start) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

function discordPayload({ event, project, job, detail, origin }) {
  const succeeded = event === 'deployment.succeeded';
  const logo = origin ? `${origin}/ui/brand/logo.png` : null;
  const release = project.deployment?.releases?.find((item) => item.id === job.releaseId);
  const revision = release?.revision || project.sync?.revision;
  const host = succeeded ? plain(project.domains?.hosts?.[0]) : '';
  const text = clip(String(detail ?? '').replaceAll('```', "'''").trim(), DETAIL_LIMIT) || (succeeded ? '' : 'No further detail was recorded.');
  const fields = [
    field('Runtime', plain(runtimeLabel(project))),
    field('Branch', project.branch && code(project.branch)),
    field('Commit', revision && code(String(revision).slice(0, 7))),
    field('Release', job.releaseId && code(String(job.releaseId).slice(0, 8))),
    field('Duration', formatDuration(job.startedAt, job.finishedAt)),
    field('Domain', host && `[${host}](https://${host})`)
  ].filter(Boolean);
  return {
    // The sender is always Strckro, wearing its mark; the project is named inside the embed.
    username: 'Strckro',
    ...(logo ? { avatar_url: logo } : {}),
    // A project name or a build message must never be able to ping anyone.
    allowed_mentions: { parse: [] },
    embeds: [{
      author: { name: clip(plain(project.name) || plain(project.slug), LIMITS.title) },
      title: succeeded ? '✅ Deployment succeeded' : '❌ Deployment failed',
      ...(origin ? { url: `${origin}/projects#${encodeURIComponent(project.slug)}` } : {}),
      description: clip(succeeded ? text : `\`\`\`\n${text}\n\`\`\``, LIMITS.description),
      color: succeeded ? COLORS.success : COLORS.failure,
      fields,
      footer: { text: clip(origin ? `Strckro · ${origin.slice('https://'.length)}` : 'Strckro', LIMITS.footer), ...(logo ? { icon_url: logo } : {}) },
      ...(Number.isFinite(Date.parse(job.finishedAt)) ? { timestamp: new Date(job.finishedAt).toISOString() } : {})
    }]
  };
}

export function notificationPayload(provider, input) {
  if (provider === 'discord') return discordPayload(input);
  const { event, project, job, detail } = input;
  const title = event === 'deployment.succeeded' ? 'Deployment succeeded' : 'Deployment failed';
  const text = `${title}: ${project.name} (${project.slug}) — ${detail}`;
  if (provider === 'google-chat') return { cardsV2: [{ cardId: `hostmgr-${job.id}`, card: { header: { title, subtitle: project.slug }, sections: [{ widgets: [{ decoratedText: { text: detail } }, { decoratedText: { text: `Release: ${job.releaseId || '—'}` } }] }] } }] };
  if (provider === 'slack') return { text, blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `*${title}*\n${project.name} (${project.slug})\n${detail}` } }] };
  return { event, project: { name: project.name, slug: project.slug }, deployment: { jobId: job.id, releaseId: job.releaseId, status: job.status }, detail };
}
