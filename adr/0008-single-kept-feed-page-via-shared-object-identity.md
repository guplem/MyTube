# 8. Single kept feed page, kept correct via shared object identity

Status: Accepted

## Context

The feed's core flow is: open a video, mark it watched, go back. Before this
decision, the browser only pre-loaded the very first feed page, once, and
threw that pre-load away the moment it was used or after 90 seconds. So going
back to the feed after watching a video reloaded it with placeholder
("skeleton") cards every time, even though nothing about the feed had
actually changed.

The feed already pages on the server (see the "reuse model" convention in the
root `AGENTS.md`): the browser only ever holds one page of videos, never the
full list. Any fix had to keep that constraint. `AGENTS.md` already names
"feed caching/paging" as an area that should carry a decision; this was the
gap.

## Decision

The browser keeps exactly ONE feed page in memory: the page currently on
screen (or about to be, while warming up). A different page, a changed
filter, or a Force refresh replaces it; there is never more than one.

The kept page survives a toggle (mark watched, dismiss, save to Watch Later)
only because the rendered cards hold the very same `Video` objects the kept
page holds. A toggle mutates a field on that shared object, so the page and
the screen update together, for free. Anything that instead loads its own
copies of the same videos — another list screen, a player whose queue was
rebuilt rather than handed the feed's own array — does not share that
identity, so its toggle would leave the kept page wrong. The rule for whether
a given mutation still leaves the kept page correct lives in
`src/shared/feedPageStaleness.ts`; every future screen that shows feed videos
must either share the feed's `Video` objects or make the mutation drop the
kept page.

Identity is **asked of the cache at mutation time**, never remembered when the
array was handed over. The cache reports what it currently holds
(`resolved()` in `src/shared/pageCache.ts`, wrapped as `isKeptFeedPage` in
`src/ui/feedPageCache.ts`). A remembered flag goes wrong on its own: the kept
page can be replaced under a screen that still holds the old array — an
in-player navigation warms the feed, and that warm reloads once the fresh
window passes or the key moves — and the old array would still look like the
kept page.

The single-slot cache mechanics (fresh window, warm, replace) live in
`src/shared/pageCache.ts`, generic and independent of the feed. `src/ui/feedPageCache.ts`
wires that generic cache to the feed: it is the only path to `getFeedPage`.

The kept page's fresh window is sized to the server's per-channel RSS
("really simple syndication", the feed format channels publish uploads in)
cache: 30 minutes. The two windows are offset — the server's starts when it
last fetched a channel, the browser's when its own page load started — so a
kept page can trail the server by up to one window. That is an accepted
limit for a "what's new" feed, not a promise of zero staleness.

The product behavior this produces: a card you acted on stays in place,
dimmed, until you leave the feed and come back, page away and back, or hit
Force refresh. It does not vanish out from under your tap.

**Rejected alternative:** keep several pages (an earlier revision kept up to
8), and/or drop the whole cache on every mutation instead of relying on
shared identity. Several kept pages can hold two different `Video` objects
for the same video (reachable just by changing page size and back) and
disagree about its flags; a page nobody is looking at also keeps reporting a
`total` and membership list the server has moved past, which made the count
line lie and made Next bounce off the paging clamp forever. Dropping the
whole cache on every mutation is simple and always correct, but it reintroduces
the exact cost this decision removes: the core "watch, mark, go back" flow
reloads with skeletons on every single tap. Both are easy to reach for again
under pressure; resist them — fix staleness by keeping one page and sharing
identity, not by keeping more pages or invalidating more eagerly.

## Consequences

- A new screen that shows feed videos must either receive and mutate the
  feed's own `Video` objects, or call the drop path
  (`dropStaleFeedPage` in `src/ui/feedPageCache.ts`) on every mutation it
  makes. Silently doing neither means the feed shows stale flags.
- Anything that claims identity with the kept page must prove it through
  `isKeptFeedPage` at the moment of the mutation. A stored "this is the feed's
  array" flag is the failure this ADR exists to prevent.
- A screen that paints after an `await` must check it is still the current
  screen before painting. Otherwise the mutation policy describes the screen
  the router moved to while the DOM shows a different list, and a toggle on
  that list spares a kept page it does not share objects with.
- The feed can lag the server by up to one 30-minute RSS window; Force
  refresh is the user's way to force a same-instant reload.
- Paging away from the kept page and back always re-fetches; only the page
  last shown is ever free.
