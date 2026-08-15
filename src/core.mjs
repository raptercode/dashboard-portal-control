import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

export const SUPPORTED_NODE_MAJOR = 24;
export const TOOLS = {
  nginx: { label: 'Nginx', package: 'nginx', required: true, purpose: 'Reverse proxy และรับ traffic จาก domain' },
  certbot: { label: 'Certbot', package: 'certbot', required: true, purpose: 'ออกและต่ออายุ Let’s Encrypt certificate' },
  git: { label: 'Git', package: 'git', required: true, purpose: 'Clone และ pull source code' },
  docker: { label: 'Docker Engine + Compose', package: 'docker.io docker-compose-v2', required: false, purpose: 'ใช้งาน Docker mode' },
  mail: { label: 'Mail server (Postfix + Dovecot)', package: 'postfix dovecot-imapd dovecot-lmtpd opendkim opendkim-tools', required: false, purpose: 'รับ/ส่งอีเมลด้วยโดเมนของคุณเอง — ตั้งค่าผ่าน Mail Setup Wizard' }
};

export function initialMailState() {
  return {
    hostname: null,
    outboundMode: null,
    relay: null,
    configure: null,
    ptr: { status: 'pending', checkedAt: null, detail: null },
    domains: [],
    mailboxes: [],
    lastTest: null
  };
}

export function createInitialState() {
  return {
    schemaVersion: 3,
    createdAt: new Date().toISOString(),
    tools: Object.fromEntries(Object.entries(TOOLS).map(([id, tool]) => [id, {
      id,
      status: id === 'docker' ? 'Installed' : 'Missing',
      version: id === 'docker' ? 'Docker sandbox' : null,
      simulated: true,
      updatedAt: new Date().toISOString(),
      ...tool
    }])),
    git: { identity: null },
    sessions: [],
    credentials: [],
    projects: [],
    audit: [],
    jobs: [],
    monitorTokens: [],
    owner: null,
    databaseConnections: [],
    notificationHooks: [],
    mail: initialMailState()
  };
}

export class StateStore {
  #path;
  #database;
  #state;
  #queue = Promise.resolve();
  // Serialized rows from the last successful persist, keyed per table. Null
  // until the first persist of this process, which rewrites every table and
  // seeds the cache; later persists diff against it and only touch changed rows.
  #persisted = null;

  constructor(path) {
    this.#path = path;
  }

