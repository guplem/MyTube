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
- `npm run build` bundles to `dist/`; `npm run typecheck` is `tsc --noEmit`;
  `npm run deploy` builds, pushes, and deploys.
- Deploy model: "Execute as: user accessing" + access "Anyone", so each visitor
  uses their own Google account. Storage is therefore per-user.

## Conventions

- Follow the reuse model in PLAN.md section 13: one `Video` type, one
  `VideoListView`, one `PlayerView`. **Watch Later is the playlist screen with
  add/remove turned on, not a new screen.**
- Every data source (RSS feed, playlist, Watch Later, history) returns `Video[]`.
  Add a new source as an adapter that returns `Video[]`, never a new UI.
- Explicit types on all parameters and return values (project standard).

## Gotchas

- **Global functions:** esbuild wraps each bundle in an IIFE. Any function Apps
  Script must find — `doGet`, `include`, and every function called via
  `google.script.run` — must be assigned to `globalThis` at the bottom of
  `src/server/main.ts`. Forgetting it gives a "function not found" error at runtime.
- **OAuth scopes grow per milestone** in `appsscript.json`. Adding a scope forces
  users to re-consent. The final scope set is in PLAN.md section 4.
- **Watch Later and History are not readable via the YouTube API.** Never call
  the API for them. We use our own playlist plus our own per-user Sheet
  (PLAN.md sections 2 and 6).
- `dist/`, `.clasp.json`, and `.clasprc.json` are gitignored. Never commit them.
