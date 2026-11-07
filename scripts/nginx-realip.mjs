import { isIP } from 'node:net';
import { pathToFileURL } from 'node:url';
import { CLOUDFLARE_RANGES } from './domain-dns.mjs';

// Behind Cloudflare Proxy, the address Nginx sees is a Cloudflare edge, not the
// visitor. Cloudflare reports the visitor in CF-Connecting-IP; Nginx's real_ip
// module may adopt that header, but only on connections that come from an address
// it was told to trust. Trusting only the published Cloudflare ranges means a
// visitor who reaches the origin directly cannot choose the address Nginx logs
// and forwards as X-Real-IP. Loopback is deliberately not trusted.
const validRange = (range) => {
  const [address, prefix, extra] = String(range).split('/');
  const family = isIP(address);
  return Boolean(family) && extra === undefined && /^\d{1,3}$/.test(prefix ?? '') && Number(prefix) <= (family === 4 ? 32 : 128);
};

export function renderRealIpConf(ranges = CLOUDFLARE_RANGES) {
  for (const range of ranges) if (!validRange(range)) throw new Error(`Not a CIDR range: ${range}`);
  return [
    '# Managed by Strckro. Do not edit; the installer rewrites this file on every install and update.',
    '# CF-Connecting-IP is believed only on connections from these Cloudflare ranges.',
    ...ranges.map((range) => `set_real_ip_from ${range};`),
    'real_ip_header CF-Connecting-IP;',
    'real_ip_recursive off;',
    ''
  ].join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.stdout.write(renderRealIpConf());
