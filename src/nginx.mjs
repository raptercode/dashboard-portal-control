import { createHash } from 'node:crypto';
import { InputError, validateDomain } from './core.mjs';

export function validateNginxSite(input) {
  const hostname = validateDomain({ hostname: input.hostname });
  const projectSlug = String(input.projectSlug ?? '').trim();
  const upstreamPort = Number(input.upstreamPort);
  if (!/^[a-z][a-z0-9-]{0,62}$/.test(projectSlug)) throw new InputError('Project slug is invalid.');
  if (!Number.isInteger(upstreamPort) || upstreamPort < 1024 || upstreamPort > 65535) throw new InputError('Upstream port must be between 1024 and 65535.');
  return { hostname, projectSlug, upstreamPort };
}

export function managedFilename(hostname) {
  return `${validateDomain({ hostname })}.conf`;
}

export function renderNginxSite(input) {
  const site = validateNginxSite(input);
  return `# Managed by Modern Host Manager. Manual edits are detected as drift.\n# Project: ${site.projectSlug}\nserver {\n    listen 80;\n    listen [::]:80;\n    server_name ${site.hostname};\n\n    location / {\n        proxy_pass http://127.0.0.1:${site.upstreamPort};\n        proxy_http_version 1.1;\n        proxy_set_header Host $host;\n        proxy_set_header X-Real-IP $remote_addr;\n        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n        proxy_set_header X-Forwarded-Proto $scheme;\n    }\n}\n`;
}

export function contentHash(content) {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

export function checkDrift(expectedContent, actualContent) {
  const expectedHash = contentHash(expectedContent);
  const actualHash = actualContent === null ? null : contentHash(actualContent);
  return { drifted: expectedHash !== actualHash, expectedHash, actualHash };
}
