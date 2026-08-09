// Does a video the feed already loaded still belong there, after the user
// changed one of its flags? Pure policy, kept out of src/ui/ so the rule is
// pinned by tests.
//
// This is the mirror of the flag filters getFeedPage applies server-side (see
// src/server/main.ts). Only the three flags the user can toggle are here: the
// date and Shorts filters read publishedAt and durationSeconds, which no card
// action changes, so a video that passed them at load time passes them forever.
//
// It exists because the feed's total is a server number the browser cannot
// recompute: the loaded page is one slice of a 1000+ video list. So the total is
// corrected by what we CAN see — the videos on the kept page whose flags the
// user has since changed — which is exactly what makes the Feed nav dot go out
// the moment the last waiting video is dealt with.

/** The feed's flag filters, as the user's toggles have them right now. */
export interface FeedFlagFilters {
  hideViewed: boolean;
  hideDismissed: boolean;
  hideSaved: boolean;
}

/** The part of a Video these filters read (all optional flags read as false). */
export interface FeedVideoFlags {
  seen: boolean;
  dismissed?: boolean;
  inWatchLater?: boolean;
}

/** True when the feed would still show this video under these filters. */
export function belongsInFeed(
  video: FeedVideoFlags,
  filters: FeedFlagFilters,
): boolean {
  if (filters.hideViewed && video.seen) return false;
  if (filters.hideDismissed && video.dismissed) return false;
  if (filters.hideSaved && video.inWatchLater) return false;
  return true;
}

/**
 * The feed's total after the user's changes to the videos on the loaded page.
 * `total` is what the server reported for that page's load; each video on the
 * page that no longer belongs takes one off it. Videos on other pages are
 * untouched, which is right: nothing here has changed them.
 *
 * Floored at 0, so the nav button can never be asked to show a negative count.
 */
export function remainingFeedTotal(
  total: number,
  pageVideos: readonly FeedVideoFlags[],
  filters: FeedFlagFilters,
): number {
  const dealtWith = pageVideos.filter(
    (video) => !belongsInFeed(video, filters),
  ).length;
  return Math.max(0, total - dealtWith);
}
