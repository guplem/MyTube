// Background warm-up of the subscriptions feed. The app lands on Watch Later,
// and a cold feed load can take a long time (RSS for every expired channel), so
// every non-feed screen warms one background getFeedPage call for page 1 with
// the current filters. Opening the feed then consumes that stashed page and
// renders instantly; the server's per-channel RSS cache was refreshed as a side
// effect, so the following pages are fast too.
//
// The warm call NEVER passes forceRefresh — it reuses every live cache entry
// and fetches only the channels whose 30-minute entry expired, so it adds no
// steady-state fetch volume (and RSS costs no API quota; see PLAN.md section 5).
// The stash policy (single slot, fresh window, single use, cleared on failure)
// lives in src/shared/prefetchStore.ts; mutations invalidate the stash via
// optimistic() because the snapshot carries seen/dismissed/Watch Later flags.

import type { FeedPage, FeedPageOptions } from "../shared/feed";
import { createPrefetchStore } from "../shared/prefetchStore";
import { getFeedPage } from "./serverBridge";

// How long a prefetched page may be served after its load started. Short, so
// the flags on the snapshot never drift far even if a mutation somehow bypassed
// the optimistic() invalidation hook.
const FRESH_WINDOW_MS = 90_000;

const store = createPrefetchStore<FeedPageOptions, FeedPage>({
  load: (options): Promise<FeedPage> => getFeedPage(options),
  key: (options): string => JSON.stringify(options),
  now: (): number => Date.now(),
  maxAgeMs: FRESH_WINDOW_MS,
});

/** Warms feed page 1 in the background; no-op if a fresh warm is already up. */
export function warmFeedPage(options: FeedPageOptions): void {
  store.warm(options);
}

/** The prefetched page for these exact options, if fresh (single use), else null. */
export function takePrefetchedFeedPage(options: FeedPageOptions): Promise<FeedPage> | null {
  return store.take(options);
}

/** Drops the stashed page. Called on every optimistic mutation, because the
 *  snapshot's seen/dismissed/Watch Later flags may no longer match the server. */
export function invalidateFeedPrefetch(): void {
  store.invalidate();
}