  async load() {
    await mkdir(dirname(this.#path), { recursive: true, mode: 0o700 });
    this.#database = new DatabaseSync(this.#path);
    this.#database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS portal_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS tools (id TEXT PRIMARY KEY, payload TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS sessions (id_hash TEXT PRIMARY KEY, payload TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS credentials (id TEXT PRIMARY KEY, payload TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS projects (slug TEXT PRIMARY KEY, payload TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS audit_events (id TEXT PRIMARY KEY, occurred_at TEXT NOT NULL, payload TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, project_slug TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT, payload TEXT NOT NULL) STRICT;
      CREATE INDEX IF NOT EXISTS jobs_by_status ON jobs(status, created_at);
      CREATE TABLE IF NOT EXISTS metric_samples (
        at INTEGER PRIMARY KEY,
        cpu REAL NOT NULL,
        memory_used INTEGER NOT NULL,
        memory_total INTEGER NOT NULL,
        disk_used INTEGER NOT NULL,
        disk_total INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS database_connections (id TEXT PRIMARY KEY, payload TEXT NOT NULL) STRICT;
    `);
    const initialized = this.#database.prepare('SELECT value FROM portal_meta WHERE key = ?').get('initialized');
    if (!initialized) this.#persist(createInitialState());
    this.#state = migrateState(this.#readState());
    return this.snapshot();
  }

  snapshot() {
    return structuredClone(this.#state);
  }

  async update(mutator) {
    const work = async () => {
      const next = structuredClone(this.#state);
      const result = await mutator(next);
      this.#state = next;
      await this.#persist(next);
      return result;
    };
    this.#queue = this.#queue.then(work, work);
    return this.#queue;
  }

  recordMetricSample(sample) {
    const at = Math.trunc(sample.at);
    this.#database.prepare(`
      INSERT OR REPLACE INTO metric_samples (at, cpu, memory_used, memory_total, disk_used, disk_total)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(at, sample.cpuPercent, sample.memoryUsedBytes, sample.memoryTotalBytes, sample.diskUsedBytes, sample.diskTotalBytes);
  }

  pruneMetricSamples(beforeMs) {
    this.#database.prepare('DELETE FROM metric_samples WHERE at < ?').run(Math.trunc(beforeMs));
  }

  listMetricSamples(sinceMs) {
    return this.#database.prepare(`
      SELECT at, cpu AS cpuPercent, memory_used AS memoryUsedBytes, memory_total AS memoryTotalBytes,
             disk_used AS diskUsedBytes, disk_total AS diskTotalBytes
      FROM metric_samples
      WHERE at >= ?
      ORDER BY at ASC
    `).all(Math.trunc(sinceMs));
  }

  async #persist(state) {
    const database = this.#database;
    const sections = persistedSections(state);
    const previous = this.#persisted;
    const next = new Map(sections.map((section) => [section.table, new Map(section.rows.map((row) => [row.key, row.payload]))]));
    database.exec('BEGIN IMMEDIATE');
    try {
      for (const section of sections) {
        const before = previous?.get(section.table);
        if (!before && section.sweep) database.prepare(`DELETE FROM ${section.table}`).run();
        const upsert = database.prepare(section.upsertSql);
        for (const row of section.rows) {
          if (before && before.get(row.key) === row.payload) continue;
          upsert.run(...row.params);
        }
        if (before && section.sweep) {
          const current = next.get(section.table);
          const remove = database.prepare(`DELETE FROM ${section.table} WHERE ${section.keyColumn} = ?`);
          for (const key of before.keys()) if (!current.has(key)) remove.run(key);
        }
      }
      database.exec('COMMIT');
      this.#persisted = next;
    } catch (error) {
      // ROLLBACK restores the pre-transaction rows, which is exactly what the
      // untouched #persisted cache still describes.
      database.exec('ROLLBACK');
      throw error;
    }
  }

  #readState() {
    const database = this.#database;
    const readPayloads = (query) => database.prepare(query).all().map((row) => JSON.parse(row.payload));
    const meta = (key, fallback) => database.prepare('SELECT value FROM portal_meta WHERE key = ?').get(key)?.value ?? fallback;
    return {
      schemaVersion: Number(meta('schema_version', '2')),
      createdAt: meta('created_at', new Date().toISOString()),
      tools: Object.fromEntries(database.prepare('SELECT id, payload FROM tools').all().map((row) => [row.id, JSON.parse(row.payload)])),
      git: JSON.parse(meta('git', '{"identity":null}')),
      sessions: readPayloads('SELECT payload FROM sessions'),
      credentials: readPayloads('SELECT payload FROM credentials'),
      projects: readPayloads('SELECT payload FROM projects'),
      audit: readPayloads('SELECT payload FROM audit_events ORDER BY occurred_at DESC'),
      jobs: readPayloads('SELECT payload FROM jobs ORDER BY created_at ASC'),
      monitorTokens: JSON.parse(meta('monitor_tokens', '[]')),
      notificationHooks: JSON.parse(meta('notification_hooks', '[]')),
      mail: JSON.parse(meta('mail', 'null')),
      owner: JSON.parse(meta('owner', 'null')),
      databaseConnections: readPayloads('SELECT payload FROM database_connections')
    };
  }
}

function persistedSections(state) {
  const row = (key, value, extra = []) => {
    const payload = JSON.stringify(value);
    return { key, payload, params: [key, ...extra, payload] };
  };
  const metaRow = (key, value) => ({ key, payload: value, params: [key, value] });
  return [
    { table: 'tools', keyColumn: 'id', sweep: true, upsertSql: 'INSERT OR REPLACE INTO tools (id, payload) VALUES (?, ?)', rows: Object.entries(state.tools).map(([id, tool]) => row(id, tool)) },
    { table: 'sessions', keyColumn: 'id_hash', sweep: true, upsertSql: 'INSERT OR REPLACE INTO sessions (id_hash, payload) VALUES (?, ?)', rows: (state.sessions ?? []).map((session) => row(session.idHash, session)) },
    { table: 'credentials', keyColumn: 'id', sweep: true, upsertSql: 'INSERT OR REPLACE INTO credentials (id, payload) VALUES (?, ?)', rows: (state.credentials ?? []).map((credential) => row(credential.id, credential)) },
    { table: 'projects', keyColumn: 'slug', sweep: true, upsertSql: 'INSERT OR REPLACE INTO projects (slug, payload) VALUES (?, ?)', rows: (state.projects ?? []).map((project) => row(project.slug, project)) },
    { table: 'audit_events', keyColumn: 'id', sweep: true, upsertSql: 'INSERT OR REPLACE INTO audit_events (id, occurred_at, payload) VALUES (?, ?, ?)', rows: (state.audit ?? []).map((event) => row(event.id, event, [event.at])) },
    { table: 'jobs', keyColumn: 'id', sweep: true, upsertSql: 'INSERT OR REPLACE INTO jobs (id, project_slug, status, created_at, started_at, finished_at, payload) VALUES (?, ?, ?, ?, ?, ?, ?)', rows: (state.jobs ?? []).map((job) => row(job.id, job, [job.projectSlug, job.status, job.createdAt, job.startedAt ?? null, job.finishedAt ?? null])) },
    { table: 'database_connections', keyColumn: 'id', sweep: true, upsertSql: 'INSERT OR REPLACE INTO database_connections (id, payload) VALUES (?, ?)', rows: (state.databaseConnections ?? []).map((connection) => row(connection.id, connection)) },
    // portal_meta is never swept: unknown keys written by other tooling (for
    // example the demo password reset script) must survive a portal persist.
    { table: 'portal_meta', keyColumn: 'key', sweep: false, upsertSql: 'INSERT OR REPLACE INTO portal_meta (key, value) VALUES (?, ?)', rows: [
      metaRow('initialized', 'true'),
      metaRow('schema_version', String(state.schemaVersion ?? 2)),
      metaRow('created_at', state.createdAt ?? new Date().toISOString()),
      metaRow('git', JSON.stringify(state.git ?? { identity: null })),
      metaRow('owner', JSON.stringify(state.owner ?? null)),
      metaRow('monitor_tokens', JSON.stringify(state.monitorTokens ?? [])),
      metaRow('notification_hooks', JSON.stringify(state.notificationHooks ?? [])),
      metaRow('mail', JSON.stringify(state.mail ?? initialMailState()))
    ] }
  ];
}

export function validateTool(tool) {
  if (!Object.hasOwn(TOOLS, tool)) throw new InputError('Unsupported tool.');
  return tool;
}

export function validateProject(input) {
  const project = {
    name: requiredText(input.name, 'Project name', 80),
    organization: optionalText(input.organization, 80) || 'Default',
    slug: requiredText(input.slug, 'Project slug', 63),
    repository: requiredText(input.repository, 'Repository URL', 500),
    branch: optionalText(input.branch, 100) || 'main',
    directory: validateRepositoryDirectory(input.directory),
    // A project sync may omit the port and let the Portal reserve a unique
    // host port. Deployment validation still requires the resolved integer.
    port: input.port === undefined || input.port === null || input.port === '' ? null : Number(input.port),
    // Existing projects predate this option, so an omitted value must keep the
    // safe historical behavior of requiring a candidate and host health check.
    healthCheckEnabled: input.healthCheckEnabled === undefined ? true : input.healthCheckEnabled === true,
    healthCheckPath: optionalText(input.healthCheckPath, 200) || '/'
  };
  if (!/^[a-z][a-z0-9-]{0,62}$/.test(project.slug)) throw new InputError('Project slug must use lowercase letters, digits, and hyphens.');
  if (!isRepositoryUrl(project.repository)) throw new InputError('Repository URL must be HTTPS or SSH Git syntax.');
  if (!/^[A-Za-z0-9._/-]{1,100}$/.test(project.branch) || project.branch.startsWith('-')) throw new InputError('Branch name is invalid.');
  if (project.port !== null && (!Number.isInteger(project.port) || project.port < 1024 || project.port > 65535)) throw new InputError('Port must be between 1024 and 65535.');
  if (!/^\/(?!\/)[^\s]*$/.test(project.healthCheckPath)) throw new InputError('Health-check path must start with one slash.');
  return project;
}

export function validateGitIdentity(input) {
  const name = requiredText(input.name, 'Git display name', 100);
  const email = requiredText(input.email, 'Git email', 254);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new InputError('Git email is invalid.');
  return { name, email };
}

export function validateProjectSync(input) {
  const project = validateProject(input);
  const protocol = input.protocol;
  if (!['https', 'ssh'].includes(protocol)) throw new InputError('Select HTTPS or SSH.');
  if (protocol === 'https' && !project.repository.startsWith('https://')) throw new InputError('HTTPS projects require an HTTPS repository URL.');
  if (protocol === 'ssh' && !project.repository.startsWith('git@')) throw new InputError('SSH projects require Git SSH URL syntax.');
  const credentialId = optionalText(input.credentialId, 64);
  if (protocol === 'https' && credentialId && !/^[a-f0-9-]{36}$/i.test(credentialId)) throw new InputError('Credential selection is invalid.');
  const runtime = input.runtime === undefined ? 'node' : input.runtime;
  if (!['node', 'bun', 'docker-compose'].includes(runtime)) throw new InputError('Project runtime is invalid.');
  const buildScript = ['node', 'bun'].includes(runtime) ? optionalPackageScript(input.buildScript, 'Build script') : null;
  const startScript = ['node', 'bun'].includes(runtime) ? optionalPackageScript(input.startScript, 'Start script') : null;
  const composeFile = runtime === 'docker-compose' ? validateComposeFile(input.composeFile) : null;
  const composeService = runtime === 'docker-compose' ? requiredText(input.composeService, 'Docker Compose service', 80) : null;
  if (composeService && !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/.test(composeService)) throw new InputError('Docker Compose service is invalid.');
  const domains = input.domains === undefined ? undefined : validateProjectDomains(input.domains);
  return {
    ...project,
    protocol,
    credentialId: protocol === 'https' ? credentialId || null : null,
    sshKeyId: protocol === 'ssh' ? `deploy-key-${project.slug}` : null,
    runtime,
    ...(runtime === 'docker-compose' ? { composeFile, composeService } : {}),
    ...(buildScript !== undefined ? { buildScript } : {}),
    ...(startScript !== undefined ? { startScript } : {}),
    ...(domains !== undefined ? { domains: { hosts: domains, updatedAt: new Date().toISOString(), syncedAt: null } } : {})
  };
}

export function validateGitBranchRequest(input) {
  const repository = requiredText(input.repository, 'Repository URL', 500);
  const protocol = input.protocol;
  if (!['https', 'ssh'].includes(protocol)) throw new InputError('Select HTTPS or SSH.');
  if (protocol === 'https' && !repository.startsWith('https://')) throw new InputError('HTTPS projects require an HTTPS repository URL.');
  if (protocol === 'ssh' && !repository.startsWith('git@')) throw new InputError('SSH projects require Git SSH URL syntax.');
  if (!isRepositoryUrl(repository)) throw new InputError('Repository URL must be HTTPS or SSH Git syntax.');
  const credentialId = optionalText(input.credentialId, 64);
  if (protocol === 'https' && credentialId && !/^[a-f0-9-]{36}$/i.test(credentialId)) throw new InputError('Credential selection is invalid.');
  return { repository, protocol, credentialId: protocol === 'https' ? credentialId || null : null };
}

export function validateRepositoryDirectory(value) {
  const directory = optionalText(value, 240) || '/';
  if (!directory.startsWith('/') || directory.includes('\\') || directory.includes('//')) throw new InputError('Directory must be an absolute path inside the repository.');
  const parts = directory.split('/').filter(Boolean);
  if (parts.some((part) => part === '.' || part === '..' || !/^[A-Za-z0-9._-]+$/.test(part))) throw new InputError('Directory must stay inside the repository.');
  return parts.length ? `/${parts.join('/')}` : '/';
}

export function validateProjectDomains(value, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || value.length > 10 || (!allowEmpty && value.length < 1)) throw new InputError(allowEmpty ? 'Provide up to 10 domain names.' : 'Provide between 1 and 10 domain names.');
  const hosts = [...new Set(value.map((item) => validateDomain({ hostname: item })))];
  if (!allowEmpty && !hosts.length) throw new InputError('Provide at least one domain name.');
  return hosts;
}

export function validateHttpsCredential(input) {
  const name = requiredText(input.name, 'Credential name', 80);
  const token = requiredText(input.token, 'Access token', 4096);
  if (!/^[a-z][a-z0-9-]{0,79}$/.test(name)) throw new InputError('Credential name must use lowercase letters, digits, and hyphens.');
  if (token.includes('\n') || token.includes('\r')) throw new InputError('Access token is invalid.');
  return { name, token };
}

export function validateNotificationHook(input) {
  const name = requiredText(input.name, 'Notification hook name', 80);
  const provider = input.provider;
  if (!['discord', 'google-chat', 'slack', 'generic'].includes(provider)) throw new InputError('Notification provider is invalid.');
  const endpoint = requiredText(input.endpoint, 'Webhook URL', 2048);
  let parsed;
  try { parsed = new URL(endpoint); } catch { throw new InputError('Webhook URL is invalid.'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) throw new InputError('Webhook URL must be a plain HTTPS URL.');
  const projectSlug = optionalText(input.projectSlug, 63) || null;
  if (projectSlug && !/^[a-z][a-z0-9-]{0,62}$/.test(projectSlug)) throw new InputError('Notification project is invalid.');
  const events = Array.isArray(input.events) ? [...new Set(input.events)] : [];
  const allowedEvents = new Set(['deployment.succeeded', 'deployment.failed']);
  if (!events.length || events.length > allowedEvents.size || events.some((event) => !allowedEvents.has(event))) throw new InputError('Select at least one valid notification event.');
  return { name, provider, endpoint: parsed.toString(), projectSlug, events };
}

export function validatePasswordChange(input) {
  const currentPassword = input?.currentPassword;
  if (typeof currentPassword !== 'string' || !currentPassword || currentPassword.length > 128 || /[\r\n\0]/.test(currentPassword)) throw new InputError('Current password is invalid.');
  const newPassword = input?.newPassword;
  if (typeof newPassword !== 'string' || newPassword.length < 12 || newPassword.length > 128 || /[\r\n\0\s]/.test(newPassword)) throw new InputError('New password must be between 12 and 128 characters and must not contain whitespace.');
  if (!/[a-z]/.test(newPassword) || !/[A-Z]/.test(newPassword) || !/[0-9]/.test(newPassword) || !/[^A-Za-z0-9]/.test(newPassword)) {
    throw new InputError('New password must include upper and lower case letters, a number, and a symbol.');
  }
  if (currentPassword === newPassword) throw new InputError('Choose a different new password.');
  return { currentPassword, newPassword };
}

export function validateEnvironmentContent(content) {
  if (typeof content !== 'string' || content.length > 128 * 1024) throw new InputError('Environment content is invalid.');
  const keys = [];
  for (const rawLine of content.replace(/\r\n/g, '\n').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!match) throw new InputError('Each .env line must use KEY=value format.');
    keys.push(match[1]);
  }
  return { content, keys: [...new Set(keys)].sort() };
}

export function validateEnvironmentVariables(variables) {
  if (!Array.isArray(variables) || variables.length > 50) throw new InputError('Environment variables are invalid.');
  const seen = new Set();
  return variables.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new InputError('Environment variable is invalid.');
    const key = typeof item.key === 'string' ? item.key.trim() : '';
    if (!/^[A-Z_][A-Z0-9_]{0,127}$/.test(key) || seen.has(key)) throw new InputError('Environment variable names must be unique uppercase shell identifiers.');
    seen.add(key);
    const value = typeof item.value === 'string' ? item.value : '';
    if (value.length > 4096 || value.includes('\u0000') || value.includes('\n') || value.includes('\r')) throw new InputError('Environment variable value is invalid.');
    if (typeof item.sensitive !== 'boolean') throw new InputError('Environment variable sensitivity is invalid.');
    return { key, value, sensitive: item.sensitive };
  });
}

export class SecretVault {
  #key;
  constructor(encodedKey) {
    this.#key = Buffer.from(encodedKey, 'base64');
    if (this.#key.length !== 32) throw new Error('HOSTMGR_SECRET_KEY must be a base64-encoded 32-byte key.');
  }
  encrypt(value) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.#key, iv);
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return { algorithm: 'aes-256-gcm', iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
  }
  decrypt(payload) {
    const decipher = createDecipheriv('aes-256-gcm', this.#key, Buffer.from(payload.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(payload.ciphertext, 'base64')), decipher.final()]).toString('utf8');
  }
}

export function validateDomain(input) {
  const hostname = requiredText(input.hostname, 'Domain', 253).toLowerCase();
  if (!/^(?=.{1,253}$)(?!-)(?:[a-z0-9-]{1,63}\.)+[a-z]{2,63}$/.test(hostname)) throw new InputError('Enter a valid DNS hostname.');
  return hostname;
}

function requiredText(value, label, max) {
  const text = optionalText(value, max);
  if (!text) throw new InputError(`${label} is required.`);
  return text;
}

function optionalText(value, max) {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  if (text.length > max) throw new InputError('Input is too long.');
  return text;
}

function optionalPackageScript(value, label) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !/^[a-zA-Z0-9:_-]{1,64}$/.test(value)) throw new InputError(`${label} must be a package script name, or be left empty.`);
  return value;
}

function validateComposeFile(value) {
  const file = optionalText(value, 240) || 'compose.yaml';
  if (file.startsWith('/') || file.includes('\\') || file.includes('//')) throw new InputError('Docker Compose file must be inside the repository.');
  const parts = file.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..' || !/^[A-Za-z0-9._-]+$/.test(part))) throw new InputError('Docker Compose file must stay inside the repository.');
  if (!/\.ya?ml$/i.test(file)) throw new InputError('Docker Compose file must be YAML.');
  return file;
}

function isRepositoryUrl(value) {
  return /^https:\/\/[^\s]+\.git(?:$|[?#])/.test(value) || /^git@[a-z0-9.-]+:[^\s]+\.git$/i.test(value);
}

export class InputError extends Error {}

export function appendAudit(state, event) {
  state.audit.unshift({ id: randomUUID(), at: new Date().toISOString(), ...event });
  state.audit = state.audit.slice(0, 500);
}

function migrateState(state) {
  state.schemaVersion = 3;
  state.git ??= { identity: null };
  state.sessions ??= [];
  state.credentials ??= [];
  state.projects ??= [];
  for (const project of state.projects) {
    project.directory ??= '/';
    project.runtime ??= 'node';
    project.deployment ??= { state: 'idle', activeReleaseId: null, previousReleaseId: null, releases: [], updatedAt: new Date().toISOString() };
  }
  state.audit ??= [];
  state.jobs ??= [];
  state.monitorTokens ??= [];
  state.owner ??= null;
  state.databaseConnections ??= [];
  state.notificationHooks ??= [];
  state.mail ??= initialMailState();
  // Databases created before the mail tool existed lack its tools entry.
  state.tools.mail ??= { id: 'mail', status: 'Missing', version: null, simulated: true, updatedAt: new Date().toISOString(), ...TOOLS.mail };
  return state;
}
