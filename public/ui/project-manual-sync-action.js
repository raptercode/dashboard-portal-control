export function shouldOfferManualSync({ autoSyncEnabled, syncStatus, syncRevision, deployedRevision }) {
  return !autoSyncEnabled
    && syncStatus === 'synced'
    && typeof syncRevision === 'string'
    && Boolean(syncRevision)
    && syncRevision !== deployedRevision;
}
