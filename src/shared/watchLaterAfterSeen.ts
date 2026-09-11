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

/** One watched-toggle tap, as the call site sees it. */
export interface WatchLaterAfterSeenInput {
  /** The seen value this tap moves the video to. */
  seenTarget: boolean;
  /**
   * Membership as of this tap. An earlier tap that has not settled yet makes
   * this that tap's assumed value, not the server's.
   */
  wasSaved: boolean;
  /**
   * True only where the screen's un-mark restores the playlist entry, which is
   * the Watch Later screen alone.
   */
  restoresWatchLater: boolean;
}

/** Membership once the watched toggle reaches `seenTarget`. */
export function watchLaterAfterSeenToggle(
  tap: WatchLaterAfterSeenInput,
): boolean {
  if (tap.seenTarget) return false;
  return tap.restoresWatchLater || tap.wasSaved;
}
