import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldOfferManualSync } from '../public/ui/project-manual-sync-action.js';

test('manual sync is offered only for a newer Git revision while auto sync is disabled', () => {
  assert.equal(shouldOfferManualSync({
    autoSyncEnabled: false,
    syncStatus: 'synced',
    syncRevision: '6ae4e021c87954028448a16061e4d55cc6419607',
    deployedRevision: '8f486d1cb4e3627f20bd17c4a610f8652fd951e7'
  }), true);
  assert.equal(shouldOfferManualSync({
    autoSyncEnabled: true,
    syncStatus: 'synced',
    syncRevision: '6ae4e021c87954028448a16061e4d55cc6419607',
    deployedRevision: '8f486d1cb4e3627f20bd17c4a610f8652fd951e7'
  }), false);
  assert.equal(shouldOfferManualSync({
    autoSyncEnabled: false,
    syncStatus: 'synced',
    syncRevision: '6ae4e021c87954028448a16061e4d55cc6419607',
    deployedRevision: '6ae4e021c87954028448a16061e4d55cc6419607'
  }), false);
});
