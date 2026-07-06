# MyTube — Agent Guide

Personal YouTube-watching web app on Google Apps Script. No home feed, no
recommendation rabbit hole: only your subscriptions' uploads, your playlists,
and your own watch history.

**Full design and decisions: [PLAN.md](PLAN.md). Read it before changing
architecture or adding a feature.** Human setup/run/deploy: [README.md](README.md).

## Stack and build

- Server: TypeScript in `src/server/`, bundled by esbuild to `dist/Code.js`
  (clasp pushes it as `Code.gs`).
- Frontend: TypeScript in `src/ui/`, bundled to `dist/ui.html` (a `<script>`),
  inlined into `dist/index.html` via the `include()` template call.
- Deploy model: "Execute as: user accessing" + access "Anyone", so each visitor
  uses their own Google account. Storage is therefore per-user.

## Commands

| Task | Command | Notes |
|---|---|---|
| Build | `npm run build` | Bundle `src/` to `dist/` with esbuild |
| Typecheck | `npm run typecheck` | `tsc --noEmit` |
| Test | `npm test` | Run the Vitest suite once (what CI runs) |
| Test (watch) | `npm run test:watch` | Re-run tests on change while developing |
| Check | `npm run check` | `typecheck` + `test` + `build`; run before every PR |
| Push | `npm run push` | Build + `clasp push` |
| Deploy | `npm run deploy` | Build, push, `clasp deploy` (writes to Apps Script) |

## Conventions

- Follow the reuse model in PLAN.md section 13: one `Video` type, one
  `VideoListView`, one `PlayerView`. **Watch Later is the playlist screen with
  add/remove turned on, not a new screen.**
- Every data source (RSS feed, playlist, Watch Later, history) returns `Video[]`.
  Add a new source as an adapter that returns `Video[]`, never a new UI.
- Explicit types on all parameters and return values (project standard).
- **The feed pages on the server.** `getFeedPage` returns one page (`{videos,
  total}`); the browser never holds the whole 1000+ video list. `VideoListView`
  has two modes: `PagedVideoListView(loader)` for the feed and the in-memory
  array form for the smaller lists. Do not reintroduce shipping the full feed.
- **Shorts are detected by length, not a real flag** (RSS has none): duration
  via `youtube.getVideoDurationsSeconds` (Data API `contentDetails`, cached in
  the shared script cache since length is the same for everyone), hidden when
  `<= 180s`. A toggle re-shows them because the length heuristic has false
  positives.
- **Seen = watch history only.** `flagSeen` sets it from the history ids;
  "Hide watched" filters on it. In UI copy the flag is always called
  **watched** (matching the History tab); `seen` stays the name in code and
  storage. The feed also has a date filter (`beforeDate` in
  `getFeedPage`, a localStorage pref) that hides older videos but does not touch
  the `seen` flag, so playlists and Watch Later are unaffected.
- **Every card action is a state toggle, and cards share one layout.** Each
  card on every list shows the same two stacked buttons — the Watch Later
  toggle ("+ Watch Later"/"✓ Watch Later") and the watched toggle
  ("Mark watched"/"✓ Watched") — so cards look identical across the feed,
  playlists, Watch Later, and history; only the corner dismiss stays feed-only.
  A toggle's ON state is a pressed look (`video-action--on`, the chapter-strip
  blue) plus a `✓` label that keeps the noun, and every toggle carries a
  `title` naming what a click does now plus `aria-pressed`; state changes go
  through the action's `reflect`, which runs at first render and after every
  toggle. When a video is effectively finished but not in the history, the
  watched toggle adds a red notification dot (`toggle-nudge`) nudging the tap:
  the policy is `shouldSuggestWatched` in `src/shared/videoProgress.ts` (the
  same 95% line as `PROGRESS_FINISHED`, so the nudge and the store agree),
  fed the stored flag on cards and, in the player, also the live position
  (polled every second). Nothing removes a card
  from the DOM mid-session: a toggled-off video stays in place (dimmed where it
  will disappear on the next load), so a mis-tap is undone with a second tap.
  On the Watch Later screen the membership toggle IS the remove button.
