// The player's place in its queue, for the counter between the previous and
// next buttons. Kept apart from the player so the edge cases stay testable.

/** "3 / 24" for the third of 24 videos, or "" when the queue holds one video
 *  or none: both buttons are off then, and the counter would only add noise. */
export function queuePosition(index: number, length: number): string {
  if (length <= 1) return "";
  const position: number = Math.min(Math.max(index, 0), length - 1) + 1;
  return position + " / " + length;
}
