# MyTube

Personal YouTube-watching web app on Google Apps Script. No home feed, no
recommendation rabbit hole: only your subscriptions' uploads, your playlists,
and your own watch history.

**Full design and decisions: [PLAN.md](PLAN.md). Read it before changing
architecture or adding a feature.** Human setup/run/deploy: [README.md](README.md).

Delegate to these agents at the right moment (each agent's own description says what it does). They fall into two groups, by when they run.

**Before you implement (explore agents, launched as preparation):**

- **pattern-scout**: before implementing any non-trivial feature, screen, data source, or server function, and any time you ask "how do we do X here?". Returns real code examples with the rules distilled from them.
- **adr-checker** (consult mode): before implementing in an ADR-relevant area (the "Architecture Decision Records (ADRs)" section lists them). Returns the decisions the work must follow.

**After you implement, before you ship:**

- **docs-checker**: after a change that could affect documented content (features, commands, structure, patterns, counts). Checks every documentation location (code comments, `README.md`, `PLAN.md`, `AGENTS.md`, ADRs) against the code and fixes drift.
- **validate**: just before creating a PR or pushing. Runs the repo's checks the way CI does (typecheck, format check, tests, build) and reports pass or fail.
- **adr-checker** (maintain mode): after you introduce a new architectural pattern or change one an ADR records. Creates or updates the ADR.

Beyond these, spawn subagents freely: hand off research, code exploration, and parallel analysis so the files they read stay out of your own context. Give each subagent one task.

## Writing style

The people who read your output may read English as a second language and may be new to the area. Two layers apply. This section is the one home for both: no other file restates them.

**Layer 1 covers every piece of prose you write**: chat replies, PR and issue text, review comments, commit messages, and every document below. It follows Zinsser's four principles, which are simplicity, brevity, clarity, and humanity.

- **Short sentences, one idea each.** Use common words. Avoid idioms, slang, and cultural references.
- **Lead with the answer**, then only the detail that changes what the reader does. Cut filler and hedging. Do not use em dashes.
- **Assume a short attention span.** The reader usually skims to make a quick decision (which PR to review, which issue to pick), with little context and little time; put the single most important thing first, and make each part land even if they stop after the first line.
- **Gloss each jargon term, acronym, or tool/library name on first use** in one short clause, or pick a simpler word.
- **Explain a concept briefly before going deeper.** Do not assume a flow, tool, or pattern is already known.
- **Assume junior-level knowledge of the area.** Name the things you reference (files, commands, terms) instead of assuming the reader can guess.

**Layer 2 adds ASD-STE100 on top, for technical documents only**: `AGENTS.md` and area docs, ADRs, `README.md` and `PLAN.md`, skills, subagents, and code comments. ASD-STE100 (Simplified Technical English) is a controlled-English standard from the aerospace industry. A maintenance manual must carry one reading and one only, and these documents have the same job.

- **Active voice only.** Name the actor: "the hook formats the file", not "the file gets formatted".
- **One meaning per word, and the same word for the same thing every time.** Never swap in a synonym for variety.
- **One instruction per sentence, and start the sentence with the verb.** Write "Run the migration", not "The migration should be run".
- **No `-ing` verb form as a noun or as a sentence opener.** Write "Use the skill to create a branch", not "Creating a branch is done with the skill".
- **About 20 words per sentence at most** (25 in descriptive text).
- **Leave out no word that guards the meaning.** Write "the file that you changed" when "the file you changed" could be misread.

Both layers cover prose only. Neither covers code identifiers or text you quote word for word.

## Stack and build

- Server: TypeScript in `src/server/`, bundled by esbuild to `dist/Code.js`
  (clasp pushes it as `Code.gs`).
- Frontend: TypeScript in `src/ui/`, bundled to `dist/ui.html` (a `<script>`),
  inlined into `dist/index.html` via the `include()` template call.
- Deploy model: "Execute as: user accessing" + access "Anyone", so each visitor
  uses their own Google account. Storage is therefore per-user.

## Commands

| Task         | Command                | Notes                                                        |
| ------------ | ---------------------- | ------------------------------------------------------------ |
| Build        | `npm run build`        | Bundle `src/` to `dist/` with esbuild                        |
| Typecheck    | `npm run typecheck`    | `tsc --noEmit`                                               |
| Format       | `npm run format`       | Prettier, writes changes                                     |
| Format check | `npm run format:check` | Prettier, fails on drift (what CI runs)                      |
| Test         | `npm test`             | Run the Vitest suite once (what CI runs)                     |
| Test (watch) | `npm run test:watch`   | Re-run tests on change while developing                      |
| Check        | `npm run check`        | typecheck + format check + test + build; run before every PR |
| Push         | `npm run push`         | Build + `clasp push`                                         |
| Deploy       | `npm run deploy`       | Build, push, `clasp deploy` (writes to Apps Script)          |

Whenever you need to confirm the code still passes, delegate to the **validate** agent (it runs the sequence above the way CI does).

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
  **Whatever a filter reads must be flagged on the whole list, before the
  slice.** Membership and duration are otherwise flagged on the page only.
  Flagging after the slice leaves holes in the page and inflates `total`.
- **Shorts are detected by length, not a real flag** (RSS has none): duration
  via `youtube.getVideoDurationsSeconds` (Data API `contentDetails`, cached in
  the shared script cache since length is the same for everyone), hidden when
  `<= 180s`. A toggle re-shows them because the length heuristic has false
  positives.
- **Sponsor segments come from SponsorBlock, a public crowd database, not
  YouTube.** `getSponsorSegments` (`src/server/sponsorBlock.ts`) asks by hash
  prefix (first 4 hex chars of `sha256(videoId)`), so the plain video id never
  leaves the server, and caches the answer — empty lists included — in the
  shared script cache for 6h, like `getVideoDurationsSeconds`. A 404 is the
  service's "nothing here" answer and is cached like any empty list. The
  policy (`normalizeSponsorSegments`, `boundSponsorSegments`,
  `sponsorSkipDecision`, `sponsorCategoryLabel` in
  `src/shared/sponsorBlock.ts`) is shared, so the
  player's skip decision matches the server's cache and tests can pin it
  without a browser. `sponsorSkipDecision` also owns the memory of the last
  jump, which stops a second jump on the same segment. **The cache entry holds
  the UNBOUNDED list, and `boundSponsorSegments` drops a crowd entry that ends
  past the video length AFTER the cache read, on every call.** The player
  passes `durationSeconds` only when it knows one, so a bound written into the
  shared entry would fix one caller's length for every later viewer, in both
  directions. A failed lookup returns `[]` and is never
  cached, matching the "skip nothing" default. Segments are not stored on
  `Video`, so the kept feed page (ADR 0008) is untouched.
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
  from the DOM mid-session: a toggled video stays in place, dimmed whenever its
  new state is the one that drops it from this list (saved in the feed while
  "Hide saved" is on, unsaved on the Watch Later screen), so a mis-tap is undone
  with a second tap.
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
  state to roll back) but still call `dropStaleFeedPage()` like every other
  write, because the kept feed page holds `progressSeconds` too. Lists get the flag
  via `flagProgress` in `src/server/main.ts`; the player resumes from
  `video.progressSeconds`, and cards show it as a red bar on the thumbnail
  (`progressFraction` picks the width; no bar when the position or the
  best-effort duration is missing).
