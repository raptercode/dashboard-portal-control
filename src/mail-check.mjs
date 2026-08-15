import net from 'node:net';

export const SMTP_CHECK_PORTS = Object.freeze([25, 587, 2525]);

// Two independent providers per port keep a single provider outage from
// reading as a blocked port. Port 25 targets are public MX hosts; 587/2525
// targets are submission endpoints that greet before authentication.
const DEFAULT_TARGETS = Object.freeze({
  25: Object.freeze(['aspmx.l.google.com', 'microsoft-com.mail.protection.outlook.com']),
  587: Object.freeze(['smtp.gmail.com', 'smtp.office365.com']),
  2525: Object.freeze(['mail.smtp2go.com', 'smtp.mailgun.org'])
});

/**
 * Probe one SMTP endpoint. "open" requires reading the 220 greeting, because
 * hosting providers commonly allow the TCP connect but filter the protocol;
 * a connect-only check would report those ports as usable when they are not.
 */
export function probeSmtpTarget(host, port, timeoutMs = 5_000, connect = net.connect) {
  return new Promise((resolve) => {
    const started = Date.now();
    let socket;
    let connected = false;
    let banner = '';
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket?.destroy();
      resolve({ host, port, latencyMs: Date.now() - started, ...result });
    };
    const timer = setTimeout(() => finish({ status: connected ? 'filtered' : 'blocked', detail: connected ? 'Connected, but no SMTP greeting arrived (protocol is filtered).' : 'Connection timed out.' }), timeoutMs);
    try {
      socket = connect({ host, port });
    } catch {
      return finish({ status: 'blocked', detail: 'Connection could not be created.' });
    }
    socket.once('connect', () => { connected = true; });
    socket.on('data', (chunk) => {
      banner += chunk;
      if (banner.length > 512) return finish({ status: 'filtered', detail: 'Endpoint replied without an SMTP greeting.' });
      const line = banner.split(/\r?\n/, 1)[0];
      if (/^220[ -]/.test(line)) return finish({ status: 'open', banner: line.slice(0, 120) });
      if (banner.includes('\n')) return finish({ status: 'filtered', detail: 'Endpoint replied without an SMTP greeting.' });
    });
    socket.once('error', () => finish({ status: connected ? 'filtered' : 'blocked', detail: connected ? 'Connection dropped before the SMTP greeting.' : 'Connection was refused or unreachable.' }));
  });
}

export async function checkSmtpOutbound(options = {}) {
  const ports = options.ports ?? SMTP_CHECK_PORTS;
  const targets = options.targets ?? DEFAULT_TARGETS;
  const timeoutMs = options.timeoutMs ?? 5_000;
  const probe = options.probe ?? probeSmtpTarget;
  const results = await Promise.all(ports.map(async (port) => {
    const attempts = [];
    for (const host of targets[port] ?? []) {
      const attempt = await probe(host, port, timeoutMs);
      attempts.push(attempt);
      if (attempt.status === 'open') break;
    }
    const best = attempts.find((item) => item.status === 'open')
      ?? attempts.find((item) => item.status === 'filtered')
      ?? attempts[attempts.length - 1]
      ?? { status: 'blocked', detail: 'No probe target is configured for this port.' };
    return { port, status: best.status, target: best.host ?? null, latencyMs: best.latencyMs ?? null, detail: best.detail ?? null, attempts };
  }));
  return { checkedAt: new Date().toISOString(), ports: results, recommendation: recommendOutboundPlan(results) };
}

/**
 * Maps per-port reachability to the sending strategy an owner should use.
 * Anything other than "open" counts as unusable: a filtered port drops mail
 * mid-session, which is worse than an outright refusal.
 */
export function recommendOutboundPlan(results) {
  const open = new Set(results.filter((item) => item.status === 'open').map((item) => item.port));
  if (open.has(25)) {
    return {
      mode: 'direct',
      usablePorts: [...open],
      summary: 'Port 25 is open: this host can run a full mail server with direct MX delivery.',
      requirements: ['Reverse DNS (PTR) matching the mail hostname', 'SPF record', 'DKIM signing', 'DMARC policy']
    };
  }
  if (open.has(587)) {
    return {
      mode: 'relay-587',
      usablePorts: [...open],
      summary: 'Port 25 is blocked. Route outbound mail through an authenticated relay (smarthost) on port 587.',
      requirements: ['Relay account with SMTP AUTH over STARTTLS', 'SPF record that includes the relay', 'DKIM keys from the relay provider']
    };
  }
  if (open.has(2525)) {
    return {
      mode: 'relay-2525',
      usablePorts: [...open],
      summary: 'Only port 2525 is open. Use a relay provider that accepts submission on 2525 (SMTP2GO, Mailgun, SendGrid).',
      requirements: ['Relay account with SMTP AUTH', 'Configure the MTA smarthost as [relay-host]:2525', 'SPF/DKIM records from the relay provider']
    };
  }
  return {
    mode: 'api-only',
    usablePorts: [],
    summary: 'All outbound SMTP ports are blocked. Send through an HTTPS email API instead, or ask the network provider to unblock a port.',
    requirements: ['HTTPS (443) egress', 'An email API provider account']
  };
}
