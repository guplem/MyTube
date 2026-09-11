// Where the watched toggle leaves Watch Later membership. Pure policy, kept out
// of src/ui/ so the rule is pinned by tests.
//
// Marking watched drops the video from Watch Later server-side (markVideoSeen in
// src/server/main.ts), so the browser mirrors that drop on the Video it holds.
// The Watch Later screen un-marks through undoMarkVideoSeen, which puts the
// playlist entry back; every other screen un-marks without touching membership.
//
// It exists because two call sites need the same answer: the card toggle in
// src/ui/main.ts and the player's watched button in src/ui/playerView.ts. Both
// must also UNDO it when the request fails, and the Video object is shared with
// the kept feed page (ADR 0008), so one wrong answer leaks to every screen.

/**
 * Membership once the watched toggle reaches `seenTarget`.
 *
 * `wasSaved` is the membership read before this tap mutated anything.
 * `restoresWatchLater` is the screen's own answer: true only where un-marking
 * restores the playlist entry (the Watch Later screen).
 */
export function watchLaterAfterSeenToggle(
  seenTarget: boolean,
  wasSaved: boolean,
  restoresWatchLater: boolean,
): boolean {
  if (seenTarget) return false;
  return restoresWatchLater || wasSaved;
}
