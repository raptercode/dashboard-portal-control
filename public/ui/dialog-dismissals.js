/**
 * Bind dismissal once at the dialog boundary. A click can originate from the
 * SVG inside a close button, so delegating it avoids depending on whichever
 * nested element the browser reports as the event target.
 */
export function bindDialogDismissals({ dialogs, closeDialog, clearDialogError }) {
  for (const dialog of dialogs) {
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      void closeDialog(dialog);
    });
    dialog.addEventListener('close', () => clearDialogError(dialog));
    dialog.addEventListener('click', (event) => {
      const control = event.target?.closest?.('[data-dialog-close]');
      if (!control || !dialog.contains(control)) return;
      event.preventDefault();
      void closeDialog(dialog);
    });
  }
}
