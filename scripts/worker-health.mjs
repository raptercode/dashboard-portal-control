// Worker readiness is process stability, never an HTTP probe or job completion.
export function parseWorkerServiceState(output) {
  const fields = Object.fromEntries(String(output).split('\n').filter(line => line.includes('=')).map(line => {
    const split = line.indexOf('=');
    return [line.slice(0, split), line.slice(split + 1).trim()];
  }));
  if (!['active', 'reloading', 'inactive', 'failed', 'activating', 'deactivating', 'maintenance', 'refreshing'].includes(fields.ActiveState)
    || !/^[a-z][a-z-]*$/.test(fields.SubState ?? '')
    || !/^\d+$/.test(fields.MainPID ?? '') || !Number.isSafeInteger(Number(fields.MainPID))
    || !/^\d+$/.test(fields.NRestarts ?? '') || !Number.isSafeInteger(Number(fields.NRestarts))
    || !Object.hasOwn(fields, 'UnitFileState')) throw new Error('Worker process state could not be verified.');
  if (fields.UnitFileState.startsWith('masked')) throw new Error('The project service is masked; inspect its host configuration before deploying.');
  return { active: fields.ActiveState, substate: fields.SubState, pid: Number(fields.MainPID), restarts: Number(fields.NRestarts), enabled: ['enabled', 'enabled-runtime'].includes(fields.UnitFileState) };
}

export async function assertWorkerStable(readState, { windowMs = 5000, timeoutMs = 30000, intervalMs = 250, now = Date.now, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const deadline = now() + timeoutMs;
  let baseline = null;
  let stableAt;
  while (now() <= deadline) {
    const state = await readState();
    if (['failed', 'inactive', 'deactivating'].includes(state.active)) throw new Error('Worker exited before it passed the process stability check.');
    if (!Number.isInteger(state.restarts) || state.restarts < 0) throw new Error('Worker process state could not be verified.');
    if (baseline && (state.restarts !== baseline.restarts || state.pid !== baseline.pid || state.active !== 'active' || state.substate !== 'running')) {
      throw new Error('Worker exited or restarted during the process stability check.');
    }
    if (state.active === 'active' && state.substate === 'running' && Number.isInteger(state.pid) && state.pid > 0) {
      if (!baseline) { baseline = state; stableAt = now(); }
      if (now() - stableAt >= windowMs) return;
    }
    await wait(intervalMs);
  }
  throw new Error('Worker did not become a stable running process before the timeout.');
}
