import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { ipv6Hextets } from './ip-address.mjs';

// The portal listens on loopback behind Nginx, so the socket peer of a real
// request is 127.0.0.1. Nginx puts the visitor's address in X-Real-IP (after its
// real_ip module has looked through Cloudflare) and always overwrites whatever
// the visitor sent.
//
// Loopback alone does not prove a request came through Nginx: any process on the
// host, such as a deployed project, can open 127.0.0.1 and send any X-Real-IP it
// likes, which would give each guess at the owner's password its own rate-limit
// bucket. So Nginx also stamps every proxied request with a secret that only
// root and the portal can read (HOSTMGR_PROXY_TOKEN, kept out of the world-readable
// site file). X-Real-IP is believed only together with that secret; otherwise the
// peer address is used, so local callers share the one loopback bucket.
// All of 127.0.0.0/8 is this machine, not just 127.0.0.1: Linux lets a local process bind any
// 127.x.y.z as its source address, so recognising only 127.0.0.1 would hand it a new "outside
// visitor" for every request. Every loopback peer is one visitor, reported as LOOPBACK_VISITOR.
const isLoopback = (address) => address === '::1' || address.startsWith('127.');
const LOOPBACK_VISITOR = '127.0.0.1';
const TOKEN_FORMAT = /^[A-Za-z0-9_-]{32,128}$/;
export const PROXY_TOKEN_HEADER = 'x-strckro-proxy-token';

const normalize = (address) => {
  const text = String(address ?? '').trim().toLowerCase();
  return text.startsWith('::ffff:') && isIP(text.slice(7)) === 4 ? text.slice(7) : text;
};
const digest = (value) => createHash('sha256').update(String(value)).digest();

// A token that is missing or too weak to be a secret turns forwarding off.
export const validProxyToken = (token) => typeof token === 'string' && TOKEN_FORMAT.test(token);

// The address a request should be rate-limited and attributed to, or 'unknown'.
export function clientAddress(request, proxyToken) {
  const peer = normalize(request.socket?.remoteAddress);
  if (!isLoopback(peer)) return peer || 'unknown';
  if (!validProxyToken(proxyToken)) return LOOPBACK_VISITOR;
  const presented = request.headers?.[PROXY_TOKEN_HEADER];
  if (typeof presented !== 'string' || !timingSafeEqual(digest(presented), digest(proxyToken))) return LOOPBACK_VISITOR;
  const forwarded = normalize(request.headers['x-real-ip']);
  return isIP(forwarded) ? forwarded : LOOPBACK_VISITOR;
}

// What a limiter counts under. One IPv6 subscriber holds a whole /64 (2^64 addresses) and can
// present a fresh one for every request, so counting per full address would give a guesser an
// endless supply of fresh budgets. IPv6 visitors are counted per /64; IPv4 stays per address.
export function clientBucket(request, proxyToken) {
  const address = clientAddress(request, proxyToken);
  const groups = isIP(address) === 6 ? ipv6Hextets(address) : null;
  return groups ? `${groups.slice(0, 4).map((group) => group.toString(16)).join(':')}::/64` : address;
}