- **Marking seen drops the video from Watch Later** (`markVideoSeen` in
  `src/server/main.ts` removes it if present). This is the one cross-list side
  effect: it runs server-side so it applies from every screen and the player, not
  just the Watch Later list, and a watched video never lingers there. It is
  one-directional — un-marking seen does not re-add to Watch Later — and a no-op
  when the video isn't saved (guarded on the cached membership set). The one
  exception is the Watch Later screen's own seen toggle: its un-toggle goes
  through `undoMarkVideoSeen`, which restores the playlist entry (guarded on
  membership, never creates the playlist) and then un-marks the view.
- **Videos resume where you left off, on any device.** The player saves the
  playback position server-side (`src/server/progress.ts`, chunked user
  properties mirroring `history.ts`, capped at the 500 most recently saved), so
  the store is per Google account and cross-device sync is automatic. The
  policy for what is resumable lives in `src/shared/videoProgress.ts`
  (`progressToStore`): positions in the first ~15s map to 0, which clears the
  entry (a restart, not a session), and positions past 95% map to
  `PROGRESS_FINISHED` (-1), a kept marker meaning watched-to-the-end — the
  card shows a full bar (even with no duration) but the player still starts
  finished videos from the top. The player saves on a 20s interval, on pause, on prev/next, and on
  unmount — never on tab close, which the Apps Script iframe can't observe
  reliably; saves are fire-and-forget (not `optimistic()` — there is no UI
  state to roll back) but still invalidate the feed prefetch stash, whose
  snapshot carries `progressSeconds` like the other flags. Lists get the flag
  via `flagProgress` in `src/server/main.ts`; the player resumes from
  `video.progressSeconds`, and cards show it as a red bar on the thumbnail
  (`progressFraction` picks the width; no bar when the position or the
  best-effort duration is missing).
- **Dismissed = a feed-only hidden list** (`src/server/dismissed.ts`, video ids
  in user properties, mirrors `history.ts`). `flagDismissed` sets it; the
  feed-only "Hide dismissed" toggle filters on it. The dismiss control is the
  top-right corner cross on feed cards (`VideoListOptions.cornerAction`), never
  shown on the other lists; dismissed feed cards are dimmed like seen ones.
- **The feed is prefetched from every other screen.** The app lands on Watch
  Later, so any non-feed `render()` warms one background `getFeedPage` call for
  page 1 with the current filters (`src/ui/feedPrefetch.ts`, policy in
  `src/shared/prefetchStore.ts`: single slot, 90s fresh window, single use).
  Opening the feed consumes the stash and renders instantly. The warm call
  never passes `forceRefresh` — the server reuses live cache entries and
  refetches only expired channels — and every `optimistic()` mutation
  invalidates the stash because the snapshot carries seen/dismissed/Watch Later
  flags. Do not add other prefetch paths that bypass this store.
- UI toggles persist in `localStorage` via `src/ui/preferences.ts` (works inside
  the Apps Script iframe; no server round-trip).
- **Optimistic UI updates for every server mutation.** Any button that writes to
  the server (mark seen, dismiss, add/remove Watch Later — on cards *and* in the
  player) must feel instant: the Apps Script bridge round-trips to Google and can
  take a second or more, so never leave the user waiting on the request. Route it
  through `optimistic()` in `src/ui/optimistic.ts` — it applies the expected
  result immediately (`apply`), fires the request (`send`), and on failure rolls
  the change back (`revert`) and shows a `showToast` with a one-tap refresh. Pass
  the button as `key` so a rapid re-tap lets only the latest tap own the rollback.
  `optimisticToggle` in `src/ui/main.ts` is the card-level wrapper built on it.
  This is **not** for reads (loading comments, a feed page, refreshing) — there is
  no result to assume, so those keep their own loading/skeleton state.
- **All navigation goes through `go()`/`render()` in `src/ui/main.ts`.** A
  `Screen` describes the view; `go()` renders it and pushes it to the URL,
  `render()` only draws (used by back/forward and first load). State lives in the
  URL via `src/ui/urlState.ts` (`google.script.history`/`google.script.url`,
  with a no-op fallback). Add a screen to the `Screen` type plus `paramsFor`,
  `screenFromParams`, and `sectionOf`; never render a screen without routing it.

## Testing & development protocol (TDD)

**New behaviour is developed test-first, red-green-refactor.** Before changing
server logic, write a failing test that pins the behaviour you want (**red**),
make it pass with the smallest change (**green**), then clean up
(**refactor**) with the test as your safety net. Bug fixes start with a test
that reproduces the bug.

