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

## Decision

When the server calls a public third-party HTTP API to enrich a video, it
follows three rules, established by `src/server/sponsorBlock.ts`:

1. **Hash before sending.** Never send the plain video id (or other
   per-user identifier). Send the shortest prefix of a cryptographic hash the
   API accepts, and filter the API's bucketed answer down to the exact id
   locally.
2. **Cache in the shared script cache, empty answers included.** The answer
   is the same for every viewer, so it goes in `CacheService.getScriptCache()`
   (see ADR 0005 for the per-user vs. shared cache split), keyed by video id,
   for the `CacheService` maximum TTL. Caching the empty case matters:
   "nothing found" is the common case and must not be looked up on every
   request. An answer that says "nothing here" is cached whatever shape it
   takes, including a status code the service uses for it (SponsorBlock
   answers 404 for an empty bucket). **Cache only what the key describes.**
   The entry holds the answer for that video and nothing else. Apply every
   rule that depends on the caller after the cache read, never before the
   write. SponsorBlock shows why: the video length drops a crowd entry that
   ends past the end of the video, but the caller knows the length only
   sometimes, so `boundSponsorSegments` runs on the way out and the cached
   list stays unbounded. A per-caller rule baked into a shared entry gives
   every later viewer the first caller's answer, for the whole TTL.
3. **Fail open.** Any error (network failure, an unexpected status code, a
   malformed or unexpectedly shaped body) turns into "no data", never an
   exception or a UI-visible failure, and a failed lookup is not cached so the
   next request retries. The feature always degrades to its pre-feature
   behavior.

No new OAuth scope is needed: `script.external_request` (already in
`appsscript.json` for other fetches) covers any HTTPS URL, not only Google's.
Reused CC-licensed or otherwise-attributed data needs a visible credit in the
UI (the app footer, for SponsorBlock).

**Rejected alternative:** sending the plain video id and relying on
SponsorBlock's own privacy policy. Rejected because the hash costs nothing
and removes the app's own dependence on a third party's data-handling
promises.

## Consequences

- A future third-party integration has a template to follow instead of
  reinventing the privacy and failure story each time.
- The hash-prefix bucket means the server does a small amount of client-side
  filtering on every cache miss; negligible next to the network round trip.
- A third-party API that offers no hash-based lookup would need its own
  privacy review before this pattern applies as-is.
- A shared cache entry must stay true for every caller, so a per-caller filter
  costs a small amount of work on every call, not once per fetch.
