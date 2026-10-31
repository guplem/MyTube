// Long press on a touch screen: show what a button does. A mouse user reads a
// button's `title` as a tooltip on hover, but touch screens never show
// tooltips, so an icon button (or a short label such as "Watched") cannot
// explain itself there. Holding any button that has a title shows that same
// text in a hint snackbar, and the press then does not run the button.
// The rule for "held long enough, without moving" is isLongPress in
// src/shared/longPress.ts.

import { LONG_PRESS_MS, isLongPress } from "../shared/longPress";
import { showHint } from "./toast";

interface PressStart {
  button: HTMLButtonElement;
  x: number;
  y: number;
}

export function installLongPressHints(): void {
  let press: PressStart | null = null;
  let timer: number | null = null;
  // The button whose long press just showed a hint: its click is swallowed.
  let hinted: HTMLButtonElement | null = null;

  const cancel = (): void => {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
    press = null;
  };

  document.addEventListener(
    "pointerdown",
    (event: PointerEvent): void => {
      cancel();
      hinted = null;
      if (event.pointerType !== "touch") return;
      const target: Element | null = event.target as Element | null;
      const button: HTMLButtonElement | null =
        target?.closest<HTMLButtonElement>("button[title]") ?? null;
      if (!button || button.disabled || button.title === "") return;
      press = { button, x: event.clientX, y: event.clientY };
      timer = window.setTimeout((): void => {
        timer = null;
        if (!press) return;
        hinted = press.button;
        press = null;
        showHint(hinted.title);
      }, LONG_PRESS_MS);
    },
    { passive: true },
  );

  document.addEventListener(
    "pointermove",
    (event: PointerEvent): void => {
      if (!press) return;
      // Full hold time, so only the distance can fail: a moved finger is a
      // scroll or a swipe, not a press.
      if (
        !isLongPress(
          LONG_PRESS_MS,
          event.clientX - press.x,
          event.clientY - press.y,
        )
      ) {
        cancel();
      }
    },
    { passive: true },
  );
  document.addEventListener("pointerup", cancel, { passive: true });
  document.addEventListener("pointercancel", cancel, { passive: true });

  // The finger lifts after the hint and the browser still fires a click:
  // swallow it, so asking what a button does never also does it.
  document.addEventListener(
    "click",
    (event: MouseEvent): void => {
      if (!hinted) return;
      const target: Element | null = event.target as Element | null;
      if (target && hinted.contains(target)) {
        event.preventDefault();
        event.stopPropagation();
      }
      hinted = null;
    },
    { capture: true },
  );

  // Android opens a context menu on a long press; on a button it has nothing
  // to offer, and it would cover the hint.
  document.addEventListener("contextmenu", (event: MouseEvent): void => {
    const target: Element | null = event.target as Element | null;
    if (target?.closest("button[title]")) event.preventDefault();
  });
}
