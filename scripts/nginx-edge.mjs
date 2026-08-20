import http from 'node:http';
import https from 'node:https';

export const NGINX_DEFAULT_RE = /welcome to nginx!?/i;

export function renderUnmatchedNginx() {
  return `# Managed by Dashboard Portal. Do not edit.\nserver {\n    listen 80 default_server;\n    listen [::]:80 default_server;\n    server_name _;\n    return 404;\n}\n\nserver {\n    listen 443 ssl default_server;\n    listen [::]:443 ssl default_server;\n    server_name _;\n    ssl_reject_handshake on;\n}\n`;
}

export function classifyHttpBody(body) {
  const text = String(body ?? '');
  if (NGINX_DEFAULT_RE.test(text)) return 'nginx-default';
  if (!text.trim()) return 'empty';
  return 'app';
}

export function splitNginxDump(dump) {
  const files = [];
  let current = null;
  for (const line of String(dump ?? '').split(/\r?\n/)) {
    const marker = line.match(/^# configuration file (.+):$/);
    if (marker) {
      current = { path: marker[1], body: '' };
      files.push(current);
      continue;
    }
    if (current) current.body += `${line}\n`;
  }
  return files;
}

export function summarizeManagedNginx(dump, { sitePath, enabledPath, hosts, port }) {
  const files = splitNginxDump(dump);
  const managed = files.filter((file) => file.path === sitePath || file.path === enabledPath);
  const others = files.filter((file) => file.path !== sitePath && file.path !== enabledPath);
  const proxyNeedle = `http://127.0.0.1:${port}`;
  const named = (body) => hosts.every((host) => body.includes(host));
  const loaded = managed.some((file) => named(file.body));
  const hasTlsProxy = managed.some((file) => named(file.body) && /listen\s+(?:\[::\]:)?443/.test(file.body) && file.body.includes(proxyNeedle));
  const claimedByOther = hosts.some((host) => others.some((file) => new RegExp(`server_name\\s+[^;]*\\b${escapeRegex(host)}\\b`).test(file.body)));
  const defaultServerPresent = others.some((file) => /listen\s+(?:\[::\]:)?80\s+default_server/.test(file.body));
  return { loaded, hasTlsProxy, claimedByOther, defaultServerPresent };
}

export function publicEdgeResult(input) {
  const checks = Array.isArray(input?.checks)
    ? input.checks.slice(0, 12).map((item) => ({
      id: String(item?.id ?? '').slice(0, 32),
      ok: item?.ok === true,
      detail: String(item?.detail ?? '').slice(0, 240)
    })).filter((item) => item.id)
    : [];
  const status = ['ok', 'default-site', 'not-loaded', 'upstream-down', 'unavailable', 'error'].includes(input?.status)
    ? input.status
    : 'error';
  return {
    passed: input?.passed === true,
    status,
    hostname: typeof input?.hostname === 'string' ? input.hostname.slice(0, 253) : null,
    checks
  };
}

export async function probeLoopbackHttp(hostname, options = {}) {
  if (options.fetchImpl) {
    try {
      const response = await options.fetchImpl(options.url ?? 'http://127.0.0.1/', {
        headers: { host: hostname, accept: 'text/html,application/json,*/*' },
        redirect: 'manual',
        signal: AbortSignal.timeout(options.timeoutMs ?? 2000)
      });
      const body = await response.text().catch(() => '');
      const location = response.headers.get('location');
      return {
        status: response.status,
        location: location && location.length <= 200 ? location : null,
        kind: classifyHttpBody(body)
      };
    } catch {
      return { status: 0, location: null, kind: 'unreachable' };
    }
  }
  const url = new URL(options.url ?? 'http://127.0.0.1/');
  const transport = url.protocol === 'https:' ? https : http;
  const timeoutMs = options.timeoutMs ?? 2000;
  return new Promise((resolve) => {
    const req = transport.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      headers: { host: hostname, accept: 'text/html,application/json,*/*' },
      timeout: timeoutMs,
      rejectUnauthorized: false
    }, (response) => {
      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        if (size >= 4000) return;
        chunks.push(chunk);
        size += chunk.length;
      });
      response.on('end', () => {
        const location = response.headers.location;
        resolve({
          status: response.statusCode ?? 0,
          location: location && location.length <= 200 ? location : null,
          kind: classifyHttpBody(Buffer.concat(chunks).toString('utf8'))
        });
      });
    });
    req.on('error', () => resolve({ status: 0, location: null, kind: 'unreachable' }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ status: 0, location: null, kind: 'unreachable' });
    });
    req.end();
  });
}

