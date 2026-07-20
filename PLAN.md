# MyTube — Architecture Plan

A personal web app to watch YouTube without the parts that waste your time:
no algorithmic home feed, no recommendation rabbit hole. You see only your
subscriptions' uploads and your own playlists, you mark what you have seen,
and the player shows the video and little else.

This document is the agreed design. It is the reference for scaffolding and
building. It is written to be readable without prior Google Apps Script
knowledge.

---

## 1. Goals and non-goals

**Goals**

- Show new uploads from the channels you are subscribed to.
- List your YouTube playlists, including a real "Watch Later" playlist that the
  app can add to and remove from.
- Remember your own watch history by a manual "Mark as seen" action, stored
  outside YouTube so it never feeds YouTube's recommendations.
- Embedded player with basic controls and no recommendation rabbit hole.
- A search box that (for now) redirects to the YouTube website.
- Anyone can log in with their Google account and get these features for their
  own account.

**Non-goals (for v1)**

- In-app search results (expensive in API quota; redirect instead).
- A polished single-page-app feel with instant transitions.
- Many public users / a public launch (the platform has a ceiling, see below).

---

## 2. Hard constraints discovered (the "why" behind the design)

| Constraint                                                                                                                                                      | Effect on design                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| YouTube's special "Watch Later" and "History" playlists are not readable via the API (since 2016).                                                              | We do not try to read them. We create our **own** real playlist to use as Watch Later, and we store history ourselves.                                   |
| The embed parameter `rel=0` no longer removes recommendations (since 2018); it only limits related videos to the same channel. `modestbranding` is now ignored. | We cannot strip every recommendation pixel. Instead we detect video end and immediately show a "next / mark seen" card, so the end-screen never appears. |
| Reading and managing YouTube data uses a "sensitive" permission.                                                                                                | Unverified app shows a warning and has a total-user cap (~100). Fine for personal scale; verify later only if it grows.                                  |
| In-app search (`search.list`) costs 100 quota units per call out of 10,000/day.                                                                                 | v1 search redirects to youtube.com instead of calling the API.                                                                                           |

---

## 3. Platform decision: Google Apps Script (GAS)

**Chosen for v1.** GAS is JavaScript that runs on Google's servers. It gives us,
for free and with no servers to run:

- Built-in Google login (no auth code to write).
- A built-in YouTube "Advanced Service" wrapping the YouTube Data API.
- Per-user storage and the ability to act as each logged-in user.

**The ceiling (when we would outgrow GAS):** a fast polished UI, heavy data, or
a real public launch. If that day comes, the data model below ports cleanly to
a small Next.js app with Google login. So GAS now is not a dead end.

---

## 4. Login, permissions, and deployment model

This is the part that makes "anyone logs in and sees their own data" work.

