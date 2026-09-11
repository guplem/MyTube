// A transient notification ("toast") shown at the bottom of the screen.
//
// The default toast reports a failure: an optimistic action was rolled back,
// the card UI already shows its previous state, and the "Refresh" button
// reloads the page to pick the authoritative state up from the server.
//
// Pass an action to report something that worked instead, with a one-tap way
// to take it back (the sponsor skip does this with "Undo"). That toast is
// styled as a neutral notice, not a failure. Auto-dismisses after a few
// seconds either way.

let container: HTMLElement | null = null;

function toastContainer(): HTMLElement {
  if (container && document.body.contains(container)) return container;
  container = document.createElement("div");
  container.className = "toast-container";
  document.body.appendChild(container);
  return container;
}

/** A one-tap button on the toast, in place of the default "Refresh". */
export interface ToastAction {
  label: string;
  onAction: () => void;
}

// Shows a toast with the given message, one action button and a dismiss
// control. Without an action the toast is a failure notice with a "Refresh"
// button (reloads the page to fetch fresh state); with one it is a neutral
// notice whose button runs the action and closes the toast.
export function showToast(message: string, action?: ToastAction): void {
  const host = toastContainer();

  const toast = document.createElement("div");
  toast.className = action ? "toast toast--notice" : "toast";
  toast.setAttribute("role", "status");

  const text = document.createElement("span");
  text.className = "toast-text";
  text.textContent = message;

  const actionButton = document.createElement("button");
  actionButton.type = "button";
  actionButton.className = "toast-action";
  actionButton.textContent = action ? action.label : "Refresh";
  actionButton.addEventListener("click", (): void => {
    if (!action) {
      window.location.reload();
      return;
    }
    // Close first: the action can show a toast of its own, and two notices
    // about the same moment read as a bug.
    toast.remove();
    action.onAction();
  });

  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.className = "toast-dismiss";
  dismiss.setAttribute("aria-label", "Dismiss");
  dismiss.textContent = "✕";
  dismiss.addEventListener("click", (): void => toast.remove());

  toast.append(text, actionButton, dismiss);
  host.appendChild(toast);

  window.setTimeout((): void => toast.remove(), 6000);
}
