// The small notice that floats over a list while it shows a saved copy
// (ADR 0011). It says "Updating…" while the fresh list loads. When the fresh
// list would move cards, it offers a button to show it, so nothing moves
// until the user asks.
//
// It sits in a sticky row of zero height at the top of the list, so it
// overlays the first cards and follows the scroll, but never pushes a card.
// It lives INSIDE the list's own element, so a screen change, which replaces
// #app, takes it away with the list.

export interface ListUpdatePill {
  /** The zero-height row to place just above the cards. */
  element: HTMLElement;
  /** The fresh list is loading. */
  showUpdating: () => void;
  /** The fresh list is ready; the button shows it. */
  showReady: (label: string, onShow: () => void) => void;
  /** The fresh list failed to load; the button tries again. */
  showFailed: (onRetry: () => void) => void;
  hide: () => void;
}

export function createListUpdatePill(): ListUpdatePill {
  const anchor = document.createElement("div");
  anchor.className = "list-update-anchor";
  const element = document.createElement("div");
  element.className = "list-update-pill";
  element.setAttribute("role", "status");
  element.hidden = true;
  anchor.appendChild(element);

  const text = document.createElement("span");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "list-update-pill-button";
  element.append(text, button);

  let onClick: (() => void) | null = null;
  button.addEventListener("click", (): void => {
    const action = onClick;
    element.hidden = true;
    action?.();
  });

  function show(
    message: string,
    label: string,
    action: (() => void) | null,
  ): void {
    text.textContent = message;
    button.textContent = label;
    button.hidden = action === null;
    onClick = action;
    element.hidden = false;
  }

  return {
    element: anchor,
    showUpdating: (): void => show("Updating…", "", null),
    showReady: (label: string, onShow: () => void): void =>
      show(label, "Show", onShow),
    showFailed: (onRetry: () => void): void =>
      show("Couldn't update this list", "Retry", onRetry),
    hide: (): void => {
      onClick = null;
      element.hidden = true;
    },
  };
}
