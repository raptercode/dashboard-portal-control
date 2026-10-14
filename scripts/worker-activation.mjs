import { readFile, readlink, copyFile, chown, chmod, writeFile, rename, symlink, rm } from 'node:fs/promises';

async function optional(read) {
  try { return await read(); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

// Preparation captures everything before changing live files or stopping a worker.
// Candidate build/preparation must not start the worker: it could consume real jobs.
export async function prepareWorkerActivation({ identity, releaseId, releaseRoot, environmentSource, unit, run, readState, assertStable, ownership = chown }) {
  const previousUnit = await optional(() => readFile(identity.unitFile));
  const previousEnvironment = await optional(() => readFile(identity.environmentFile));
  const previousTarget = await optional(() => readlink(identity.current));
  const previousState = await readState();
  const previousActive = ['active', 'activating'].includes(previousState.active);
  const previousEnabled = previousState.enabled;
  if (!['active', 'reloading', 'inactive', 'failed', 'activating', 'deactivating', 'maintenance', 'refreshing'].includes(previousState.active) || typeof previousState.enabled !== 'boolean') throw new Error('Previous worker service state could not be verified.');
  if (previousActive && (!previousTarget || previousUnit === null || previousEnvironment === null)) throw new Error('Active worker has no complete previous release configuration to restore.');
  const environmentTemp = `${identity.environmentFile}.${releaseId}.tmp`;
  const unitTemp = `${identity.unitFile}.${releaseId}.tmp`;
  const nextLink = `${identity.current}.${releaseId}.next`;
  let touched = false;
  let stopped = false;
  let startAttempted = false;
  let enableAttempted = false;
  const systemctl = (args) => run('/usr/bin/systemctl', args);

  const restoreFile = async (path, contents, mode) => {
    if (contents === null) await rm(path, { force: true });
    else await writeFile(path, contents, { mode });
  };
  return {
    identity, previousTarget, releaseRoot,
    async activate() {
      if (previousUnit !== null || previousActive) {
        stopped = true;
        await systemctl(['stop', identity.service]);
      }
      touched = true;
      await copyFile(environmentSource, environmentTemp);
      await ownership(environmentTemp, 0, identity.gid);
      await chmod(environmentTemp, 0o640);
      await rename(environmentTemp, identity.environmentFile);
      await writeFile(unitTemp, unit, { mode: 0o644 });
      await rename(unitTemp, identity.unitFile);
      await rm(nextLink, { force: true });
      await symlink(releaseRoot, nextLink);
      await rename(nextLink, identity.current);
      await systemctl(['daemon-reload']);
      enableAttempted = true;
      await systemctl(['enable', identity.service]);
      startAttempted = true;
      await systemctl(['start', identity.service]);
      await assertStable();
    },
    async rollback() {
      // Do not restore/start the previous worker if the new process cannot stop.
      if (startAttempted) await systemctl(['stop', identity.service]);
      if (touched) {
        if (enableAttempted && !previousEnabled) await systemctl(['disable', identity.service]);
        await restoreFile(identity.unitFile, previousUnit, 0o644);
        await restoreFile(identity.environmentFile, previousEnvironment, 0o640);
        if (previousEnvironment !== null) {
          await ownership(identity.environmentFile, 0, identity.gid);
          await chmod(identity.environmentFile, 0o640);
        }
        if (previousTarget) {
          const revert = `${identity.current}.${releaseId}.rollback`;
          await rm(revert, { force: true });
          await symlink(previousTarget, revert);
          await rename(revert, identity.current);
        } else await rm(identity.current, { force: true });
        await systemctl(['daemon-reload']);
        if (previousEnabled) await systemctl(['enable', identity.service]);
      }
      if (stopped && previousActive) {
        await systemctl(['start', identity.service]);
        await assertStable();
      }
      for (const path of [environmentTemp, unitTemp, nextLink]) await rm(path, { force: true });
    }
  };
}
