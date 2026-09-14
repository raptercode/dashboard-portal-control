import { createHash } from 'node:crypto';

export function projectServiceUser(slug) {
  if (typeof slug !== 'string' || !/^[a-z][a-z0-9-]{0,62}$/.test(slug)) throw new Error('Project slug is invalid.');
  const legacy = `hostmgr-${slug}`;
  // Preserve existing accounts; distinguish long slugs sharing a prefix.
  return legacy.length <= 32 ? legacy : `hostmgr-${slug.slice(0, 7)}-${createHash('sha256').update(slug).digest('hex').slice(0, 16)}`;
}
