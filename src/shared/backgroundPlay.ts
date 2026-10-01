// Background play: YouTube's embedded player pauses itself when the page goes
// hidden (the phone locks, or the viewer switches apps). The browser itself
// still allows playback, so the player can call playVideo() to undo that one
// pause. This rule decides which pauses are YouTube's: only a pause that lands
// close to the moment the page hid. A pause long before (on screen) or long
// after (from the lock-screen controls) is the viewer's, and stays.

export const BACKGROUND_PAUSE_WINDOW_MS = 1500;

// Both times are Date.now() values. The order does not matter: the embed can
// pause before or after the browser fires visibilitychange.
export function shouldResumeAfterHide(
  hiddenAtMs: number | null,
  pausedAtMs: number | null,
): boolean {
  if (hiddenAtMs === null || pausedAtMs === null) return false;
  return Math.abs(pausedAtMs - hiddenAtMs) <= BACKGROUND_PAUSE_WINDOW_MS;
}
