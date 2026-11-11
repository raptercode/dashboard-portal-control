import net from 'node:net';
import tls from 'node:tls';
import { generateKeyPairSync } from 'node:crypto';
import { InputError, validateDomain } from './core.mjs';
import { composeMessage } from './mail-message.mjs';

export const MAIL_MAX_DOMAINS = 10;
export const MAIL_OUTBOUND_MODES = Object.freeze(['direct', 'relay-587', 'relay-2525']);
const SMTP_TIMEOUT_MS = 15_000;

// Well-known relay SPF includes, keyed by a substring of the relay host.
const RELAY_SPF_INCLUDES = Object.freeze([
  { match: 'brevo', include: 'include:spf.brevo.com' },
  { match: 'sendinblue', include: 'include:spf.brevo.com' },
  { match: 'smtp2go', include: 'include:spf.smtp2go.com' },
  { match: 'mailgun', include: 'include:mailgun.org' },
  { match: 'sendgrid', include: 'include:sendgrid.net' }
]);

export function validateMailHostname(value) {
  return validateDomain({ hostname: value });
}

export function validateLocalPart(value) {
  const localPart = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!/^[a-z0-9][a-z0-9._-]{0,62}$/.test(localPart) || localPart.includes('..') || localPart.endsWith('.')) {
    throw new InputError('Local part must use lowercase letters, digits, dots, hyphens, or underscores.');
  }
  return localPart;
}

export function validateOutboundMode(input) {
  const mode = input?.mode;
  if (!MAIL_OUTBOUND_MODES.includes(mode)) throw new InputError('Outbound mode must be direct, relay-587, or relay-2525.');
  if (mode === 'direct') return { mode, relay: null };
  const relay = input?.relay;
  const host = typeof relay?.host === 'string' ? relay.host.trim().toLowerCase() : '';
  if (!/^(?=.{1,253}$)(?!-)(?:[a-z0-9-]{1,63}\.)+[a-z]{2,63}$/.test(host)) throw new InputError('Relay host must be a valid DNS hostname.');
  const port = Number(relay?.port ?? (mode === 'relay-587' ? 587 : 2525));
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new InputError('Relay port is invalid.');
  const username = typeof relay?.username === 'string' ? relay.username.trim() : '';
  if (!username || username.length > 254) throw new InputError('Relay username is required.');
  const password = relay?.password;
  if (typeof password !== 'string' || !password || password.length > 512 || /[\r\n\0]/.test(password)) throw new InputError('Relay password is invalid.');
  return { mode, relay: { host, port, username, password } };
}

export function dkimSelector(now = new Date()) {
  return `portal${now.getFullYear()}`;
}

/**
 * RSA 2048 for broadest receiver compatibility (design doc decision #5).
 * The DNS value uses the base64 SPKI DER; the PEM private key is returned
 * once for encrypted storage and host provisioning — never for the browser.
 */
export function generateDkimKeyPair(selector = dkimSelector()) {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    selector,
    publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' })
  };
}

export function spfValue({ mode, hostname, relayHost }) {
  if (mode === 'direct' || !mode) return `v=spf1 mx a:${hostname} ~all`;
  const preset = RELAY_SPF_INCLUDES.find((entry) => String(relayHost ?? '').includes(entry.match));
  // Unknown relays get an include of the relay's root domain as a starting
  // point; the UI tells the owner to confirm the exact value with the provider.
  const include = preset?.include ?? `include:${rootDomain(relayHost)}`;
  return `v=spf1 ${include} ~all`;
}

export function spfExpectedToken({ mode, hostname, relayHost }) {
  if (mode === 'direct' || !mode) return `a:${hostname}`;
  const preset = RELAY_SPF_INCLUDES.find((entry) => String(relayHost ?? '').includes(entry.match));
  return preset?.include ?? `include:${rootDomain(relayHost)}`;
}

export function mailDnsRecords({ hostname, domain, mode, relayHost, selector, publicKey }) {
  const providerRecord = ({ type, name, value, host, priority = null }) => ({
    name,
    type,
    value,
    provider: { type, host, value: type === 'MX' ? hostname : value, priority, ttl: 'Auto' }
  });
  return {
    mx: providerRecord({ name: domain, type: 'MX', value: `${domain}.  MX  10  ${hostname}.`, host: '@', priority: 10 }),
    spf: providerRecord({ name: domain, type: 'TXT', value: spfValue({ mode, hostname, relayHost }), host: '@' }),
    dkim: providerRecord({ name: `${selector}._domainkey.${domain}`, type: 'TXT', value: `v=DKIM1; k=rsa; p=${publicKey}`, host: `${selector}._domainkey` }),
    dmarc: providerRecord({ name: `_dmarc.${domain}`, type: 'TXT', value: `v=DMARC1; p=none; rua=mailto:postmaster@${domain}; fo=1`, host: '_dmarc' })
  };
}

export function suggestMailDefaults(projects = []) {
  const counts = new Map();
  for (const project of projects) {
    for (const host of project?.domains?.hosts ?? []) {
      const root = rootDomain(host);
      if (root) counts.set(root, (counts.get(root) ?? 0) + 1);
    }
  }
  const ranked = [...counts.entries()].sort((left, right) => right[1] - left[1]).map(([root]) => root);
  return {
    hostname: ranked.length ? `mail.${ranked[0]}` : null,
    domains: ranked
  };
}

// Coarse eTLD+1: keep the last two labels. Good enough for suggestion
// defaults; the owner can always type the exact domain.
function rootDomain(host) {
  const labels = String(host ?? '').toLowerCase().split('.').filter(Boolean);
  return labels.length >= 2 ? labels.slice(-2).join('.') : (labels[0] ?? '');
}

