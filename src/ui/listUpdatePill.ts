// What a list shows while it holds a saved copy (ADR 0011). While the fresh
// list loads, a thin loading bar runs across the top of the page. When the
// fresh list would move cards, a snackbar at the bottom (showStickyToast in
// src/ui/toast.ts) counts down a few seconds and then shows it. "Show now"
// skips the wait. "Cancel" stops the countdown and leaves a "Show" button, so
// the user decides when the cards move.
//
// The bar lives INSIDE the list's own element, so a screen change, which
// replaces #app, takes it away with the list. The snackbar lives in the toast
// container on <body>, so it outlives the list: a one-second check closes it
// once the list's element has left the page. A list that has already left
// (the user opened a video from the copy) opens no snackbar at all.

import {
  LIST_UPDATE_COUNTDOWN_SECONDS,
  listUpdateCountdownLabel,
} from "../shared/listSnapshot";
import { countLabel } from "../shared/countLabel";
import { showStickyToast, type StickyToast } from "./toast";

export interface ListUpdatePill {
  /** The zero-height row to place just above the cards. */
  element: HTMLElement;
  /** The fresh list is loading: the bar runs, the snackbar closes. */
  showUpdating: () => void;
  /** The fresh list is ready and moves cards. The snackbar counts down, then
   *  calls `onShow`. `added` is the count of videos the copy did not show. */
  showCountdown: (added: number, onShow: () => void) => void;
  /** The fresh list failed to load; the button tries again. */
  showFailed: (onRetry: () => void) => void;
  hide: () => void;
}

export function createListUpdatePill(): ListUpdatePill {
  const anchor = document.createElement("div");
  anchor.className = "list-update-anchor";

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

  let toast: StickyToast | null = null;
  let timer: number | null = null;
  // Counts down while above 0; null once nothing counts (Cancel, Retry).
  let secondsLeft: number | null = null;
  let onTimeUp: (() => void) | null = null;
  let lastAdded = 0;

  function closeToast(): void {
    if (timer !== null) window.clearInterval(timer);
    timer = null;
    secondsLeft = null;
    toast?.close();
    toast = null;
  }

  function tick(): void {
    if (!anchor.isConnected) {
      closeToast();
      return;
    }
    if (secondsLeft === null) return;
    secondsLeft -= 1;
    if (secondsLeft > 0) {
      toast?.setMessage(listUpdateCountdownLabel(lastAdded, secondsLeft));
      return;
    }
    const action = onTimeUp;
    closeToast();
    action?.();
  }

  function open(message: string): StickyToast {
    bar.hidden = true;
    if (!toast) toast = showStickyToast(message, []);
    // The check runs while the snackbar is open, counting or not, so a
    // "Show" left after Cancel also closes with its list.
    if (timer === null) timer = window.setInterval(tick, 1000);
    return toast;
  }

  function showCountdown(added: number, onShow: () => void): void {
    const run = (): void => {
      closeToast();
      onShow();
    };
    if (!anchor.isConnected) {
      run();
      return;
    }
    lastAdded = added;
    secondsLeft = LIST_UPDATE_COUNTDOWN_SECONDS;
    onTimeUp = run;
    open("").update(listUpdateCountdownLabel(added, secondsLeft), [
      {
        label: "Cancel",
        onAction: (): void => {
          secondsLeft = null;
          toast?.update(
            added > 0
              ? countLabel(added, "new video", "new videos")
              : "This list changed",
            [{ label: "Show", onAction: run }],
          );
        },
      },
      { label: "Show now", onAction: run },
    ]);
  }

  return {
    element: anchor,
    showUpdating: (): void => {
      closeToast();
      bar.hidden = false;
    },
    showCountdown,
    showFailed: (onRetry: () => void): void => {
      if (!anchor.isConnected) return;
      secondsLeft = null;
      open("").update("Couldn't update this list", [
        {
          label: "Retry",
          onAction: (): void => {
            closeToast();
            onRetry();
          },
        },
      ]);
    },
    hide: (): void => {
      closeToast();
      bar.hidden = true;
    },
  };
}
