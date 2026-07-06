// The resume-position policy, shared so the player (browser) decides what to
// persist and the tests can pin the rules without a browser. The server store
// (src/server/progress.ts) stays dumb: it saves what it is given and treats
// <= 0 as "clear this video's position".

/** Positions inside the first seconds are not worth resuming — start over. */
const MIN_RESUME_SECONDS = 15;

/** Past this fraction of the video it counts as finished — start over. */
const FINISHED_FRACTION = 0.95;

/**
 * The playback position to persist for resume, in whole seconds, or 0 when
 * the stored position should be cleared: the user is at the very start (a
 * restart, not a session worth saving) or effectively done with the video.
 * A duration of 0 means "unknown" (the IFrame API reports 0 until the video's
 * metadata loads) and skips the finished check.
 */
export function progressToStore(positionSeconds: number, durationSeconds: number): number {
  if (!Number.isFinite(positionSeconds) || positionSeconds < MIN_RESUME_SECONDS) return 0;
  if (
    Number.isFinite(durationSeconds) &&
    durationSeconds > 0 &&
    positionSeconds >= durationSeconds * FINISHED_FRACTION
  ) {
    return 0;
  }
  return Math.floor(positionSeconds);
}