/**
 * Minimal SMTP submission client for the wizard's outbound test: EHLO →
 * STARTTLS (when offered) → AUTH PLAIN (when credentials given) → one
 * message. Returns the final server reply so the UI can show the real
 * "250 OK". Not a general-purpose MTA — one recipient, short deadline.
 */
export async function smtpSubmit({ host, port, tlsServername, username, password, from, to, subject, body, timeoutMs = SMTP_TIMEOUT_MS, connect = net.connect, upgradeTls = defaultUpgradeTls }) {
  const { raw } = composeMessage({ from: { address: String(from ?? '') }, to: [String(to ?? '')], subject, text: body });
  return smtpDeliver({ host, port, tlsServername, username, password, from, recipients: [to], message: raw, timeoutMs, connect, upgradeTls });
}

/**
 * Hand one finished RFC 5322 message to an SMTP server for every recipient.
 * The mailbox reader uses it against the host's own Postfix on loopback, which
 * signs (DKIM), queues and relays; a refused recipient stops the whole send
 * before any data is transferred.
 */
export async function smtpDeliver({ host, port, tlsServername = host, username, password, from, recipients, message, timeoutMs = SMTP_TIMEOUT_MS, connect = net.connect, upgradeTls = defaultUpgradeTls }) {
  const addresses = [...new Set(recipients ?? [])];
  if (!addresses.length) throw new InputError('At least one recipient is required.');
  if ([from, ...addresses].some((address) => typeof address !== 'string' || /[\s<>]/.test(address))) throw new InputError('SMTP address is invalid.');
  const session = await openSmtpSession({ host, port, timeoutMs, connect });
  try {
    let features = await session.command(`EHLO ${clientName(from)}`, 250);
    if (/^250[- ]STARTTLS$/im.test(features)) {
      await session.command('STARTTLS', 220);
      await session.upgrade(upgradeTls, tlsServername);
      features = await session.command(`EHLO ${clientName(from)}`, 250);
    }
    if (username) {
      const token = Buffer.from(`\0${username}\0${password}`, 'utf8').toString('base64');
      await session.command(`AUTH PLAIN ${token}`, 235);
    }
    await session.command(`MAIL FROM:<${from}>`, 250);
    for (const address of addresses) await session.command(`RCPT TO:<${address}>`, [250, 251]);
    await session.command('DATA', 354);
    // Lines end in CRLF on the wire and a leading dot is doubled (RFC 5321 4.5.2).
    const data = (Buffer.isBuffer(message) ? message.toString('latin1') : Buffer.from(String(message ?? ''), 'utf8').toString('latin1'))
      .replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..').replace(/(?:\r\n)?$/, '\r\n.');
    const reply = await session.command(data, 250, 'latin1');
    await session.command('QUIT', 221).catch(() => {});
    return { ok: true, reply: reply.split(/\r?\n/)[0].slice(0, 200) };
  } finally {
    session.close();
  }
}

function clientName(from) {
  const domain = String(from ?? '').split('@')[1];
  return domain || 'dashboard-portal.local';
}

function defaultUpgradeTls(socket, host) {
  return new Promise((resolve, reject) => {
    const secured = tls.connect({ socket, servername: host });
    secured.once('secureConnect', () => resolve(secured));
    secured.once('error', reject);
  });
}

function openSmtpSession({ host, port, timeoutMs, connect }) {
  return new Promise((resolve, reject) => {
    let socket = connect({ host, port });
    let buffer = '';
    let pending = null;
    let settledOpen = false;
    const deadline = setTimeout(() => fail(new InputError('SMTP connection timed out.')), timeoutMs);
    const fail = (error) => {
      clearTimeout(deadline);
      socket.destroy();
      if (!settledOpen) { settledOpen = true; reject(error); }
      else pending?.reject(error);
      pending = null;
    };
    const onData = (chunk) => {
      buffer += chunk;
      // A reply is complete when its last line uses "NNN " (space separator).
      const lines = buffer.split(/\r?\n/).filter(Boolean);
      const last = lines[lines.length - 1];
      if (!last || !/^\d{3} /.test(last)) return;
      const reply = buffer;
      buffer = '';
      const code = Number(last.slice(0, 3));
      const waiter = pending;
      pending = null;
      if (!settledOpen) {
        settledOpen = true;
        if (code === 220) resolve(session);
        else fail(new InputError(`SMTP server rejected the connection: ${last.slice(0, 120)}`));
        return;
      }
      if (!waiter) return;
      if (waiter.accept.includes(code)) waiter.resolve(reply);
      else waiter.reject(new InputError(`SMTP command failed: ${last.slice(0, 160)}`));
    };
    const attach = () => {
      socket.setEncoding('utf8');
      socket.on('data', onData);
      // A persistent handler: late errors after the session settles (for
      // example a reset while tearing down) must never become uncaught.
      socket.on('error', (error) => { if (pending || !settledOpen) fail(new InputError(`SMTP connection failed: ${String(error?.message ?? error).slice(0, 120)}`)); });
      socket.once('close', () => { if (pending) fail(new InputError('SMTP connection closed unexpectedly.')); });
    };
    const session = {
      command(text, accept, encoding = 'utf8') {
        return new Promise((resolveCommand, rejectCommand) => {
          pending = { resolve: resolveCommand, reject: rejectCommand, accept: Array.isArray(accept) ? accept : [accept] };
          socket.write(`${text}\r\n`, encoding);
        });
      },
      async upgrade(upgradeTls, servername) {
        socket.removeAllListeners('data');
        socket.removeAllListeners('close');
        buffer = '';
        socket = await upgradeTls(socket, servername);
        attach();
      },
      close() {
        clearTimeout(deadline);
        socket.destroy();
      }
    };
    attach();
  });
}