export function buildEdgeEvaluation({ siteExists, enabled, nginx, hosts, port, httpProbe, upstreamProbe, sitePath, enabledPath }) {
  const hostname = hosts[0] ?? null;
  const nginxSummary = summarizeManagedNginx(nginx, { sitePath, enabledPath, hosts, port });
  const checks = [
    check('site', siteExists, siteExists ? 'พบไฟล์ Nginx ของโปรเจค' : 'ยังไม่มีไฟล์ Nginx ของโปรเจค — release ยังไม่ได้ sync โดเมน'),
    check('enabled', enabled, enabled ? 'site ถูก enable แล้ว' : 'ไฟล์ยังไม่ถูก enable ใน sites-enabled'),
    check('loaded', nginxSummary.loaded, nginxSummary.loaded ? 'Nginx โหลด server_name ของโดเมนนี้แล้ว' : 'Nginx ยังไม่โหลด server_name นี้ หลัง reload'),
    check('conflict', !nginxSummary.claimedByOther, nginxSummary.claimedByOther ? 'โดเมนนี้ถูก server_name ของไฟล์ Nginx อื่นจับอยู่' : 'ไม่มี vhost ภายนอกเคลมโดเมนนี้'),
    check('tls', nginxSummary.hasTlsProxy, nginxSummary.hasTlsProxy ? `TLS proxy ชี้ 127.0.0.1:${port}` : 'ยังไม่มี TLS server ที่ proxy ไปพอร์ตโปรเจค'),
    check('upstream', upstreamOk(upstreamProbe), upstreamDetail(upstreamProbe, port)),
    check('http', httpOk(httpProbe, hostname), httpDetail(httpProbe, hostname, nginxSummary.defaultServerPresent))
  ];
  const defaultSite = httpProbe?.kind === 'nginx-default';
  const status = !siteExists || !enabled || !nginxSummary.loaded
    ? 'not-loaded'
    : !upstreamOk(upstreamProbe)
      ? 'upstream-down'
      : defaultSite
        ? 'default-site'
        : checks.every((item) => item.ok)
          ? 'ok'
          : 'error';
  return { passed: status === 'ok', status, hostname, checks };
}

function check(id, ok, detail) {
  return { id, ok: Boolean(ok), detail };
}

function upstreamOk(probe) {
  return Number(probe?.status) >= 200 && Number(probe?.status) < 400 && probe?.kind !== 'nginx-default';
}

function upstreamDetail(probe, port) {
  if (!probe || probe.kind === 'unreachable') return `แอปไม่ตอบที่ 127.0.0.1:${port}`;
  if (probe.kind === 'nginx-default') return 'พอร์ตโปรเจคตอบหน้า Nginx default — proxy ชี้ผิดที่';
  if (upstreamOk(probe)) return `แอปตอบ ${probe.status} ที่พอร์ตโปรเจค`;
  return `แอปตอบ ${probe.status} ที่พอร์ตโปรเจค`;
}

function httpOk(probe, hostname) {
  if (!probe || probe.kind === 'unreachable') return false;
  if (probe.kind === 'nginx-default') return false;
  if (probe.status === 308 || probe.status === 301 || probe.status === 302) {
    return typeof probe.location === 'string' && hostname && probe.location.includes(hostname);
  }
  return probe.status >= 200 && probe.status < 400;
}

function httpDetail(probe, hostname, defaultServerPresent) {
  if (!probe || probe.kind === 'unreachable') return 'ต่อ port 80 บนเครื่องนี้ไม่ได้';
  if (probe.kind === 'nginx-default') {
    return defaultServerPresent
      ? 'Host นี้ยังเข้า default site ของ Ubuntu อยู่ — vhost โปรเจคยังไม่ชนะ default_server'
      : 'Port 80 ยังคืนหน้า Welcome to nginx สำหรับ Host นี้';
  }
  if (probe.status === 308 || probe.status === 301 || probe.status === 302) {
    return probe.location?.includes(hostname)
      ? `HTTP เด้งไป HTTPS แล้ว (${probe.status})`
      : `HTTP redirect ไปที่ ${probe.location || 'unknown'}`;
  }
  return `HTTP ตอบ ${probe.status}`;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
