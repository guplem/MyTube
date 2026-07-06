# MyTube

A personal web app to watch YouTube without the home feed or the recommendation
rabbit hole. It shows your subscriptions' uploads, your playlists (including a
self-managed "Watch Later"), and your own watch history. Built on Google Apps
Script, so anyone can log in with their Google account and use it for their own
account, with no server to run. Storage is per user.

Full design and the reasoning behind every choice: [PLAN.md](PLAN.md).

## Live app

**https://script.google.com/macros/s/AKfycbxKXGIgGhnj4jFBsx9KvMLQW9tRbVToQN2jfyZXrGRcWUynjrX6oWBnUDleJZlvT9E1/exec**

Each visitor logs in with their own Google account and sees only their own data.
Because the app uses a sensitive YouTube scope and is not Google-verified, the
first time you open it Google shows a "Google hasn't verified this app" screen:
click **Advanced**, then **Go to MyTube (unsafe)** to continue. This is expected
for a personal app (see PLAN.md section 4).

Note that this shared instance has limited capacity: Google caps unverified
apps at roughly 100 users total, and all its YouTube API traffic shares one
daily quota. If the instance is full or slow, **deploying your own copy is the
supported path** — it is free, takes a few minutes, and gives you your own
quota. See [One-time Google setup](#one-time-google-setup) below.

## Features

- **Subscriptions feed** — newest uploads from the channels you are subscribed
  to, built from each channel's RSS feed (no recommendations). It is paged on the
  server, so even a 1000+ video feed loads a page at a time.
- **Feed filters** (remembered in your browser): Hide Shorts (by video length),
  Hide watched, Hide dismissed, and Hide videos older than a chosen date.
- **Dismiss** — a small cross on the top-right of a feed card hides videos you do
  not want to see again in the feed.
- **Watch history** — mark a video as watched (a button on the card or in the
  player). History is private and never sent to YouTube. "Hide watched" uses it.
  When you have watched a video to (effectively) the end but not marked it, the
  button shows a red dot suggesting the tap — on cards and in the player.
- **Playlists** — open any of your playlists, with a sort selector (playlist
  order, upload date newest/oldest first, or title).
- **Watch Later** — a real YouTube playlist the app creates and manages. Add or
  remove videos from any list; a video already saved shows a pressed
  "✓ Watch Later" button.
- **Player** — embedded YouTube player with previous/next, an autoplay toggle,
  the description and comments, and no end-screen recommendations.
- **Duration badge** on every thumbnail.
- **Search** — the search box opens YouTube's results page in a new tab.
- **Shareable URLs** — the open tab and video are stored in the URL, so browser
  back/forward and link sharing work.
- **Responsive** — works on phone and desktop.

## How it is built

- Server code: TypeScript in `src/server/` (runs on Google's servers).
- Browser code: TypeScript in `src/ui/`.
- `esbuild` bundles both into `dist/`; `clasp` (the Apps Script CLI) uploads
  `dist/` to your Apps Script project. Architecture details for contributors are
  in [CLAUDE.md](CLAUDE.md).

## Prerequisites

- Node.js 18 or newer, and npm.
- A Google account.

## Install

```
npm install
```

## One-time Google setup

You do these once. They need your Google login and cannot be scripted.

1. **Create the Apps Script project and link this folder to it.**
   ```
   npx clasp login
   npm run build
   npx clasp create --type webapp --title "MyTube" --rootDir dist
   ```
   `clasp create` writes `.clasp.json` with your script id. Confirm it contains
   `"rootDir": "dist"` (see `.clasp.json.example`).
   - Gotcha: clasp may write `.clasp.json` **inside `dist/`** instead of the
     project root. `clasp push`/`deploy` (run from the root) only look at the
     root and parent folders, never subfolders, so they report "No valid
     .clasp.json". If that happens, move it to the root:
     `Move-Item dist\.clasp.json .clasp.json`.
2. **Link a standard Google Cloud project.** In the Apps Script editor: Project
   Settings, then set a Google Cloud Platform project. In that Cloud project:
   - Enable the **YouTube Data API v3**.
   - Configure the **OAuth consent screen** (User type: External). The app
     requests three scopes (in `appsscript.json`):
     - `userinfo.email` — who is logged in.
     - `youtube` — manage your YouTube account (needed to create and edit the
       Watch Later playlist).
     - `youtube.force-ssl` — read video comments (the comment endpoints require
       this scope).
     - `script.external_request` — fetch channel RSS feeds.
   - Set publishing status to **In production** so anyone can log in. PLAN.md
     section 4 explains the unverified-app warning and the user cap.
3. **Enable the YouTube advanced service** in the Apps Script editor (Services,
   then add YouTube).

## Develop

```
npm run build       # bundle into dist/
npm run typecheck   # report type errors only
npm test            # run the test suite (Vitest)
npm run check       # typecheck + test + build (run before opening a PR)
npm run push        # build, then clasp push (upload without deploying)
npm run deploy      # build, push, then deploy to the fixed deployment URL
```

Development is **test-first** (red-green-refactor) and the tests are a required
gate: `npm test` must pass before a pull request merges to `main`
(`.github/workflows/ci.yml`). The suite runs the real server code on Node with
in-memory fakes for the Apps Script runtime — see the *Testing & development
protocol* in [CLAUDE.md](CLAUDE.md) and [adr/0006](adr/0006-test-first-with-faked-apps-script.md).

`npm run deploy` deploys to a **fixed deployment id**, so the Live app URL above
never changes; each deploy just adds a new version to it. (Running a bare
`clasp deploy` without `-i` would instead create a brand-new URL.)

## Deploy automatically on push to main

`.github/workflows/deploy.yml` builds and deploys to the same fixed URL on every
push to `main`. It is already configured for this repository via three Actions
secrets (GitHub: Settings, Secrets and variables, Actions):

- `CLASPRC_JSON` — contents of your `~/.clasprc.json` (created by `clasp login`).
- `CLASP_JSON` — contents of your project `.clasp.json`.
- `DEPLOYMENT_ID` — the deployment id to update (`npx clasp deployments` lists
  ids; it must match the id in the `npm run deploy` script).

To point everything at a different deployment, update the `DEPLOYMENT_ID` secret
and the id in the `deploy` script in `package.json`.

Never commit the real `.clasp.json` or `.clasprc.json`; both are gitignored
because they hold credentials.

## Auto-merge PRs

`.github/workflows/auto-merge.yml` flags every non-draft same-repo PR for
GitHub's native auto-merge, so it merges once the required `test` check passes —
no manual click. The merge is authorised by a **GitHub App token**, not the
default `GITHUB_TOKEN`: GitHub does not trigger workflows from `GITHUB_TOKEN`
pushes, so a merge made with it would land on `main` without firing the deploy
(the app would silently stop updating). Setup:

1. Settings → General → enable **Allow auto-merge**.
2. Branch protection on `main` requires the `test` status check (and **no**
   required review, or auto-merge waits forever for an approval).
3. Create a GitHub App installed on this repo with **Contents: read/write** and
   **Pull requests: read/write**. Store its App ID as the Actions **variable**
   `AUTOMERGE_APP_ID` (not sensitive) and a generated private key as the
   **secret** `AUTOMERGE_APP_PRIVATE_KEY`.

If those are missing the workflow simply fails to queue the PR, leaving
it for a manual merge — which itself triggers the deploy — so the worst case is
"not auto-merged", never "merged but not deployed".

To deploy the current `main` on demand (e.g. after a merge that didn't deploy),
use the **Run workflow** button on *Deploy to Apps Script* in the Actions tab
(`deploy.yml` also has a `workflow_dispatch` trigger).

## Troubleshooting

- **"No valid .clasp.json"** — the file is in `dist/` instead of the root; see
  the gotcha in step 1 above.
- **Stuck on a loading screen after a deploy** — a hard refresh usually fixes it;
  Apps Script serves the page inside an iframe that can cache aggressively.
- **A video has no duration badge for a moment** — durations are fetched and
  cached on first view; they appear on the next load.

## License

[MIT](LICENSE)
