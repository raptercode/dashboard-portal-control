import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';

export const SUPPORTED_NODE_MAJOR = 24;
export const TOOLS = {
  nginx: { label: 'Nginx', package: 'nginx', required: true, purpose: 'Reverse proxy และรับ traffic จาก domain' },
  certbot: { label: 'Certbot', package: 'certbot', required: true, purpose: 'ออกและต่ออายุ Let’s Encrypt certificate' },
  git: { label: 'Git', package: 'git', required: true, purpose: 'Clone และ pull source code' },
  docker: { label: 'Docker Engine + Compose', package: 'docker.io docker-compose-v2', required: false, purpose: 'ใช้งาน Docker mode' }
};

export function createInitialState() {
  return {
    schemaVersion: 1,
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
    audit: []
  };
}

export class StateStore {
  #path;
  #state;
  #queue = Promise.resolve();

  constructor(path) {
    this.#path = path;
  }

  async load() {
    try {
      this.#state = migrateState(JSON.parse(await readFile(this.#path, 'utf8')));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      this.#state = createInitialState();
      await this.#persist(this.#state);
    }
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

  async #persist(state) {
    await mkdir(dirname(this.#path), { recursive: true });
    const tempPath = `${this.#path}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await rename(tempPath, this.#path);
  }
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
    port: Number(input.port),
    healthCheckPath: optionalText(input.healthCheckPath, 200) || '/'
  };
  if (!/^[a-z][a-z0-9-]{0,62}$/.test(project.slug)) throw new InputError('Project slug must use lowercase letters, digits, and hyphens.');
  if (!isRepositoryUrl(project.repository)) throw new InputError('Repository URL must be HTTPS or SSH Git syntax.');
  if (!/^[A-Za-z0-9._/-]{1,100}$/.test(project.branch) || project.branch.startsWith('-')) throw new InputError('Branch name is invalid.');
  if (!Number.isInteger(project.port) || project.port < 1024 || project.port > 65535) throw new InputError('Port must be between 1024 and 65535.');
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
  const buildScript = optionalNpmScript(input.buildScript, 'Build script');
  const startScript = optionalNpmScript(input.startScript, 'Start script');
  const domains = input.domains === undefined ? undefined : validateProjectDomains(input.domains);
  return {
    ...project,
    protocol,
    credentialId: protocol === 'https' ? credentialId || null : null,
    sshKeyId: protocol === 'ssh' ? `deploy-key-${project.slug}` : null,
    ...(buildScript !== undefined ? { buildScript } : {}),
    ...(startScript !== undefined ? { startScript } : {}),
    ...(domains !== undefined ? { domains: { hosts: domains, updatedAt: new Date().toISOString(), syncedAt: null } } : {})
  };
}

export function validateProjectDomains(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 10) throw new InputError('Provide between 1 and 10 domain names.');
  const hosts = [...new Set(value.map((item) => validateDomain({ hostname: item })))];
  if (!hosts.length) throw new InputError('Provide at least one domain name.');
  return hosts;
}

export function validateHttpsCredential(input) {
  const name = requiredText(input.name, 'Credential name', 80);
  const token = requiredText(input.token, 'Access token', 4096);
  if (!/^[a-z][a-z0-9-]{0,79}$/.test(name)) throw new InputError('Credential name must use lowercase letters, digits, and hyphens.');
  if (token.includes('\n') || token.includes('\r')) throw new InputError('Access token is invalid.');
  return { name, token };
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

function optionalNpmScript(value, label) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !/^[a-zA-Z0-9:_-]{1,64}$/.test(value)) throw new InputError(`${label} must be an npm script name, or be left empty.`);
  return value;
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
  state.git ??= { identity: null };
  state.sessions ??= [];
  state.credentials ??= [];
  state.projects ??= [];
  for (const project of state.projects) {
    project.deployment ??= { state: 'idle', activeReleaseId: null, previousReleaseId: null, releases: [], updatedAt: new Date().toISOString() };
  }
  state.audit ??= [];
  return state;
}
