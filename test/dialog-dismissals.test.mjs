import test from 'node:test';
import assert from 'node:assert/strict';
import { bindDialogDismissals } from '../public/ui/dialog-dismissals.js';

class FakeDialog {
  constructor() {
    this.open = true;
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  emit(type, event) {
    for (const listener of this.listeners.get(type) || []) listener(event);
  }

  contains(node) { return node?.dialog === this; }
}

function closeControl(dialog) {
  return {
    dialog,
    closest(selector) { return selector === '[data-dialog-close]' ? this : null; }
  };
}

test('every modal close control closes its owning dialog through a bubbling click', () => {
  const dialog = new FakeDialog();
  const closed = [];
  bindDialogDismissals({
    dialogs: [dialog],
    clearDialogError: () => {},
    closeDialog: (target) => { closed.push(target); target.open = false; }
  });

  const event = { target: closeControl(dialog), prevented: false, preventDefault() { this.prevented = true; } };
  dialog.emit('click', event);

  assert.deepEqual(closed, [dialog]);
  assert.equal(dialog.open, false);
  assert.equal(event.prevented, true);
});

test('Escape uses the same close path and does not leave a native dialog open', () => {
  const dialog = new FakeDialog();
  const closed = [];
  bindDialogDismissals({ dialogs: [dialog], clearDialogError: () => {}, closeDialog: (target) => { closed.push(target); target.open = false; } });

  const event = { prevented: false, preventDefault() { this.prevented = true; } };
  dialog.emit('cancel', event);

  assert.deepEqual(closed, [dialog]);
  assert.equal(dialog.open, false);
  assert.equal(event.prevented, true);
});
