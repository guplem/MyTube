// What the Feed nav button shows, decided by the one thing it depends on: the
// total of the last feed page that loaded this session, counted after every
// filter. Kept out of src/ui/ so the rule is pinned by tests.
//
// One value, not a pair of flags. The dimmed look and the badge are two looks of
// the same state, and the acceptance criterion is that they never show together;
// returning a single value makes "both at once" impossible to express.

export type FeedNavState =
  /** No feed page has loaded yet this session, so opening the feed may sit on
   *  skeletons while the server fetches RSS. The button is dimmed to say so,
   *  and stays clickable. */
  | "pending"
  /** The last loaded page still has videos: something is waiting. */
  | "waiting"
  /** The last loaded page has nothing left — the inbox is empty. */
  | "empty";

/**
 * The Feed nav button's state. `lastLoadedTotal` is the post-filter total of the
 * last feed page that loaded, or null when none has loaded this session. Only a
 * successful load moves it off null: a failed load has loaded nothing, and an
 * emptied feed is still a loaded feed, so it leaves "pending" for good.
 */
export function feedNavState(lastLoadedTotal: number | null): FeedNavState {
  if (lastLoadedTotal === null) return "pending";
  return lastLoadedTotal > 0 ? "waiting" : "empty";
}
