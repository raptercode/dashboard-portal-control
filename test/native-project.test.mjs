import test from 'node:test';
import assert from 'node:assert/strict';
import { InputError } from '../src/core.mjs';
import { activateRelease, appendReleaseEvent, beginDeployment, beginRollback, createRelease, initialDeployment, markReleaseHealthy, markReleasePendingActivation, projectIdentity, renderEnvironmentFile, renderSystemdUnit, validateDockerComposeProject, validateNativeProject, validatePackageScripts } from '../src/native-project.mjs';

const project = { name: 'Demo', slug: 'demo-app', repository: 'https://github.com/example/demo.git', branch: 'main', port: 3100, healthCheckPath: '/ready', buildScript: 'build', startScript: 'start', environment: { API_KEY: 'not logged', NODE_ENV: 'production' } };

test('native project contract produces a constrained systemd unit', () => {
  const unit = renderSystemdUnit(project);
  assert.equal(projectIdentity('demo-app').service, 'hostmgr-project-demo-app.service');
  assert.match(unit, /User=hostmgr-demo-app/);
  assert.match(unit, /ExecStart=\/usr\/local\/bin\/npm run start/);
  assert.match(unit, /NoNewPrivileges=true/);
  assert.match(unit, /ProtectSystem=strict/);
  assert.doesNotMatch(unit, /API_KEY/);
  assert.match(renderEnvironmentFile(project.environment), /API_KEY="not logged"/);
});

test('native contract refuses shell-like scripts and invalid environment input', () => {
  assert.throws(() => validateNativeProject({ ...project, startScript: 'start && id' }), InputError);
  assert.throws(() => validateNativeProject({ ...project, environment: { 'BAD-NAME': 'x' } }), InputError);
  assert.throws(() => validateNativeProject({ ...project, environment: { API_KEY: 'line\nbreak' } }), InputError);
  assert.throws(() => projectIdentity('../../root'), InputError);
});

test('native deployment only activates a healthy candidate and preserves a rollback target', () => {
  const first = createRelease(project, 'a'.repeat(40));
  let deployment = beginDeployment(initialDeployment(), first);
  assert.throws(() => activateRelease(deployment, first.id), InputError);
  deployment = markReleaseHealthy(deployment, first.id);
  deployment = activateRelease(deployment, first.id);
  assert.equal(deployment.activeReleaseId, first.id);

  const second = createRelease(project, 'b'.repeat(40));
  deployment = beginDeployment(deployment, second);
  deployment = markReleaseHealthy(deployment, second.id);
  deployment = markReleasePendingActivation(deployment, second.id);
  assert.equal(deployment.state, 'awaiting_activation');
  deployment = activateRelease(deployment, second.id);
  assert.equal(deployment.activeReleaseId, second.id);
  assert.equal(deployment.previousReleaseId, first.id);
  assert.equal(deployment.releases.find((release) => release.id === first.id).status, 'superseded');

  const rollback = beginRollback(deployment);
  assert.equal(rollback.release.id, first.id);
  deployment = activateRelease(rollback.deployment, first.id, 'rollback');
  assert.equal(deployment.activeReleaseId, first.id);
  assert.equal(deployment.previousReleaseId, second.id);
});

test('native package contract requires both constrained npm scripts', () => {
  assert.equal(validatePackageScripts({ scripts: { build: 'vite build', start: 'node server.js' } }, project).startScript, 'start');
  assert.throws(() => validatePackageScripts({ scripts: { build: 'vite build' } }, project), InputError);
});

test('native project can explicitly skip a build step without relaxing the start script contract', () => {
  const runtimeOnly = { ...project, buildScript: null };
  assert.equal(validateNativeProject(runtimeOnly).buildScript, null);
  assert.equal(validatePackageScripts({ scripts: { start: 'node app.js' } }, runtimeOnly).startScript, 'start');
  assert.match(renderSystemdUnit(runtimeOnly), /ExecStart=\/usr\/local\/bin\/npm run start/);
});

test('Bun native projects render Bun as the constrained systemd launcher', () => {
  const bunProject = { ...project, runtime: 'bun', buildScript: null };
  assert.equal(validateNativeProject(bunProject).runtime, 'bun');
  assert.match(renderSystemdUnit(bunProject), /ExecStart=\/usr\/local\/bin\/bun run start/);
  assert.equal(validatePackageScripts({ scripts: { start: 'bun server.ts' } }, bunProject).startScript, 'start');
});

test('release records safe deployment phases and supports an explicit health-check skip', () => {
  const release = createRelease({ ...project, healthCheckEnabled: false });
  assert.equal(release.health.enabled, false);
  assert.equal(release.health.status, 'skipped');
  let deployment = beginDeployment(initialDeployment(), release);
  deployment = appendReleaseEvent(deployment, release.id, 'dependencies', 'passed', 'Locked dependencies installed.');
  deployment = markReleaseHealthy(deployment, release.id);
  const current = deployment.releases[0];
  assert.equal(current.status, 'healthy');
  assert.equal(current.health.status, 'skipped');
  assert.equal(current.events.at(-1).phase, 'dependencies');
});

test('Docker Compose release uses the same durable release state without an npm script', () => {
  const docker = validateDockerComposeProject({ ...project, runtime: 'docker-compose', composeFile: 'compose.yaml', composeService: 'web', environment: {} });
  assert.equal(docker.candidatePort, docker.port);
  const release = createRelease(docker, 'c'.repeat(40));
  assert.equal(release.runtime, 'docker-compose');
  assert.equal(release.startScript, null);
  assert.throws(() => validateNativeProject(docker), InputError);
});
