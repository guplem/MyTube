// Does a server mutation leave the kept feed page correct, or must the page be
// thrown away? Pure policy, kept out of src/ui/ so both answers are pinned by
// tests (src/ui/feedPageCache.ts wires it to the router).
//
// The rule is object identity. The kept page holds Video objects; a card or a
// player that mutates one of THOSE objects updates the page along with the
// screen. A screen working on its own copies of the same videos updates only the
// copies, and the kept page is then wrong.

/** The screen a mutation was made on, described in the terms this policy needs. */
export interface FeedMutationScreen {
  /** The screen belongs to the feed nav section: the feed list, or a player
   *  opened from the feed. */
  inFeedSection: boolean;
  /** A player is mounted (rather than a list screen). */
  isPlayer: boolean;
  /** The mounted player's queue IS the kept feed page's own Video array right
   *  now. Two ways it is false. The queue can be a copy from the start: browser
   *  back/forward restores it through google.script.history, which serializes it
   *  across the Apps Script iframe, and a forward navigation with no queue
   *  rebuilds a fresh one. Or the kept page can be swapped out later, under a
   *  player still holding the old array. So the caller must ask the cache at
   *  mutation time (isKeptFeedPage in src/ui/feedPageCache.ts), never set this
   *  once at hand-over. */
  playerQueueIsFeedPage: boolean;
}

/** True when the mutation changed the kept feed page's own Video objects, so the
 *  page updated itself and may stay. False means drop it. */
export function feedPageSurvivesMutation(screen: FeedMutationScreen): boolean {
  if (!screen.inFeedSection) return false;
  return !screen.isPlayer || screen.playerQueueIsFeedPage;
}