- **Dismissed = a feed-only hidden list** (`src/server/dismissed.ts`, video ids
  in user properties, mirrors `history.ts`). `flagDismissed` sets it; the
  feed-only "Hide dismissed" toggle filters on it. The dismiss control is the
  top-right corner cross on feed cards (`VideoListOptions.cornerAction`), never
  shown on the other lists; dismissed feed cards are dimmed like seen ones.
- **The feed keeps exactly ONE page in memory: the page on show.** Never more.
  `src/ui/feedPageCache.ts` is the only path to `getFeedPage`, and it owns the
  reasoning in its header. The policy it wires together lives in
  `src/shared/pageCache.ts` (single slot, 30-minute fresh window) and
  `src/shared/feedPageStaleness.ts` (whether a mutation leaves the page
  correct). Serving a different page replaces the kept one, so paging away and
  back re-fetches. Every server write calls `dropStaleFeedPage()`; the router
  reports the screen it would apply to with `setFeedMutationScreen`. Any
  non-feed `render()` warms the page the feed will open on, never with
  `forceRefresh`. Do not add feed-loading paths that bypass this cache.
  **Never remember "this array is the feed's page" — ask `isKeptFeedPage` at
  mutation time.** A warm-up can replace the kept page under a player still
  holding the old array, and a stored flag would then spare a page the
  mutation does not touch (ADR 0008).
