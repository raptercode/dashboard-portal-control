import { createHash, verify } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function updateConfiguration(input = process.env) {
  const manifestUrl = input.HOSTMGR_UPDATE_MANIFEST_URL ?? input.manifestUrl ?? '';
  const publicKeyPath = input.HOSTMGR_UPDATE_PUBLIC_KEY_PATH ?? input.publicKeyPath ?? '';
  const channel = input.HOSTMGR_UPDATE_CHANNEL ?? input.channel ?? 'stable';
  if (!manifestUrl && !publicKeyPath) return { configured: false, channel };
  if (!manifestUrl || !publicKeyPath) return { configured: false, channel, issue: 'Update configuration is incomplete.' };
  try {
    const parsed = new URL(manifestUrl);
    if (parsed.protocol !== 'https:') throw new Error('Update manifest must use HTTPS.');
  } catch {
    return { configured: false, channel, issue: 'Update manifest URL must be HTTPS.' };
  }
  if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(channel)) return { configured: false, channel: 'stable', issue: 'Update channel is invalid.' };
  return { configured: true, manifestUrl, publicKeyPath, channel };
}

export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

export function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

export function parseSignedManifest(document, publicKey, channel = 'stable') {
  if (!document || typeof document !== 'object' || Array.isArray(document)) throw new Error('Update manifest format is invalid.');
  const { payload, signature } = document;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || typeof signature !== 'string') throw new Error('Update manifest format is invalid.');
  if (payload.channel !== channel) throw new Error('Update manifest channel does not match this host.');
  if (!VERSION_PATTERN.test(payload.version ?? '')) throw new Error('Update manifest version is invalid.');
  if (typeof payload.publishedAt !== 'string' || Number.isNaN(Date.parse(payload.publishedAt))) throw new Error('Update manifest publication date is invalid.');
  if (typeof payload.archiveUrl !== 'string' || new URL(payload.archiveUrl).protocol !== 'https:') throw new Error('Update archive URL must be HTTPS.');
  if (typeof payload.archiveSha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(payload.archiveSha256)) throw new Error('Update archive checksum is invalid.');
  if (payload.notes !== undefined && (typeof payload.notes !== 'string' || payload.notes.length > 4000)) throw new Error('Update notes are invalid.');
  const valid = verify(null, Buffer.from(canonicalJson(payload)), publicKey, Buffer.from(signature, 'base64'));
  if (!valid) throw new Error('Update manifest signature verification failed.');
  return { ...payload, archiveSha256: payload.archiveSha256.toLowerCase() };
}

export async function fetchVerifiedManifest(config, fetcher = fetch) {
  if (!config?.configured) throw new Error(config?.issue ?? 'Software update is not configured.');
  const publicKey = await readFile(config.publicKeyPath, 'utf8');
  const response = await fetcher(config.manifestUrl, {
    headers: { Accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(10_000)
  });
  if (!response?.ok) throw new Error('Update manifest could not be downloaded.');
  const length = Number(response.headers?.get?.('content-length') ?? 0);
  if (Number.isFinite(length) && length > 64 * 1024) throw new Error('Update manifest is too large.');
  const document = await response.json();
  return parseSignedManifest(document, publicKey, config.channel);
}

export async function softwareUpdateStatus({ config, currentVersion, fetcher = fetch }) {
  if (!config?.configured) return { configured: false, currentVersion, channel: config?.channel ?? 'stable', issue: config?.issue ?? null };
  try {
    const update = await fetchVerifiedManifest(config, fetcher);
    const comparison = compareVersions(update.version, currentVersion);
    return {
      configured: true,
      status: comparison > 0 ? 'available' : comparison === 0 ? 'current' : 'ahead',
      channel: config.channel,
      currentVersion,
      checkedAt: new Date().toISOString(),
      update: { version: update.version, publishedAt: update.publishedAt, notes: update.notes ?? '' }
    };
  } catch {
    return { configured: true, status: 'unavailable', channel: config.channel, currentVersion, checkedAt: new Date().toISOString(), issue: 'Update manifest could not be verified.' };
  }
}

export async function sha256File(filename) {
  const { createReadStream } = await import('node:fs');
  return await new Promise((resolve, reject) => {
    const digest = createHash('sha256');
    const stream = createReadStream(filename);
    stream.on('data', (chunk) => digest.update(chunk));
    stream.once('error', reject);
    stream.once('end', () => resolve(digest.digest('hex')));
  });
}

function parseVersion(value) {
  const match = VERSION_PATTERN.exec(value ?? '');
  if (!match) throw new Error('Version must use major.minor.patch format.');
  return match.slice(1).map(Number);
}