- **Deploy setting "Execute as: User accessing the web app."** This makes the
  server code run as each logged-in person, so each one sees and manages their
  own YouTube account. (The alternative, "Execute as: me," would make everyone
  use the owner's account — wrong for us.)
- **Access setting "Anyone with a Google Account."** They must log in, but they
  do not need to be invited.
- **Publishing status "In production" (unverified).** Any external user can
  authorize by clicking past the "unverified app" warning. They are not blocked.
  - _Not_ "Testing" status: that limits to invited test users and forces a
    weekly re-login.
  - There is a total-user cap on unverified apps (~100 accounts ever). At our
    volume this lasts well over a year; Google warns us as we approach it.
- **Permission requested: a single sensitive scope `https://www.googleapis.com/auth/youtube`**
  ("Manage your YouTube account"). This one scope covers reading subscriptions
  and playlists _and_ creating/editing the Watch Later playlist. We do not need
  `youtube.force-ssl` because we never post comments or captions.
- **Reading public data (other people's comments, video descriptions, RSS
  feeds) needs no user permission** — it uses a plain API key or a public HTTP
  request.

**Restricting access later** is trivial: change the access setting, or add a
small allow-list check in code against the logged-in email
(`Session.getActiveUser().getEmail()`). Tightening is instant; only loosening to
a fully public, warning-free app needs Google verification.

**Optional: a no-login landing page.** Because the consent screen for write
access looks scary to a stranger, we can serve a public page (app description +
a sample feed via RSS, no login, no permission) so people can understand the app
before deciding to log in. Marked optional below.

---

## 5. Where each feature gets its data

| Feature                                  | Source                                                                                       | Quota cost              |
| ---------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------- |
| Channel list (who you are subscribed to) | `subscriptions.list` (mine), paginated 50/page; cached                                       | 1 unit/page             |
| New uploads feed                         | Per-channel RSS: `https://www.youtube.com/feeds/videos.xml?channel_id=ID`                    | 0 (plain fetch)         |
| Your playlists                           | `playlists.list` (mine) + `playlistItems.list`                                               | 1 unit each             |
| Watch Later (option C)                   | A real playlist we create; add via `playlistItems.insert`, remove via `playlistItems.delete` | 50 units per add/remove |
| Watch history                            | Stored by us (see section 6); "Mark as seen" button                                          | 0                       |
| Player                                   | YouTube IFrame Player API in the page                                                        | 0                       |
| Video description                        | `videos.list` (part=snippet)                                                                 | 1 unit                  |
| Comments                                 | `commentThreads.list`                                                                        | 1 unit                  |
| Playlist position                        | We track the index in our own list                                                           | 0                       |
| Resume playback position                 | Stored by us (see section 6); saved by the player, synced across devices                     | 0                       |
| Search                                   | Redirect to `youtube.com/results?search_query=...`                                           | 0                       |

**Uploads strategy (important):** we call `subscriptions.list` only occasionally
to learn your channel IDs and cache them. The actual "new videos" feed comes
from each channel's RSS, which is free and needs no API quota. RSS returns only
the latest ~15 videos per channel, which is exactly what a "what's new" feed
wants. In GAS we fetch many RSS feeds in parallel with `UrlFetchApp.fetchAll`.
Because each channel's parsed videos are cached for 30 minutes and a plain load
only refetches expired channels, the UI also warms the feed in the background
from every non-feed screen (the app lands on Watch Later): it prefetches page 1
so opening the feed is instant. This moves the same fetches earlier rather than
adding volume, and RSS costs no API quota either way.

---

## 6. Data storage model

Two kinds of data, stored in two places:

- **Watch Later = a real YouTube playlist** (your option C). The app creates a
  playlist named e.g. "MyTube — Watch Later" on first use, stores its playlist
  ID, and adds/removes videos with the write permission. It syncs with your
  phone's YouTube app. This is the only place we write to YouTube.
- **History and settings = stored by us, per user.**
  - **History** (which videos you marked seen, and when): `PropertiesService`
    user properties, chunked across keys and capped at ~500 recent entries.
    (Originally a Google Sheet; moved to properties to drop the `spreadsheets`
    scope. See ADR 0005.)
  - **Resume positions** (where playback stopped in each video, so the player
    picks up where you left off — on any device, since the store is server-side
    per user): `PropertiesService` user properties, chunked like the history
    and capped at ~500 most-recently-saved entries.
  - **Small settings** (the Watch Later playlist ID, autoplay toggle, cached
    channel IDs, last-refresh time): `PropertiesService` user properties.
    Reason: tiny key/value data, fastest to read, no Sheet needed.

Because we deploy "execute as user accessing," both the Sheet and the user
properties are automatically private to each user. There is no shared central
database to secure.

---

## 7. Quota plan

- Default YouTube Data API quota is **10,000 units/day** (per the app's Google
  Cloud project, shared across all users).
- Heaviest costs: each Watch Later add/remove is 50 units; everything else we
  use is 1 unit; RSS is free.
- We cache the channel list and recent feed results (in user properties or
  `CacheService`, ~6h) so opening the app does not re-spend quota every time.
- At a few users and normal use, daily usage is a tiny fraction of 10,000. If we
  ever approach it, we request a quota increase from Google.

---

## 8. Tech stack and repository layout

- **Server language: TypeScript** (your standard: typed, explicit). Compiled and
  bundled to a single Apps-Script-compatible file before upload. Modern `clasp`
  (the Apps Script CLI) no longer transpiles TypeScript by itself, so we use a
  bundler (**esbuild** with a small plugin that exposes entry-point functions
  like `doGet` to the global scope, or **Rollup**). _Exact bundler config is
  finalized at scaffold time._
- **Frontend: one HTML file** served by `HtmlService`, containing HTML, CSS, and
  browser JavaScript. We start with vanilla JS plus the YouTube IFrame Player
  API; a small library (Alpine/htmx) can be added later if needed. The browser
  calls server functions with `google.script.run.fn().withSuccessHandler(...)`.
- **CLI: `clasp`** links the local folder to the Apps Script project
  (`clasp push` uploads, `clasp deploy` publishes a web app version).

Proposed layout (finalized at scaffold):

```
MyTube/
  PLAN.md                 # this file
  README.md               # human setup/run/deploy (created at scaffold)
  CLAUDE.md               # agent guidance (created at scaffold)
  .clasp.json             # links local folder to the script (gitignored)
  appsscript.json         # manifest: scopes, advanced services, web app config
  package.json            # devDeps: typescript, esbuild, clasp
  tsconfig.json
  build.mjs               # esbuild bundle step
  src/
    server/               # TypeScript server code -> bundled to one .gs
      main.ts             # doGet, routing
      youtube.ts          # subscriptions, playlists, watch-later, videos, comments
      feed.ts             # RSS fetch + parse
      history.ts          # the per-user Sheet
      settings.ts         # PropertiesService helpers
    ui/
      index.html          # the single page (HTML + CSS + browser JS)
  .github/workflows/
    deploy.yml            # auto-deploy on push to main
```

---

## 9. Build and deploy pipeline

**Local loop:** edit TypeScript in VS Code -> `npm run build` (esbuild) ->
`clasp push` -> reload the web app. Or one `npm run deploy` script chaining
build + push + deploy.

**Auto-deploy on push to main (GitHub Actions):** on every push to `main`, the
workflow installs dependencies, builds, recreates the clasp login file from a
GitHub secret, then runs `clasp push` and `clasp deploy`.

- Secrets needed: `CLASPRC_JSON` (the clasp login / refresh token), `CLASP_JSON`
  (links to the script id), and a `DEPLOYMENT_ID` to update the same web app
  version each time.
- Caveat: the stored login token can expire and need refreshing in the secret.
- `.clasp.json` and `.clasprc.json` are gitignored (they contain credentials).

---

## 10. Suggested build order (milestones)

1. **Scaffold + hello world:** TS + esbuild + clasp + a `doGet` page that says
   "logged in as <email>". Confirms login and deploy pipeline end to end.
2. **Subscriptions + uploads feed:** fetch and cache channel IDs, read RSS,
   render the "new videos" list.
3. **Player page:** IFrame player, basic controls, description, end-of-video
   "next / mark seen" card; autoplay-next toggle for playlists.
4. **History:** per-user Sheet, "Mark as seen" button, seen-state on the feed.
5. **Playlists + Watch Later (option C):** list playlists; create and manage the
   Watch Later playlist (add/remove).
6. **Comments + search redirect.**
7. **Polish:** caching, layout, optional no-login landing page.
8. **GitHub Actions auto-deploy** (can be wired at step 1 and refined here).

---

## 11. One-time manual setup (things only you can do)

These need your Google login and cannot be automated by code. We do them
together when scaffolding:

1. Create the Apps Script project (or `clasp create`).
2. Link it to a standard Google Cloud project.
3. In that Cloud project: enable the YouTube Data API, configure the OAuth
   consent screen (External, scope `.../auth/youtube`), set publishing status to
   "In production."
4. Enable the YouTube Advanced Service in the Apps Script editor.
5. `clasp login` locally, then add the resulting credentials as GitHub secrets.

---

## 12. Decisions I made by default (tell me to change any)

- **History storage = a per-user Google Sheet** (vs the smaller
  `PropertiesService`), because history grows. Settings stay in properties.
- **Watch Later = option C**, a real YouTube playlist managed from the app
  (your choice), using the `youtube` write permission.
- **No-login landing page = optional**, planned for the polish step, not v1.
- **Frontend language = TypeScript components**, bundled into the page with
  esbuild (your choice). Typed and reusable; adds a small frontend build step.

---

## 13. Component reuse architecture

**Principle: the app is almost entirely "lists of videos" plus "one player."**
We build a small set of components once and reuse them on every screen. No
screen gets its own copy of the player or the list.

**One normalized data type.** Every source maps to the same `Video` shape:
`{ videoId, title, channelId, channelTitle, thumbnailUrl, publishedAt, durationSeconds?, seen }`.
Source adapters all return `Video[]`, so the same UI can render any of them:

| Adapter                   | Where the data comes from                             |
| ------------------------- | ----------------------------------------------------- |
| `getUploadsFeed()`        | per-channel RSS                                       |
| `getPlaylist(playlistId)` | `playlistItems.list`                                  |
| `getWatchLater()`         | `getPlaylist(watchLaterId)` — reuse at the data layer |
| `getHistory()`            | the per-user Sheet                                    |

**Shared UI components (built once, used everywhere):**

- `VideoCard` — one video: thumbnail, title, channel, seen badge, action buttons.
- `VideoListView` — renders a `Video[]` as cards; handles seen-state and
  per-item actions; exposes "play at index N." Used by the feed, every playlist,
  Watch Later, history, and later search.
- `PlayerView` (the "playlist player" you named) — input is an ordered `Video[]`
  queue, a start index, and a context label. It embeds the IFrame player, shows
  position ("3 of 12"), prev/next, the autoplay-next toggle, the end-of-video
  "next / mark seen" card, the description, and comments. **Identical for Watch
  Later and every playlist**, because both are just an ordered `Video[]`.
- `AppShell` — sidebar (Feed, Watch Later, Playlists, History) plus the search
  box; hosts whichever view is active.

**Watch Later is not a special screen.** It is `VideoListView` + `PlayerView`
pointed at the Watch Later playlist, with add/remove actions turned on by a
prop. Other playlists use the exact same components with those actions off. The
only differences are the source ID and one boolean.

**One entry point to playback.** Any list calls
`openPlayer(queue, startIndex, contextLabel)`. "Play this playlist," "Play Watch
Later," and "Play from the feed" are the same call with different data.
