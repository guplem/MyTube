// The playback speed the viewer last chose, as it is stored and as a picker
// offers it. Shared because two places read the same value: the player, which
// applies it to every video, and the Settings screen, which shows and changes
// it. One rule here keeps them from disagreeing on what a stored value means.

/** Normal speed. Also the answer for anything unreadable. */
export const DEFAULT_PLAYBACK_RATE = 1;

/** The speeds a picker offers, the same set YouTube's own speed menu offers. */
export const PLAYBACK_RATE_CHOICES: number[] = [
  0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2,
];

/** Reads a stored speed. Anything unreadable, zero or negative falls back to
 *  normal speed: such a rate would freeze or reverse the player. */
export function parsePlaybackRate(stored: string): number {
  const rate = Number.parseFloat(stored);
  return Number.isFinite(rate) && rate > 0 ? rate : DEFAULT_PLAYBACK_RATE;
}

/** The speeds to offer while `current` plays. YouTube's own speed menu can
 *  report a rate our list does not carry, and the player stores it, so add that
 *  rate in place. A picker that dropped it would show one speed and play
 *  another, then save the wrong one on the next change. */
export function playbackRateChoices(current: number): number[] {
  if (PLAYBACK_RATE_CHOICES.includes(current)) return PLAYBACK_RATE_CHOICES;
  return PLAYBACK_RATE_CHOICES.concat(current).sort((a, b) => a - b);
}
