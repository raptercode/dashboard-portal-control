import { randomUUID } from 'node:crypto';
import { InputError, validateProject } from './core.mjs';

export function validateNativeProject(input) {
  const project = validateProject(input);
  if ((input.runtime ?? 'node') !== 'node') throw new InputError('This operation requires the Node runtime.');
  // Server-rendered applications can have no compilation phase. An explicit
  // empty/null value means "install dependencies, then start"; omitting it
  // preserves the historical `build` default.
  const buildScript = input.buildScript === '' || input.buildScript === null
    ? null
    : validateNpmScript(input.buildScript ?? 'build', 'Build script');
  const startScript = validateNpmScript(input.startScript ?? 'start', 'Start script');
  const environment = validateEnvironment(input.environment ?? {});
  const healthCheckTimeoutMs = validateTimeout(input.healthCheckTimeoutMs ?? 30_000);
  // Keep the default deterministic while retaining compatibility with valid
  // service ports in the upper ephemeral range.
  const candidatePort = validateCandidatePort(input.candidatePort ?? (project.port <= 55_535 ? project.port + 10_000 : project.port - 1_000), project.port);
  return { ...project, buildScript, startScript, environment, healthCheckTimeoutMs, candidatePort };
}

export function validateDockerComposeProject(input) {
  const project = validateProject(input);
  if (input.runtime !== 'docker-compose') throw new InputError('This operation requires the Docker Compose runtime.');
  if (typeof input.composeFile !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,239}\.ya?ml$/i.test(input.composeFile) || input.composeFile.includes('..')) throw new InputError('Docker Compose file is invalid.');
  if (typeof input.composeService !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/.test(input.composeService)) throw new InputError('Docker Compose service is invalid.');
  const environment = validateEnvironment(input.environment ?? {});
  return { ...project, runtime: 'docker-compose', composeFile: input.composeFile, composeService: input.composeService, environment, healthCheckTimeoutMs: validateTimeout(input.healthCheckTimeoutMs ?? 30_000), candidatePort: project.port };
}

export function projectIdentity(slug) {
  if (!/^[a-z][a-z0-9-]{0,62}$/.test(slug)) throw new InputError('Project slug is invalid.');
  return { user: `hostmgr-${slug}`, service: `hostmgr-project-${slug}.service`, root: `/srv/hostmgr/projects/${slug}`, releases: `/srv/hostmgr/projects/${slug}/releases`, shared: `/srv/hostmgr/projects/${slug}/shared`, environmentFile: `/etc/hostmgr/projects/${slug}.env` };
}

export function renderSystemdUnit(input) {
  const project = validateNativeProject(input);
  const identity = projectIdentity(project.slug);
  return `[Unit]\nDescription=Host Manager project ${project.slug}\nAfter=network-online.target\nWants=network-online.target\n\n[Service]\nType=simple\nUser=${identity.user}\nGroup=${identity.user}\nWorkingDirectory=${identity.root}/current\nEnvironmentFile=${identity.environmentFile}\nEnvironment=PORT=${project.port}\nExecStart=/usr/local/bin/npm run ${project.startScript}\nRestart=on-failure\nRestartSec=5\nNoNewPrivileges=true\nPrivateTmp=true\nProtectHome=true\nProtectSystem=strict\nReadWritePaths=${identity.root}\n\n[Install]\nWantedBy=multi-user.target\n`;
}

/**
 * The package.json is untrusted input until this check succeeds.  We only
 * invoke named npm scripts; the contents remain the project owner's code.
 */
export function validatePackageScripts(packageJson, projectInput) {
  const project = validateNativeProject(projectInput);
  if (!packageJson || typeof packageJson !== 'object' || Array.isArray(packageJson)) throw new InputError('Project package.json is invalid.');
  if (!packageJson.scripts || typeof packageJson.scripts !== 'object' || Array.isArray(packageJson.scripts)) throw new InputError('Project package.json must define npm scripts.');
  for (const script of [project.buildScript, project.startScript].filter(Boolean)) {
    if (typeof packageJson.scripts[script] !== 'string' || !packageJson.scripts[script].trim()) {
      throw new InputError(`Project package.json is missing the ${script} npm script.`);
    }
  }
  return project;
}

