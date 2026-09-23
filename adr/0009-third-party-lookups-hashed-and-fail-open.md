# 9. Third-party lookups: privacy-preserving hash, shared cache, fail open

Status: Accepted

## Context

The sponsor-skip feature (player jumps past sponsor and self-promotion parts
of a video) needs segment data from SponsorBlock, a public crowd database.
This is the app's first data source outside Google: every other server call
(YouTube Data API, RSS feeds) talks to a Google endpoint the user already
trusts with their account.

Sending SponsorBlock the plain video id would tell a third party which videos
this user watches. SponsorBlock itself defines the fix its own clients use:
ask by a hash prefix of the video id instead of the id itself, so the service
answers with a bucket of many videos and the caller picks its own out
locally. The segments are the same for every viewer, like the video durations
already cached in `src/server/youtube.ts`, so the answer is safe to share
across users. SponsorBlock can also be slow or unreachable, and playback must
never depend on that.

The DeArrow community-title feature (`src/server/dearrow.ts`) later reused
this pattern for a second, unrelated lookup on the same third-party server.
DeArrow's job is different in one way: SponsorBlock answers one call per
video, made from the player, but DeArrow must label a whole list of videos
(the feed page, history, a playlist) before it renders, so one lookup per
video would mean one HTTP round trip per card. `src/server/dearrow.ts` is the
template for that batched shape.

## Decision

When the server calls a public third-party HTTP API to enrich a video, it
follows three rules, established by `src/server/sponsorBlock.ts` and reused
as-is by `src/server/dearrow.ts`:

1. **Hash before sending.** Never send the plain video id (or other
   per-user identifier). Send the shortest prefix of a cryptographic hash the
   API accepts, and filter the API's bucketed answer down to the exact id
   locally. `videoIdHashPrefix` (`src/server/sponsorBlock.ts`, exported for
   this reason) computes the prefix once; `dearrow.ts` imports it instead of
   hashing again, so a second lookup against the same server always agrees on
   the bucket a video falls in.
2. **Cache in the shared script cache, empty answers included.** The answer
   is the same for every viewer, so it goes in `CacheService.getScriptCache()`
   (see ADR 0005 for the per-user vs. shared cache split), keyed by video id,
   for the `CacheService` maximum TTL. Caching the empty case matters:
   "nothing found" is the common case and must not be looked up on every
   request. An answer that says "nothing here" is cached whatever shape it
   takes, including a status code the service uses for it (both endpoints
   answer 404 for an empty bucket). A cached "nothing found" must be a
   non-empty value, so a cache miss (`undefined`) is never confused with a
   found-but-empty answer; DeArrow's entry is `JSON.stringify(title)`, so "no
   title" is the string `'""'`. **Cache only what the key describes.** The
   entry holds the answer for that video and nothing else. Apply every rule
   that depends on the caller after the cache read, never before the write.
   SponsorBlock shows why: the video length drops a crowd entry that ends
   past the end of the video, but the caller knows the length only
   sometimes, so `boundSponsorSegments` runs on the way out and the cached
   list stays unbounded. A per-caller rule baked into a shared entry gives
   every later viewer the first caller's answer, for the whole TTL.
3. **Fail open.** Any error (network failure, an unexpected status code, a
   malformed or unexpectedly shaped body) turns into "no data", never an
   exception or a UI-visible failure, and a failed lookup is not cached so the
   next request retries. The feature always degrades to its pre-feature
   behavior. A lookup that covers several videos in one call (see below)
   applies this per group: one bucket's failure returns no data for the
   videos in that bucket only, and never cancels the others.
   One lookup is a diagnostic view, not a feature, and it must report a
   failure: `getDeArrowSubmissions` in `src/server/dearrow.ts` feeds the
   player Info tab, which tells "no submissions" apart from "the lookup
   failed". It returns `{ status: "failed" }` instead of an empty list. It
   still never throws, and it still does not cache the failure.

### Batching a lookup across a list

A lookup made once per video (SponsorBlock, called from the player for the
one video playing) does not need this; a lookup that must label a whole list
before it renders does, or it costs one HTTP round trip per card.
`src/server/dearrow.ts` (`getCommunityTitles`, called from
`flagCommunityTitle` in `src/server/main.ts` on every list path: the feed
page, history, a playlist, Watch Later) is the template a third list lookup
should copy:

- Read the shared cache for every video's key first; only a miss needs a
  fetch.
- Group the misses by hash prefix (rule 1), so a prefix shared by several
  videos is asked once, not once per video.
- Send one `UrlFetchApp.fetchAll` with one request per distinct prefix.
- Cap the request count (`MAX_PREFIXES_PER_CALL`, 50 in `dearrow.ts`) and send
  only the first prefixes in list order. The list call waits on the fetch and
  `UrlFetchApp` has no timeout, so an unbounded list (history can hold
  hundreds of videos) must not turn into hundreds of requests to a
  volunteer-run server. The prefixes past the cap stay uncached misses; a
  later load asks for them again.
- Cache one entry per video, not per prefix or per request, so a later lookup
  for a different mix of videos still hits the cache.

No new OAuth scope is needed: `script.external_request` (already in
`appsscript.json` for other fetches) covers any HTTPS URL, not only Google's.
Reused CC-licensed or otherwise-attributed data needs a visible credit in the
UI (the app footer credits both SponsorBlock and DeArrow, since DeArrow runs
on the same server and reuses its data).

**Rejected alternative:** sending the plain video id and relying on the
service's own privacy policy. Rejected because the hash costs nothing and
removes the app's own dependence on a third party's data-handling promises.

## Consequences

- A future third-party integration has a template to follow instead of
  reinventing the privacy and failure story each time, whether it looks up
  one video at a time or a whole list.
- The hash-prefix bucket means the server does a small amount of client-side
  filtering on every cache miss; negligible next to the network round trip.
- A third-party API that offers no hash-based lookup would need its own
  privacy review before this pattern applies as-is.
- A shared cache entry must stay true for every caller, so a per-caller filter
  costs a small amount of work on every call, not once per fetch.
- A list lookup capped at a fixed number of prefixes per call can leave the
  tail of a very long list unlabelled until a later load fills it in.