- **Tests live in `tests/`** (mirroring `src/server/`) and run on Node via
  **Vitest** (`npm test`). There is no Apps Script in CI, so the runtime globals
  (`PropertiesService`, `CacheService`, `UrlFetchApp`, `XmlService`, `YouTube`,
  `Utilities`) are replaced by in-memory fakes in
  `tests/helpers/appsScriptMock.ts`. Call `installAppsScriptMocks()` in
  `beforeEach` and `uninstallAppsScriptMocks()` in `afterEach`, then seed
  state/responses through the returned handle. This runs the **real** server
  code unchanged — do not add Apps Script shims to `src/` for testing.
- **What to test:** the server logic in `src/server/` is the testable core —
  the feed (parse RSS → merge newest-first → cache → retry → last-good
  fallback), `getFeedPage` filtering/paging, Shorts-by-duration detection, and
  the history/dismissed persistence. The server reaches Apps Script only through
  the faked globals, so almost all of it is reachable. The `src/ui/` layer is
  not unit-tested (it needs a browser + the `google.script.run` bridge); keep UI
  logic thin and push anything worth testing into `src/server/` or `src/shared/`.
- **New data source / filter / persistence path → add tests with it**, in the
  same PR. A new `Video[]` adapter (see Conventions) ships with a test that
  feeds it a fake API/RSS response and asserts the normalized `Video[]`.
- **The gate is mandatory.** `npm test` (with typecheck + build) runs in CI on
  every PR to `main` (`.github/workflows/ci.yml`) and again before deploy
  (`.github/workflows/deploy.yml`). **A PR does not merge to `main` until the
  `test` check is green** — mark it a required status check in the branch
  protection rule for `main`. Run `npm run check` locally before opening a PR.

## Architecture decisions (ADRs)

Design rationale with trade-offs lives in `adr/`; PLAN.md holds the broader
forward-looking design.

| ADR | Decision |
|---|---|
| [0001](adr/0001-use-google-apps-script.md) | Platform: Google Apps Script web app |
| [0002](adr/0002-watch-later-as-real-youtube-playlist.md) | Watch Later is a real YouTube playlist (write scope) |
| [0003](adr/0003-expose-server-functions-via-top-level-wrappers.md) | Expose server functions via generated top-level wrappers |
| [0004](adr/0004-component-reuse-model.md) | One `Video` type, one `VideoListView`, one `PlayerView` |
| [0005](adr/0005-store-history-in-properties.md) | Store watch history in PropertiesService, not a Sheet |
| [0006](adr/0006-test-first-with-faked-apps-script.md) | Test-first (TDD) on Node/Vitest with faked Apps Script globals; green tests gate every merge |

Add an ADR when a decision has lasting trade-offs (a new scope, a storage choice,
a pattern future code must follow).

## Gotchas

- **Exposing server functions:** Apps Script only finds functions written as
  top-level declarations in the pushed file, but esbuild wraps the bundle in an
  IIFE. So `export` every function Apps Script must reach (`doGet`, `include`,
  and every function the browser calls via `google.script.run`) from
  `src/server/main.ts`. `build.mjs` reads those exports and appends matching
  top-level wrapper functions to `dist/Code.js`. A function that is not exported
  fails at runtime: "function not found" for `doGet`, or "is not a function" for
  a `google.script.run` call.
- **No `//` inside template literals in browser code.** Apps Script's page
  serializer treats `//` inside a backtick template literal as a line comment
  and corrupts the whole bundle, crashing the page with "missing ) after
  argument list". It surfaces only at runtime (inside Google's serializer), not
  in the build or typecheck. Build URLs and any string containing `//` with
  double-quoted concatenation instead (see `setupSearch` in `src/ui/main.ts`).
- **OAuth scopes grow per milestone** in `appsscript.json`. Adding a scope forces
  users to re-consent. The final scope set is in PLAN.md section 4.
- **Reading comments needs the `youtube.force-ssl` scope** — the `youtube` scope
  does NOT authorize `commentThreads.list`. `getComments` returns `[]` only for
  comments-disabled videos and throws on any other error, so a missing scope
  surfaces in the UI instead of hiding silently as "No comments".
- **Watch Later and History are not readable via the YouTube API.** Never call
  the API for them. Watch Later is our own playlist; history is per-user script
  properties (PLAN.md sections 2 and 6, ADR 0005).
- `dist/`, `.clasp.json`, and `.clasprc.json` are gitignored. Never commit them.
