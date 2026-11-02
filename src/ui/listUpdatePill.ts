// What a list shows while it holds a saved copy (ADR 0011). While the fresh
// list loads, a thin loading bar runs across the top of the page. When the
// fresh list would move cards, a small notice counts down a few seconds and
// then shows it. "Show now" skips the wait. "Cancel" stops the countdown and
// leaves a "Show" button, so the user decides when the cards move.
//
// The notice sits in a sticky row of zero height at the top of the list, so
// it overlays the first cards and follows the scroll, but never pushes a card.
// The bar is fixed to the top of the page. Both live INSIDE the list's own
// element, so a screen change, which replaces #app, takes them away with the
// list.

import {
  LIST_UPDATE_COUNTDOWN_SECONDS,
  listUpdateCountdownLabel,
} from "../shared/listSnapshot";
import { countLabel } from "../shared/countLabel";

export interface ListUpdatePill {
  /** The zero-height row to place just above the cards. */
  element: HTMLElement;
  /** The fresh list is loading: the bar runs, the notice hides. */
  showUpdating: () => void;
  /** The fresh list is ready and moves cards. The notice counts down, then
   *  calls `onShow`. `added` is the count of videos the copy did not show. */
  showCountdown: (added: number, onShow: () => void) => void;
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
  text.className = "list-update-pill-text";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "list-update-pill-button";
  const secondary = document.createElement("button");
  secondary.type = "button";
  secondary.className =
    "list-update-pill-button list-update-pill-button--secondary";
  element.append(text, secondary, button);

  let onClick: (() => void) | null = null;
  let onSecondary: (() => void) | null = null;
  let timer: number | null = null;

  function stopCountdown(): void {
    if (timer === null) return;
    window.clearInterval(timer);
    timer = null;
  }

  button.addEventListener("click", (): void => {
    const action = onClick;
    stopCountdown();
    element.hidden = true;
    action?.();
  });
  secondary.addEventListener("click", (): void => {
    onSecondary?.();
  });

  function show(message: string, label: string, action: () => void): void {
    stopCountdown();
    text.textContent = message;
    button.textContent = label;
    onClick = action;
    onSecondary = null;
    secondary.hidden = true;
    bar.hidden = true;
    element.hidden = false;
  }

  function showCountdown(added: number, onShow: () => void): void {
    show(
      listUpdateCountdownLabel(added, LIST_UPDATE_COUNTDOWN_SECONDS),
      "Show now",
      onShow,
    );
    secondary.textContent = "Cancel";
    secondary.hidden = false;
    onSecondary = (): void =>
      show(
        added > 0
          ? countLabel(added, "new video", "new videos")
          : "This list changed",
        "Show",
        onShow,
      );
    let secondsLeft: number = LIST_UPDATE_COUNTDOWN_SECONDS;
    timer = window.setInterval((): void => {
      // A screen change removes the list, and with it this notice. The
      // callers also check that their list still stands before they paint.
      if (!anchor.isConnected) {
        stopCountdown();
        return;
      }
      secondsLeft -= 1;
      if (secondsLeft > 0) {
        text.textContent = listUpdateCountdownLabel(added, secondsLeft);
        return;
      }
      stopCountdown();
      element.hidden = true;
      onShow();
    }, 1000);
  }

  return {
    element: anchor,
    showUpdating: (): void => {
      stopCountdown();
      onClick = null;
      element.hidden = true;
      bar.hidden = false;
    },
    showCountdown,
    showFailed: (onRetry: () => void): void =>
      show("Couldn't update this list", "Retry", onRetry),
    hide: (): void => {
      stopCountdown();
      onClick = null;
      element.hidden = true;
      bar.hidden = true;
    },
  };
}
