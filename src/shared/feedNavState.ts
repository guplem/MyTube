// What the Feed nav button shows, decided by two things: the total of the last
// feed page that loaded this session (counted after every filter) and whether a
// page is in flight right now. Kept out of src/ui/ so the rule is pinned by
// tests.
//
// One value, not a set of flags. The pulse, the dim and the badge are looks of
// the same state, and the acceptance criterion is that they never show together;
// returning a single value makes "two at once" impossible to express.

export type FeedNavState =
  /** Nothing has loaded yet AND a page is in flight right now. The button
   *  pulses: opening the feed would sit on skeletons, and the wait is going to
   *  end on its own. It stays clickable. */
  | "loading"
  /** No feed page has loaded yet this session and none is in flight — the load
   *  failed, or has not started. The button is dimmed, still, to say the feed
   *  is not ready without promising a page that is coming. Still clickable. */
  | "pending"
  /** The last loaded page still has videos: something is waiting. */
  | "waiting"
  /** The last loaded page has nothing left — the inbox is empty. */
  | "empty";

/**
 * The Feed nav button's state. `lastLoadedTotal` is the post-filter total of the
 * last feed page that loaded, or null when none has loaded this session. Only a
 * successful load moves it off null: a failed load has loaded nothing, and an
 * emptied feed is still a loaded feed, so it never goes back to null.
 *
 * `isLoading` is whether a feed page request is in flight right now. It only
 * decides between the two not-loaded-yet looks; once a page has loaded, the
 * loaded state wins, because the last total is still what the feed will show.
 */
export function feedNavState(
  lastLoadedTotal: number | null,
  isLoading: boolean,
): FeedNavState {
  if (lastLoadedTotal === null) return isLoading ? "loading" : "pending";
  return lastLoadedTotal > 0 ? "waiting" : "empty";
}
