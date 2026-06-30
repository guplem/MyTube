// A transient failure notification ("toast") shown at the bottom of the screen.
// Used when an optimistic action is rolled back: the card UI has already
// reverted to its previous state, so this just tells the user the action did
// not stick and offers a one-tap page refresh to reload the authoritative
// state from the server. Auto-dismisses after a few seconds.

let container: HTMLElement | null = null;

function toastContainer(): HTMLElement {
  if (container && document.body.contains(container)) return container;
  container = document.createElement("div");
  container.className = "toast-container";
  document.body.appendChild(container);
  return container;
}

// Shows a failure toast with the given message, a "Refresh" button (reloads the
// page to fetch fresh state) and a dismiss control.
export function showToast(message: string): void {
  const host = toastContainer();

  const toast = document.createElement("div");
  toast.className = "toast";
  toast.setAttribute("role", "status");

  const text = document.createElement("span");
  text.className = "toast-text";
  text.textContent = message;

  const refresh = document.createElement("button");
  refresh.type = "button";
  refresh.className = "toast-refresh";
  refresh.textContent = "Refresh";
  refresh.addEventListener("click", (): void => window.location.reload());

  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.className = "toast-dismiss";
  dismiss.setAttribute("aria-label", "Dismiss");
  dismiss.textContent = "✕";
  dismiss.addEventListener("click", (): void => toast.remove());

  toast.append(text, refresh, dismiss);
  host.appendChild(toast);

  window.setTimeout((): void => toast.remove(), 6000);
}
