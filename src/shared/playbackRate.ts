// The playback speed the viewer last chose: what a stored value means, and
// which speeds a picker offers. Kept out of src/ui/ so the rules are pinned by
// tests. The player reaches them through readStoredPlaybackRate
// (src/ui/playerPreferences.ts); the Settings screen calls them directly.

/** Normal speed. Also the answer for anything unreadable. */
export const DEFAULT_PLAYBACK_RATE: number = 1;

/** The speeds a picker offers, the same set YouTube's own speed menu offers. */
export const PLAYBACK_RATE_CHOICES: readonly number[] = [
  0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2,
];

/** Reads a stored speed. Anything unreadable, zero or negative falls back to
 *  normal speed: such a rate would freeze or reverse the player. */
export function parsePlaybackRate(stored: string): number {
  // Number, not parseFloat: parseFloat reads "1.5x" as 1.5, and a value with
  // trailing text is not a speed we wrote, so it must fall back like any other
  // unreadable value. The only writer is storePlaybackRate, which always writes
  // String(rate), so nothing readable is lost.
  const rate = Number(stored);
  return Number.isFinite(rate) && rate > 0 ? rate : DEFAULT_PLAYBACK_RATE;
}

/** The speeds to offer while `current` plays. YouTube's own speed menu can
 *  report a rate our list does not carry, and the player stores it, so add that
 *  rate in place. A picker that dropped it would show one speed and play
 *  another, then save the wrong one on the next change. The result is readonly
 *  because the common branch hands back PLAYBACK_RATE_CHOICES itself: a caller
 *  that sorted or pushed on it would change the constant for every later
 *  caller. */
export function playbackRateChoices(current: number): readonly number[] {
  if (PLAYBACK_RATE_CHOICES.includes(current)) return PLAYBACK_RATE_CHOICES;
  // Sort by value, not the default sort: the default compares the numbers as
  // text, which puts a two-digit rate before "2".
  return PLAYBACK_RATE_CHOICES.concat(current).sort((a, b) => a - b);
}
