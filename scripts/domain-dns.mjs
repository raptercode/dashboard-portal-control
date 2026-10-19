import { Resolver } from 'node:dns/promises';
import { isIP, BlockList } from 'node:net';

// Published ranges: https://www.cloudflare.com/ips/ (IPv4 and IPv6).
const cloudflare = new BlockList();
for (const cidr of ['173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20', '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13', '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22', '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32']) {
  const [address, prefix] = cidr.split('/');
  cloudflare.addSubnet(address, Number(prefix), isIP(address) === 6 ? 'ipv6' : 'ipv4');
}

export function isCloudflareAddress(address) {
  const family = isIP(address);
  return Boolean(family && cloudflare.check(address, family === 6 ? 'ipv6' : 'ipv4'));
}

// Fixed public resolvers bypass stale negative answers in the host's NSS stub.
// This is only a preflight; Certbot still validates control through HTTP-01.
export async function resolvePublicDomainAddresses(hostname, options = {}) {
  const timeoutMs = options.timeoutMs ?? 5000;
  const ResolverClass = options.Resolver ?? Resolver;
  const results = await Promise.all((options.servers ?? ['1.1.1.1', '8.8.8.8']).map(async server => {
    const resolver = new ResolverClass({ timeout: timeoutMs, tries: 1 });
    resolver.setServers([server]);
    let timer;
    try {
      const records = Promise.allSettled([resolver.resolve4(hostname), resolver.resolve6(hostname)]);
      const outcomes = await Promise.race([
        records,
        new Promise(resolve => { timer = setTimeout(() => { resolver.cancel?.(); resolve([]); }, timeoutMs); })
      ]);
      return outcomes.flatMap(result => result.status === 'fulfilled' && Array.isArray(result.value) ? result.value.filter(value => typeof value === 'string' && isIP(value)) : []);
    } finally { clearTimeout(timer); }
  }));
  return [...new Set(results.flat())];
}