export function createRelease(projectInput, revision = null) {
  const project = projectInput.runtime === 'docker-compose' ? validateDockerComposeProject(projectInput) : validateNativeProject(projectInput);
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    status: 'candidate',
    createdAt: now,
    revision,
    runtime: project.runtime ?? 'node',
    buildScript: project.buildScript ?? null,
    startScript: project.startScript ?? null,
    health: {
      enabled: project.healthCheckEnabled,
      path: project.healthCheckEnabled ? project.healthCheckPath : null,
      port: project.candidatePort,
      timeoutMs: project.healthCheckTimeoutMs,
      checkedAt: project.healthCheckEnabled ? null : now,
      status: project.healthCheckEnabled ? 'pending' : 'skipped'
    },
    events: [{ at: now, phase: 'candidate', status: 'started', message: 'Candidate release created.' }]
  };
}

export function initialDeployment() {
  return { state: 'idle', activeReleaseId: null, previousReleaseId: null, releases: [], updatedAt: new Date().toISOString() };
}

export function beginDeployment(deploymentInput, release) {
  const deployment = normalizeDeployment(deploymentInput);
  if (!release || release.status !== 'candidate') throw new InputError('Deployment must begin with a candidate release.');
  if (deployment.state === 'deploying' || deployment.state === 'rolling_back') throw new InputError('Another deployment operation is already in progress.');
  deployment.state = 'deploying';
  deployment.releases.unshift(release);
  deployment.updatedAt = new Date().toISOString();
  return deployment;
}

export function markReleaseHealthy(deploymentInput, releaseId) {
  const deployment = normalizeDeployment(deploymentInput);
  const release = releaseById(deployment, releaseId);
  if (deployment.state !== 'deploying' || release.status !== 'candidate') throw new InputError('Only the current candidate release can pass health checks.');
  release.status = 'healthy';
  if (release.health.enabled !== false) {
    release.health.status = 'passed';
    release.health.checkedAt = new Date().toISOString();
  }
  deployment.updatedAt = new Date().toISOString();
  return deployment;
}

export function markReleasePendingActivation(deploymentInput, releaseId, operation = 'deploy') {
  const deployment = normalizeDeployment(deploymentInput);
  const release = releaseById(deployment, releaseId);
  if (!['deploying', 'rolling_back'].includes(deployment.state) || release.status !== 'healthy') throw new InputError('Only a healthy release can await activation.');
  deployment.state = 'awaiting_activation';
  deployment.pendingActivation = { releaseId, operation, requestedAt: new Date().toISOString() };
  deployment.updatedAt = new Date().toISOString();
  return deployment;
}

export function activateRelease(deploymentInput, releaseId, operation = 'deploy') {
  const deployment = normalizeDeployment(deploymentInput);
  const release = releaseById(deployment, releaseId);
  const permittedState = operation === 'rollback' ? 'rolling_back' : 'deploying';
  const pendingMatches = deployment.state === 'awaiting_activation' && deployment.pendingActivation?.releaseId === releaseId && deployment.pendingActivation?.operation === operation;
  if ((deployment.state !== permittedState && !pendingMatches) || release.status !== 'healthy') throw new InputError('Only a healthy release can be activated.');
  const prior = deployment.activeReleaseId && deployment.releases.find((item) => item.id === deployment.activeReleaseId);
  if (prior && prior.id !== release.id) prior.status = 'superseded';
  deployment.previousReleaseId = prior?.id ?? null;
  deployment.activeReleaseId = release.id;
  release.status = 'active';
  release.activatedAt = new Date().toISOString();
  deployment.state = 'active';
  delete deployment.pendingActivation;
  deployment.updatedAt = new Date().toISOString();
  return deployment;
}

export function failRelease(deploymentInput, releaseId, reason = 'Deployment failed.') {
  const deployment = normalizeDeployment(deploymentInput);
  const release = releaseById(deployment, releaseId);
  if (!['candidate', 'healthy'].includes(release.status)) throw new InputError('Only a candidate release can fail deployment.');
  release.status = 'failed';
  release.failure = safeFailure(reason);
  release.health.status = release.health.status === 'pending' ? 'failed' : release.health.status;
  release.health.checkedAt ??= new Date().toISOString();
  appendEvent(release, 'deployment', 'failed', release.failure);
  deployment.state = deployment.activeReleaseId ? 'active' : 'failed';
  deployment.updatedAt = new Date().toISOString();
  return deployment;
}

