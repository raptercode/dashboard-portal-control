import test from 'node:test';
import assert from 'node:assert/strict';
import { hasNewerSyncedRevision } from '../public/ui/project-manual-sync-action.js';

test('a newer synced revision is visible even when auto deploy is enabled', () => {
  assert.equal(hasNewerSyncedRevision({
    syncStatus: 'synced',
    syncRevision: '6ae4e021c87954028448a16061e4d55cc6419607',
    deployedRevision: '8f486d1cb4e3627f20bd17c4a610f8652fd951e7'
  }), true);
  assert.equal(hasNewerSyncedRevision({
    syncStatus: 'synced',
    syncRevision: '6ae4e021c87954028448a16061e4d55cc6419607',
    deployedRevision: '6ae4e021c87954028448a16061e4d55cc6419607'
  }), false);
  assert.equal(hasNewerSyncedRevision({
    syncStatus: 'queued',
    syncRevision: '6ae4e021c87954028448a16061e4d55cc6419607',
    deployedRevision: '8f486d1cb4e3627f20bd17c4a610f8652fd951e7'
  }), false);
});
