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
- **Seen = watch history OR a single "seen before" cutoff date** (one user
  property, not a row per video). `flagSeen` ORs both. "Hide viewed" filters on
  the resulting `seen` flag.
- UI toggles persist in `localStorage` via `src/ui/preferences.ts` (works inside
  the Apps Script iframe; no server round-trip).

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
- **Watch Later and History are not readable via the YouTube API.** Never call
  the API for them. Watch Later is our own playlist; history is per-user script
  properties (PLAN.md sections 2 and 6, ADR 0005).
- `dist/`, `.clasp.json`, and `.clasprc.json` are gitignored. Never commit them.
