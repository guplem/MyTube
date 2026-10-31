// What a list shows while it holds a saved copy (ADR 0011). While the fresh
// list loads, a thin loading bar runs across the top of the page. When the
// fresh list would move cards, a small notice offers a button to show it, so
// nothing moves until the user asks.
//
// The notice sits in a sticky row of zero height at the top of the list, so
// it overlays the first cards and follows the scroll, but never pushes a card.
// The bar is fixed to the top of the page. Both live INSIDE the list's own
// element, so a screen change, which replaces #app, takes them away with the
// list.

export interface ListUpdatePill {
  /** The zero-height row to place just above the cards. */
  element: HTMLElement;
  /** The fresh list is loading: the bar runs, the notice hides. */
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

  const bar = document.createElement("div");
  bar.className = "list-loading-bar";
  bar.setAttribute("role", "progressbar");
  bar.setAttribute("aria-label", "Updating this list");
  bar.hidden = true;
  for (const length of ["long", "short"]) {
    const line = document.createElement("div");
    line.className = "list-loading-line list-loading-line--" + length;
    bar.appendChild(line);
  }
  anchor.appendChild(bar);

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

  function show(message: string, label: string, action: () => void): void {
    text.textContent = message;
    button.textContent = label;
    onClick = action;
    bar.hidden = true;
    element.hidden = false;
  }

  return {
    element: anchor,
    showUpdating: (): void => {
      onClick = null;
      element.hidden = true;
      bar.hidden = false;
    },
    showReady: (label: string, onShow: () => void): void =>
      show(label, "Show", onShow),
    showFailed: (onRetry: () => void): void =>
      show("Couldn't update this list", "Retry", onRetry),
    hide: (): void => {
      onClick = null;
      element.hidden = true;
      bar.hidden = true;
    },
  };
}