- **The feed reopens on the page it last showed.** `feedPage`/`feedPageSize` in
  `src/ui/main.ts` seed `VideoListOptions.paging` and follow its `onChange`. The
  filters and Force refresh reset to page 0 (`reloadFeedFromStart`). Scroll
  position is not restored.
- **The Feed nav button reports the feed's state**: pulsing (opacity 0.7↔1, the
  `skeleton-pulse` loop) while the session's first page is in flight, a still dim
  once nothing is in flight and nothing loaded (a failed load, so no pulse
  promising a page that is not coming), then a blue dot while the loaded page's
  post-filter `total` is above 0 — deliberately not the red `toggle-nudge`, which
  asks for a tap. All three are opacity or a pseudo-element, so the button never
  changes size between states. The rule is
  `feedNavState` in `src/shared/feedNavState.ts`: one value, so the pulse, the dim
  and the dot can never show together. `src/ui/feedNavButton.ts` owns the two
  numbers it reads and paints the result; it sits outside `main.ts` so
  `optimistic()` can repaint after every mutation without a cycle.
- **The dot's count is re-derived on every paint, never counted in deltas.**
  `applyFeedNavState` takes the kept page's server `total` and subtracts the
  videos on that page that no longer pass the flag filters
  (`remainingFeedTotal` in `src/shared/feedInclusion.ts`, the browser-side mirror
  of `getFeedPage`'s flag filters). So dealing with the last waiting video turns
  the dot off at once, and a rolled-back mutation takes its count back with it.
  Only the three flag filters live there: the date and Shorts filters read fields
  no action changes. `optimistic()` triggers the repaint, so it covers cards,
  the player and every screen. With no page kept, the last derived value stands.
  Filter defaults live in `src/ui/feedFilters.ts` so the request and the recount
  can never read a toggle differently.
- UI toggles persist in `localStorage` via `src/ui/preferences.ts` (works inside
  the Apps Script iframe; no server round-trip).
- **Optimistic UI updates for every server mutation.** Any button that writes to
  the server (mark seen, dismiss, add/remove Watch Later — on cards _and_ in the
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
  **A screen that paints after an `await` must capture `navigationMovedOn()`
  before its load and return early when it fires.** Otherwise it paints over the
  screen the user moved to, and its cards then act under that screen's feed
  mutation policy (ADR 0008).

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
- **The gate is mandatory.** CI runs typecheck, the format check, the tests,
  and the build on every PR to `main` (`.github/workflows/ci.yml`), and again
  before deploy (`.github/workflows/deploy.yml`). The repo ruleset "Requirements
  for merge" makes the `test` check required, so **a PR cannot merge to `main`
  until CI is green**; `auto-merge.yml` then merges it automatically. Run
  `npm run check` locally before opening a PR.

## Architecture Decision Records (ADRs)

ADRs live in `adr/`. Each records one architectural decision or cross-cutting
standard and why; PLAN.md holds the broader forward-looking design. **One ADR
per pattern, kept alive:** when a pattern changes, update its ADR in place;
create a new ADR only for a genuinely new pattern. Most changes need no ADR.
Conventions: `adr/AGENTS.md` (auto-loads through its `adr/CLAUDE.md` shim when
you work in `adr/`).

**Before implementing** in an area that may carry a decision, delegate to the
**adr-checker** agent in consult mode. These areas usually carry decisions: the
Apps Script platform contract and OAuth scopes, per-user storage
(PropertiesService, playlists), server function exposure and the build pipeline,
the component reuse model, feed caching/paging, and deployment/CI/auto-merge.

**After implementing**, delegate to the **adr-checker** agent in maintain mode
only if you introduced a new architectural pattern or changed one an ADR already
records.

| ADR                                                                  | Decision                                                                                     |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| [0001](adr/0001-use-google-apps-script.md)                           | Platform: Google Apps Script web app                                                         |
| [0002](adr/0002-watch-later-as-real-youtube-playlist.md)             | Watch Later is a real YouTube playlist (write scope)                                         |
| [0003](adr/0003-expose-server-functions-via-top-level-wrappers.md)   | Expose server functions via generated top-level wrappers                                     |
| [0004](adr/0004-component-reuse-model.md)                            | One `Video` type, one `VideoListView`, one `PlayerView`                                      |
| [0005](adr/0005-store-history-in-properties.md)                      | Store watch history in PropertiesService, not a Sheet                                        |
| [0006](adr/0006-test-first-with-faked-apps-script.md)                | Test-first (TDD) on Node/Vitest with faked Apps Script globals; green tests gate every merge |
| [0007](adr/0007-agent-docs-structure.md)                             | `AGENTS.md` map + Claude-Code-only skills, subagents, and settings                           |
| [0008](adr/0008-single-kept-feed-page-via-shared-object-identity.md) | Feed keeps ONE loaded page, kept correct by sharing `Video` object identity                  |
| [0009](adr/0009-third-party-lookups-hashed-and-fail-open.md)         | Third-party lookups: privacy-preserving id hash, shared cache, fail open on any error        |

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
- **The Apps Script sandbox blocks `screen.orientation.lock()`.** The wrapper
  iframe's `sandbox` attribute has no `allow-orientation-lock` token, so the
  call throws SecurityError for our code and for YouTube's embedded player
  alike — real fullscreen auto-rotation is impossible. The player fakes it: a
  custom fullscreen button fullscreens `.player-frame` and CSS rotates the
  inner `.player-rotor` 90° while the screen is portrait
  (`src/ui/playerView.ts` + `src/ui/index.html`). The rotated element must be
  a _child_ of the fullscreen element (the UA stylesheet forces
  `transform: none !important` on the fullscreen element itself), which is
  also why YouTube's own fullscreen button can never rotate — it is hidden via
  the `fs: 0` playerVar wherever element fullscreen exists (kept on iPhone,
  which has no element fullscreen).
- **Watch Later and History are not readable via the YouTube API.** Never call
  the API for them. Watch Later is our own playlist; history is per-user script
  properties (PLAN.md sections 2 and 6, ADR 0005).
- **`Utilities.computeDigest` returns signed bytes (-128..127).** Convert each
  byte with `(byte + 256) % 256` before turning it into hex, or the hash is
  wrong for every byte above 127. See `videoIdHashPrefix` in
  `src/server/sponsorBlock.ts`.
- `dist/`, `.clasp.json`, and `.clasprc.json` are gitignored. Never commit them.

## Git Workflow

- Branch from `main`, PR back to `main` (merging deploys to production via `deploy.yml`). **Never push to `main`.** Whenever you create a branch, use the `create-branch` skill.
- Conventional commits: `feat:`, `fix:`, `refactor:`, `chore:`, `docs:`, `test:`. Whenever you commit, use the `write-commit` skill.
- PRs merge automatically once the required `test` check passes (`auto-merge.yml`). There is no human review gate; the tests are the review, which is what makes the TDD protocol above non-negotiable.

## Documentation Organization

Each kind of knowledge has one home. Write a change in the home that matches it; never duplicate the same content across homes.

| Home                             | Loaded                           | Holds                                                                                                         |
| -------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                      | Every session                    | The map: stack facts, conventions, gotchas, and the ADR index. (`CLAUDE.md` is a one-line `@AGENTS.md` shim.) |
| `.claude/skills/<name>/SKILL.md` | On demand, when the task matches | One procedure: how to do X.                                                                                   |
| `adr/NNNN-*.md`                  | On demand, via adr-checker       | One architectural decision and its why.                                                                       |
| `PLAN.md`                        | On demand                        | The forward-looking product and design rationale and constraints.                                             |
| `README.md`                      | Read by humans                   | What the app is, setup, run, deploy, troubleshooting.                                                         |

**All of these files are living: keep them true.** When you learn something that helps future agents, update the right file in the same session. When a file holds wrong or outdated information, fix it or remove it. This covers code comments too. After implementation, the **docs-checker** agent catches drift you missed.

**Rules:**

- ADRs are agent-only: never reference or list them in `README.md`.
- Number ADRs in sequence (`NNNN-kebab-title.md`) and never renumber an existing file. Index each one as a one-line row in the ADR table above, never a summary.
- Do not duplicate content between `README.md`, `PLAN.md`, and `AGENTS.md`; reference it instead.
- `CLAUDE.md` is a one-line `@AGENTS.md` shim; edit `AGENTS.md` instead.

## GitHub issues, PRs, and other artifacts

- **Always self-assign PRs** when you create them.
- **Always link PRs to issues** in the PR body: `Closes #N` on the PR that finishes the issue so it auto-closes on merge, `Refs #N` on every earlier PR when one issue takes several.
- **Always add the `waiting-for-human-check` label** when you create a GitHub issue, PR, or any other reviewable artifact. It means no human has verified the content yet; a human removes it after reviewing. The label marks state (unreviewed), not origin.

If the repo has no `waiting-for-human-check` label, create it first:

```bash
gh label create "waiting-for-human-check" --description "No human has verified this yet -- direct AI output" --color "D93F0B"
```

Whenever you create a GitHub issue, use the `create-issue` skill. Whenever you implement one, use the `implement-issue` skill. Whenever you review a PR, use the `review-pr` skill.

## Coding standards

- **Match existing patterns.** Before writing code, find similar implementations and follow their style, structure, and conventions (the **pattern-scout** agent does this).
- **Explicit type annotations** are mandatory for all parameters, return types, and non-trivial variables.
- **Comment the _why_, never the _what_.** A comment must carry what the code cannot: a non-obvious constraint, an intentional divergence, a trap a future reader would reintroduce. Do not document self-explanatory names, and match the comment density of the surrounding file.

## Refactoring safety

Whenever you rename or refactor a symbol, use the `rename-symbol` skill.

## Debugging

Whenever a fix attempt fails or a bug needs root-causing, use the `debug` skill.

## Writing prompts for agents and rules

Whenever you author or edit an AI-facing file (`AGENTS.md`, skills under `.claude/skills/`, subagents under `.claude/agents/`, prompts for agents you spawn), use the `write-ai-instructions` skill.

## Self-updating rules

These instruction files are living, and keeping them current is part of the work. Persist a rule right away (in the narrowest scope that fits) instead of applying it only this session when you discover something **extremely hard to find, deeply non-obvious, and time-saving for future sessions**, hit a pattern that **diverges from what an AI would write by default**, when the user says **"every time" / "always" / "never"**, or when **feedback on your own work reveals a standard you should have followed** (a PR review comment, a user correction). Persist it in these shared, committed files, never in personal memory or the global config, so the whole team gets the lesson. For where to write it, use the `write-ai-instructions` skill.
