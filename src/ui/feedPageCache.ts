// The feed's in-memory page cache (policy in src/shared/pageCache.ts). It does
// two jobs:
//
// 1. Warm-up. The app lands on Watch Later, and a cold feed load can take a long
//    time (RSS for every expired channel), so every non-feed screen starts one
//    background getFeedPage call for the page the feed will open on. Opening the
//    feed then serves that page and renders with no skeletons.
// 2. Keeping. Every page the feed actually showed is kept, so leaving the feed
//    for another tab or the player and coming back re-renders it instantly.
//
// A kept page is not a stale snapshot. The cards were built from the very Video
// objects the cache holds, and every toggle — on a card or in the player —
// mutates those same objects in place, so the entry updates itself. A page that
// was only warmed was never handed to anyone, so a flag change anywhere DOES
// make it stale: that is why a mutation calls dropUnservedFeedPages() and not a
// full clear.
//
// The warm call NEVER passes forceRefresh — it reuses every live cache entry and
// fetches only the channels whose 30-minute entry expired, so it adds no
// steady-state fetch volume (and RSS costs no API quota; see PLAN.md section 5).

import type { FeedPage, FeedPageOptions } from "../shared/feed";
import { createPageCache } from "../shared/pageCache";
import { getFeedPage } from "./serverBridge";

// Matches the server's 30-minute per-channel RSS cache (CHANNEL_VIDEOS_TTL_SECONDS
// in src/server/feed.ts): inside that window a refetch returns the same videos,
// so keeping the page loses no freshness. Past it, load again.
const FRESH_WINDOW_MS = 30 * 60_000;

// Enough for paging through the feed and coming back, small enough that the
// browser never holds a large slice of the 1000+ video list.
const MAX_PAGES = 8;

const cache = createPageCache<FeedPageOptions, FeedPage>({
  load: (options): Promise<FeedPage> => getFeedPage(options),
  // forceRefresh is normalized out of the key: a force-refreshed page is the
  // freshest possible answer for those filters, so a later normal request for
  // the same page must be served from it instead of fetching again.
  key: (options): string => JSON.stringify({ ...options, forceRefresh: false }),
  now: (): number => Date.now(),
  maxAgeMs: FRESH_WINDOW_MS,
  maxEntries: MAX_PAGES,
});

/** Loads a feed page in the background; no-op if a fresh one is already held. */
export function warmFeedPage(options: FeedPageOptions): void {
  cache.warm(options);
}

/** The kept page for these options, loading it on a miss. A hit resolves on the
 *  same task, so PagedVideoListView's skeletons never paint. */
export function loadFeedPage(options: FeedPageOptions): Promise<FeedPage> {
  return cache.use(options);
}

/** Throws every kept page away and loads this one fresh (the Force refresh
 *  button, whose options carry forceRefresh: true). */
export function forceReloadFeedPage(
  options: FeedPageOptions,
): Promise<FeedPage> {
  cache.clear();
  return cache.use(options);
}

/** Drops the pages nobody has seen yet. Called on every server mutation: their
 *  seen/dismissed/Watch Later/progress flags may no longer match the server. */
export function dropUnservedFeedPages(): void {
  cache.dropUnserved();
}