export function beginRollback(deploymentInput, releaseId = null) {
  const deployment = normalizeDeployment(deploymentInput);
  if (deployment.state === 'deploying' || deployment.state === 'rolling_back') throw new InputError('Another deployment operation is already in progress.');
  const targetId = releaseId ?? deployment.previousReleaseId;
  if (!targetId || targetId === deployment.activeReleaseId) throw new InputError('No previous release is available for rollback.');
  const release = releaseById(deployment, targetId);
  if (!['superseded', 'active'].includes(release.status)) throw new InputError('Rollback target is not an active historical release.');
  // A historical release passed health checks when it became active. Recheck it
  // before activation, but make it eligible for the same activation contract.
  release.status = 'healthy';
  deployment.state = 'rolling_back';
  deployment.updatedAt = new Date().toISOString();
  return { deployment, release };
}

export function normalizeDeployment(input) {
  const deployment = structuredClone(input ?? initialDeployment());
  deployment.state ??= 'idle';
  deployment.activeReleaseId ??= null;
  deployment.previousReleaseId ??= null;
  deployment.releases ??= [];
  for (const release of deployment.releases) {
    release.health ??= { enabled: true, path: '/', port: null, timeoutMs: null, checkedAt: null, status: 'pending' };
    release.health.enabled ??= true;
    release.events ??= [];
  }
  deployment.pendingActivation ??= null;
  deployment.updatedAt ??= new Date().toISOString();
  return deployment;
}

export function appendReleaseEvent(deploymentInput, releaseId, phase, status, message) {
  const deployment = normalizeDeployment(deploymentInput);
  const release = releaseById(deployment, releaseId);
  appendEvent(release, phase, status, message);
  deployment.updatedAt = new Date().toISOString();
  return deployment;
}

export function renderEnvironmentFile(environment) {
  const safe = validateEnvironment(environment);
  return Object.entries(safe).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${systemdEscape(value)}`).join('\n') + (Object.keys(safe).length ? '\n' : '');
}

function validateNpmScript(value, label) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9:_-]{1,64}$/.test(value)) throw new InputError(`${label} must be an npm script name, not a shell command.`);
  return value;
}

function validateTimeout(value) {
  if (!Number.isInteger(value) || value < 1_000 || value > 60_000) throw new InputError('Health-check timeout must be between 1000 and 60000 milliseconds.');
  return value;
}

function validateCandidatePort(value, port) {
  if (!Number.isInteger(value) || value < 1024 || value > 65535 || value === port) throw new InputError('Candidate port must be a different port between 1024 and 65535.');
  return value;
}

function releaseById(deployment, releaseId) {
  const release = deployment.releases.find((item) => item.id === releaseId);
  if (!release) throw new InputError('Release was not found.');
  return release;
}

function safeFailure(reason) {
  return typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 240) : 'Deployment failed.';
}

function appendEvent(release, phase, status, message) {
  const validPhase = typeof phase === 'string' && /^[a-z0-9_-]{1,48}$/i.test(phase) ? phase : 'deployment';
  const validStatus = ['started', 'passed', 'failed', 'skipped', 'pending'].includes(status) ? status : 'pending';
  const safeMessage = typeof message === 'string' && message.trim() ? message.trim().slice(0, 240) : 'Deployment event recorded.';
  release.events ??= [];
  release.events.push({ at: new Date().toISOString(), phase: validPhase, status: validStatus, message: safeMessage });
  if (release.events.length > 60) release.events.splice(0, release.events.length - 60);
}

function validateEnvironment(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InputError('Environment must be a key-value object.');
  const entries = Object.entries(value);
  if (entries.length > 50) throw new InputError('Too many environment variables.');
  const result = {};
  for (const [key, item] of entries) {
    if (!/^[A-Z_][A-Z0-9_]{0,127}$/.test(key)) throw new InputError('Environment variable names must be uppercase shell identifiers.');
    if (typeof item !== 'string' || item.includes('\u0000') || item.includes('\n') || item.length > 4096) throw new InputError('Environment variable value is invalid.');
    result[key] = item;
  }
  return result;
}

function systemdEscape(value) {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$')}"`;
}
