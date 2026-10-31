// When a held touch counts as a long press. The browser layer
// (src/ui/longPressHint.ts) measures the hold and the movement; this rule
// decides, so tests can pin it without a browser.

/** Half a second: longer than any normal tap, short enough to feel quick. */
export const LONG_PRESS_MS: number = 500;

/** A finger wobbles a little while it holds still; more than this is a drag. */
export const LONG_PRESS_SLOP_PX: number = 10;

export function isLongPress(
  heldMs: number,
  movedX: number,
  movedY: number,
): boolean {
  return (
    heldMs >= LONG_PRESS_MS && Math.hypot(movedX, movedY) <= LONG_PRESS_SLOP_PX
  );
}
