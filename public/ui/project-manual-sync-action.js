export function hasNewerSyncedRevision({ syncStatus, syncRevision, deployedRevision }) {
  return syncStatus === 'synced'
    && typeof syncRevision === 'string'
    && Boolean(syncRevision)
    && syncRevision !== deployedRevision;
}
