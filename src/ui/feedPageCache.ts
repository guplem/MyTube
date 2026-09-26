// The feed's in-memory page cache (single-slot policy in src/shared/pageCache.ts,
// keep-or-drop policy in src/shared/feedPageStaleness.ts). It does two jobs:
//
// 1. Warm-up. The app lands on Watch Later, and a cold feed load can take a long
//    time (RSS for every expired channel), so every non-feed screen starts one
//    background getFeedPage call for the page the feed will open on. Opening the
//    feed then serves that load instead of starting its own, and the page's
//    `total` is what tells the Feed nav button the feed is ready (see
//    applyFeedNavState in src/ui/main.ts).
// 2. Keeping ONE page. The page the feed is showing is kept, so leaving the feed
//    for another tab or the player and coming back re-renders it instantly.
//
// Exactly one page is held on purpose. A page carries a snapshot: its `total`,
// which videos are on it, and each video's flags. Keeping several lets two
// entries hold two Video objects for the same video and disagree, and lets a
// page nobody is looking at go on reporting a `total` the server has moved past.
// Holding only the page on show means paging away and back re-fetches, so the
// list self-heals and the count line stays honest.
//
// The page on show does NOT go stale under the user's own toggles: its cards
// were built from the very Video objects the cache holds, so a toggle updates
// both at once. That is what keeps a card in place, dimmed, instead of vanishing
// under the finger. A mutation made anywhere else works on a different copy of
// the same video, so it drops the page (see dropStaleFeedPage below).
//
// The warm-up NEVER passes forceRefresh — it reuses every live cache entry and
// fetches only the channels whose 30-minute entry expired, so it adds no
// steady-state fetch volume (and RSS costs no API quota; see PLAN.md section 5).

import type { FeedPage, FeedPageOptions } from "../shared/feed";
import type { Video } from "../shared/video";
import { createPageCache } from "../shared/pageCache";
import {
  feedPageSurvivesMutation,
  type FeedMutationScreen,
} from "../shared/feedPageStaleness";
import { getFeedPage } from "./serverBridge";

// The same length as the server's per-channel RSS cache
// (CHANNEL_VIDEOS_TTL_SECONDS in src/server/feed.ts), but NOT the same window:
// the server's starts when it last fetched that channel, ours when our page load
// started. So a kept page can trail the server by up to one window. That is the
// trade-off we take — new uploads wait a little, and Force refresh is the way
// out.
const FRESH_WINDOW_MS = 30 * 60_000;

const cache = createPageCache<FeedPageOptions, FeedPage>({
  load: (options): Promise<FeedPage> => getFeedPage(options),
  // forceRefresh is normalized out of the key: a force-refreshed page is the
  // freshest possible answer for those filters, so a later normal request for
  // the same page must be served from it instead of fetching again.
  key: (options): string => JSON.stringify({ ...options, forceRefresh: false }),
  now: (): number => Date.now(),
  maxAgeMs: FRESH_WINDOW_MS,
});

/** The kept page for these options, loading it on a miss. A hit that already
 *  resolved renders with no skeletons; a hit on a load still in flight shows
 *  them, like any other load. Also the warm-up call: a non-feed screen asks for
 *  the page in the background and reads its `total` for the Feed nav badge. */
export function loadFeedPage(options: FeedPageOptions): Promise<FeedPage> {
  return cache.use(options);
}

/** Throws the kept page away and loads this one fresh (the Force refresh
 *  button, whose options carry forceRefresh: true). */
export function forceReloadFeedPage(
  options: FeedPageOptions,
): Promise<FeedPage> {
  cache.clear();
  return cache.use(options);
}

/** True when this exact array IS the kept page's Video array, right now — so
 *  mutating one of its videos updates the kept page along with the screen.
 *
 *  Always ask this at the moment of the mutation instead of remembering the
 *  array when it was handed over. The kept page can be swapped out under a
 *  screen that still holds the old array: a player is not the feed, so every
 *  in-player navigation warms the feed page, and that warm reloads once the
 *  30-minute window passes or the key changes (beforeDate defaults to a date
 *  computed from today, so it moves at midnight). The old array would still
 *  look like the kept page to anyone tracking it by hand. */
export function isKeptFeedPage(videos: Video[]): boolean {
  return cache.resolved()?.videos === videos;
}

/** The page held right now, or null when none is (nothing kept, still loading,
 *  or the load failed). Read by the Feed nav button, which re-derives its count
 *  from this page's own Video objects on every paint — the same objects the
 *  user's toggles change, so a video just dealt with stops counting at once. */
export function keptFeedPage(): FeedPage | null {
  return cache.resolved();
}

// The screen a mutation would be made on right now. Reported by the router; see
// render() and showPlayer() in src/ui/main.ts.
let currentScreen: FeedMutationScreen = {
  inFeedSection: false,
  isPlayer: false,
  playerQueueIsFeedPage: false,
};

export function setFeedMutationScreen(screen: FeedMutationScreen): void {
  currentScreen = screen;
}

/** Drops the kept page whatever the router reports. For a write made on a
 *  Video object that may not be the kept page's own, even though the screen on
 *  show says it would be (a toast action that outlives its card). */
export function dropFeedPage(): void {
  cache.clear();
}

/** Drops the kept page unless the mutation just changed that page's own Video
 *  objects. Called by every server write (optimistic() and the player's
 *  progress save). */
export function dropStaleFeedPage(): void {
  if (!feedPageSurvivesMutation(currentScreen)) cache.clear();
}
