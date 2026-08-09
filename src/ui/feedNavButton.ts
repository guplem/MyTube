// The Feed nav button's look: pulsing while the session's first page loads, a
// still dim once nothing is in flight and nothing loaded, then a blue dot while
// the feed still has videos waiting. The rule that picks one of those is
// feedNavState (src/shared/feedNavState.ts); this module owns the two numbers it
// reads and paints the result.
//
// It lives outside main.ts so optimistic() can repaint it after every server
// mutation without a circular import. That repaint is what makes the dot go out
// the moment the user deals with the last waiting video, instead of lingering
// until the page is reloaded.

import { feedNavState, type FeedNavState } from "../shared/feedNavState";
import { remainingFeedTotal } from "../shared/feedInclusion";
import { keptFeedPage } from "./feedPageCache";
import { feedFlagFilters } from "./feedFilters";

// The feed's post-filter total as the button last knew it, or null while nothing
// has loaded this session. Module state, not URL state: it describes what this
// session has loaded, not what any screen shows, so it must survive every
// navigation and belongs in no shared link.
//
// Nothing ever writes it back to null: a load that fails has loaded nothing, and
// an emptied feed is still a loaded feed. Dropping the kept page leaves it alone
// too, so it keeps whatever the last correction below made of it.
let lastFeedTotal: number | null = null;

// Feed page requests in flight right now, counted because two can overlap (a
// background warm-up and the feed screen's own load). Only the count decides the
// pulse, so the pulse stops exactly when the app stops waiting on the server —
// including when the load FAILS, which is what keeps the still dim honest.
let feedLoadsInFlight = 0;

/** Wraps a feed page load so the Feed nav button pulses for as long as it runs.
 *  Returns the same promise, so the caller's own then/catch is untouched: the
 *  tracking chain here handles both outcomes only to count them down. */
export function trackFeedLoad<T>(load: Promise<T>): Promise<T> {
  feedLoadsInFlight += 1;
  applyFeedNavState();
  const finish = (): void => {
    feedLoadsInFlight -= 1;
    applyFeedNavState();
  };
  load.then(finish, finish);
  return load;
}

/** Records a loaded feed page's total and repaints the button. Both load paths
 *  call it: the background warm-up a non-feed screen starts (see render in
 *  main.ts) and the feed screen's own page loads (onPageLoaded in showFeed).
 *  Neither covers the other — the warm-up does not run while the feed is open,
 *  and onPageLoaded only fires while the feed screen is mounted. */
export function recordLoadedFeedTotal(total: number): void {
  lastFeedTotal = total;
  applyFeedNavState();
}

// What the Feed tab is called in each state, for screen readers.
const FEED_NAV_LABELS: Record<FeedNavState, string> = {
  loading: "Feed, loading",
  pending: "Feed, not loaded yet",
  waiting: "Feed, new videos waiting",
  empty: "Feed",
};

// Paints the button's states from the single value that decides them, so the
// pulse, the dim and the dot can never show together.
//
// The total is re-derived from the kept feed page on every paint, never
// remembered from the load alone: the user's own toggles change that page's
// Video objects in place (ADR 0008), and a video they just dismissed, saved or
// marked watched no longer counts. Re-deriving instead of counting deltas means
// a rolled-back mutation, a repeated toggle and a re-render all land on the same
// number. When no page is kept the last derived value stands, because there is
// nothing to derive from and it is still the best answer we have.
//
// Not guarded on navigationGeneration, unlike a screen paint. That counter drops
// the paint of a screen the user has left, and it bumps on EVERY navigation; the
// nav button belongs to no screen, so guarding it would strand the dim whenever
// the user changes tab while the background load is in flight — the exact case
// the dim exists for. The cost is that a load started under the old filters can
// report its total after a filter change. That is acceptable for a dot that only
// says "something is waiting", and the next load corrects it.
export function applyFeedNavState(): void {
  const page = keptFeedPage();
  if (page)
    lastFeedTotal = remainingFeedTotal(
      page.total,
      page.videos,
      feedFlagFilters(),
    );
  const feedButton = document.querySelector<HTMLButtonElement>(
    '.app-nav button[data-view="feed"]',
  );
  if (!feedButton) return;
  const state = feedNavState(lastFeedTotal, feedLoadsInFlight > 0);
  feedButton.classList.toggle("nav-loading", state === "loading");
  feedButton.classList.toggle("nav-pending", state === "pending");
  feedButton.classList.toggle("nav-waiting", state === "waiting");
  // The pulse and the dim are opacity and the dot is an empty ::after, so none of
  // them reaches a screen reader. Name the state from the same value that draws
  // it, so the two can never disagree.
  feedButton.setAttribute("aria-label", FEED_NAV_LABELS[state]);
}
