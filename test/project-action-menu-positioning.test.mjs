import test from 'node:test';
import assert from 'node:assert/strict';
import { projectActionMenuPlacement } from '../public/ui/project-action-menu-positioning.js';

test('project action menu opens upward when its full list would overflow the bottom of the scroll area', () => {
  assert.equal(projectActionMenuPlacement({
    triggerTop: 286,
    triggerBottom: 318,
    menuHeight: 278,
    boundaryTop: 56,
    boundaryBottom: 420
  }), 'up');
});

test('project action menu keeps opening downward when there is enough room below', () => {
  assert.equal(projectActionMenuPlacement({
    triggerTop: 110,
    triggerBottom: 142,
    menuHeight: 278,
    boundaryTop: 56,
    boundaryBottom: 620
  }), 'down');
});

test('project action menu uses the roomier side when neither direction fits fully', () => {
  assert.equal(projectActionMenuPlacement({
    triggerTop: 245,
    triggerBottom: 277,
    menuHeight: 278,
    boundaryTop: 56,
    boundaryBottom: 420
  }), 'up');
});
