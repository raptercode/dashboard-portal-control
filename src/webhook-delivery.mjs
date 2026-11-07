import { lookup as dnsLookup } from 'node:dns';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { ipv6Hextets } from './ip-address.mjs';

// Sending a deployment notification means this process connects to a URL that a member
// typed in. Left alone that is a request forgery primitive: https://127.0.0.1:3100,
// https://169.254.169.254, a router or a database admin page on the LAN, with the HTTP
// status written back into the hook for the member to read. So the destination must be
// a public address, and it is checked where it cannot be raced: the address the socket
// connects to is the one that was validated, never a second DNS answer.

// `reason` is what the hook records, so the owner can tell a refused destination from a bad URL.
export class WebhookDestinationError extends Error {
  constructor(message = 'Webhook destination is not a public address.', reason = 'destination-not-public') {
    super(message);
    this.name = 'WebhookDestinationError';
    this.reason = reason;
  }
}

const unroutable = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]
]) unroutable.addSubnet(network, prefix, 'ipv4');
for (const [network, prefix] of [
  ['::', 96], ['::ffff:0:0:0', 96], ['64:ff9b:1::', 48], ['100::', 64], ['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20],
  ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8]
]) unroutable.addSubnet(network, prefix, 'ipv6');

// An IPv4 address carried inside IPv6 (::ffff:a.b.c.d, or NAT64 64:ff9b::a.b.c.d) is judged as that IPv4 address.
// The other translation prefixes (::ffff:0:0:0/96 and the local-use 64:ff9b:1::/48) are refused whole above.
function embeddedIpv4(text) {
  const groups = ipv6Hextets(text);
  if (!groups) return null;
  const mapped = groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;
  const nat64 = groups[0] === 0x64 && groups[1] === 0xff9b && groups.slice(2, 6).every((group) => group === 0);
  if (!mapped && !nat64) return null;
  return [groups[6] >> 8, groups[6] & 255, groups[7] >> 8, groups[7] & 255].join('.');
}

// True only for an address on the public Internet. Anything unparseable is refused.
export function isPublicAddress(address) {
  const text = String(address ?? '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  const family = isIP(text);
  if (!family || text.includes('%')) return false;
  if (family === 6) {
    const embedded = embeddedIpv4(text);
    if (embedded) return isPublicAddress(embedded);
    // Only 2000::/3 is global unicast. Allow-listing it refuses every other prefix at once, translation
    // prefixes and reserved space included, instead of relying on a list of the bad ones being complete.
    const groups = ipv6Hextets(text);
    if (!groups || groups[0] >> 13 !== 1) return false;
  }
  return !unroutable.check(text, family === 4 ? 'ipv4' : 'ipv6');
}

// Names that only mean something inside one network. DNS is still checked at delivery;
// this is the early, readable refusal when the hook is saved.
const PRIVATE_NAME = /(^|\.)(localhost|local|localdomain|internal|intranet|lan|home|corp|private|home\.arpa)$/;

// A reason string when the URL host cannot be a public destination, otherwise null.
export function webhookHostProblem(hostname) {
  const host = String(hostname ?? '').trim().toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
  if (!host) return 'Webhook URL has no host.';
  if (isIP(host)) return isPublicAddress(host) ? null : 'Webhook URL must point to a public address, not a private, loopback or link-local one.';
  if (!host.includes('.') || PRIVATE_NAME.test(host)) return 'Webhook URL must use a public host name, not an internal one.';
  return null;
}

// A net.connect `lookup` that resolves the name itself and refuses to hand back any
// address that is not public. A name with even one private answer is refused whole, so
// an attacker cannot hide a private address among public ones.
export function createPublicLookup({ allowPrivate = false, lookup = dnsLookup } = {}) {
  return (hostname, options, callback) => {
    if (typeof options === 'function') { callback = options; options = {}; }
    lookup(hostname, { ...options, all: true }, (error, addresses) => {
      if (error) return callback(error);
      const answers = Array.isArray(addresses) ? addresses : [{ address: addresses, family: isIP(addresses) }];
      if (!answers.length || (!allowPrivate && answers.some((answer) => !isPublicAddress(answer.address)))) return callback(new WebhookDestinationError());
      return options.all ? callback(null, answers) : callback(null, answers[0].address, answers[0].family);
    });
  };
}

// What a delivery attempt records on the hook. External webhook failures never affect
// deployment state, so nothing here throws. A refused destination is named so the owner
// can see why nothing was sent; the target's own errors stay private.
export async function deliverWebhook(sender, endpoint, payload, options) {
  try {
    const { status } = await sender(endpoint, payload, options);
    return { status: status >= 200 && status < 300 ? 'sent' : 'failed', httpStatus: status };
  } catch (error) {
    return { status: 'failed', httpStatus: null, ...(error instanceof WebhookDestinationError ? { reason: error.reason } : {}) };
  }
}

const RESPONSE_LIMIT = 64 * 1024;

// POST a JSON payload. Resolves to { status }; rejects on network failure, a
// destination that is not public, or a timeout. Redirects are never followed, so a
// public URL cannot bounce the request to an internal one; a 3xx is just a status.
export function postWebhook(endpoint, payload, { allowPrivate = false, timeoutMs = 8000, lookup, request = httpsRequest } = {}) {
  return new Promise((resolve, reject) => {
    let url;
    try { url = new URL(endpoint); } catch { return reject(new WebhookDestinationError('Webhook URL is invalid.', 'invalid-url')); }
    if (url.protocol !== 'https:') return reject(new WebhookDestinationError('Webhook URL must use HTTPS.', 'invalid-url'));
    const problem = allowPrivate ? null : webhookHostProblem(url.hostname);
    if (problem) return reject(new WebhookDestinationError(problem));
    const body = Buffer.from(JSON.stringify(payload));
    let settled = false;
    let deadline = null;
    const finish = (action, value) => { if (settled) return; settled = true; action(value); };
    const outgoing = request(url, {
      method: 'POST',
      agent: false,
      lookup: createPublicLookup({ allowPrivate, lookup }),
      // fetch sent a User-Agent; some webhook hosts (Discord sits behind Cloudflare) refuse a request without one.
      headers: { 'content-type': 'application/json', 'content-length': body.length, 'user-agent': 'Strckro' }
    }, (response) => {
      let seen = 0;
      // Only the status is wanted. Drain the body to free the socket, but never keep it.
      response.on('data', (chunk) => { seen += chunk.length; if (seen > RESPONSE_LIMIT) response.destroy(); });
      response.on('error', () => {});
      finish(resolve, { status: response.statusCode });
    });
    // One deadline for the whole exchange, including a body that is still being drained
    // after the status arrived, so a slow or endless response cannot hold a socket open.
    deadline = setTimeout(() => outgoing.destroy(new Error('Webhook delivery timed out.')), timeoutMs);
    deadline.unref?.();
    outgoing.on('close', () => clearTimeout(deadline));
    outgoing.on('error', (error) => finish(reject, error));
    outgoing.end(body);
  });
}
