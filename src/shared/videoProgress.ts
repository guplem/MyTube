// The resume-position policy, shared so the player (browser) decides what to
// persist and the tests can pin the rules without a browser. The server store
// (src/server/progress.ts) stays dumb: it saves what it is given, keeps the
// PROGRESS_FINISHED marker, and treats every other non-positive value as
// "clear this video's position".

/** Positions inside the first seconds are not worth resuming — start over. */
const MIN_RESUME_SECONDS = 15;

/** Past this fraction of the video it counts as finished. */
const FINISHED_FRACTION = 0.95;

/**
 * Stored marker for a video watched to (effectively) the end. Kept instead of
 * deleting the entry so cards can show a full progress bar; the player still
 * restarts a finished video from the top. -1 can never collide with a real
 * position, and the store treats every other non-positive value as "clear".
 */
export const PROGRESS_FINISHED = -1;

/**
 * The watched fraction of a video (0..1] for the card's progress bar, or null
 * when there is nothing to show: no stored position, or no known duration to
 * divide by (the duration lookup is best-effort). A finished video is a full
 * bar regardless of duration — there is nothing to divide. Clamped to 1 so a
 * stale or rounded position never overflows the thumbnail.
 */
export function progressFraction(
  progressSeconds: number | undefined,
  durationSeconds: number | undefined,
): number | null {
  if (progressSeconds === PROGRESS_FINISHED) return 1;
  if (!progressSeconds || progressSeconds <= 0) return null;
  if (!durationSeconds || durationSeconds <= 0) return null;
  return Math.min(1, progressSeconds / durationSeconds);
}

/**
 * Whether the UI should nudge "mark this watched": true when the position
 * says the video is effectively finished — the stored PROGRESS_FINISHED
 * marker, or a (live playback) position past the same FINISHED_FRACTION the
 * store uses — so the nudge and the store can never disagree about what
 * "finished" means. The caller decides what position to pass: cards use the
 * stored progressSeconds (only the marker can reach the fraction there,
 * since progressToStore converts anything past it), the player also polls
 * the live playback position so the nudge appears the moment the threshold
 * is crossed. False when there is nothing to judge (no position, or a real
 * position with no known duration). Whether the video is already in the
 * history is the caller's concern, not this policy's.
 */
export function shouldSuggestWatched(
  progressSeconds: number | undefined,
  durationSeconds: number | undefined,
): boolean {
  const fraction = progressFraction(progressSeconds, durationSeconds);
  return fraction !== null && fraction >= FINISHED_FRACTION;
}

/**
 * The playback position to persist, in whole seconds; PROGRESS_FINISHED when
 * the user is effectively done with the video (kept, so the card shows a full
 * bar); or 0 when the stored position should be cleared (the very start — a
 * restart, not a session worth saving). The finished check runs first so a
 * fully-watched tiny video counts as finished, not "too early to resume". A
 * duration of 0 means "unknown" (the IFrame API reports 0 until the video's
 * metadata loads) and skips the finished check.
 */
export function progressToStore(
  positionSeconds: number,
  durationSeconds: number,
): number {
  if (!Number.isFinite(positionSeconds) || positionSeconds <= 0) return 0;
  if (
    Number.isFinite(durationSeconds) &&
    durationSeconds > 0 &&
    positionSeconds >= durationSeconds * FINISHED_FRACTION
  ) {
    return PROGRESS_FINISHED;
  }
  if (positionSeconds < MIN_RESUME_SECONDS) return 0;
  return Math.floor(positionSeconds);
}
