# MyTube

A personal web app to watch YouTube without the home feed or the recommendation
rabbit hole. It shows your subscriptions' uploads, your playlists (including a
self-managed "Watch Later"), and your own watch history. Built on Google Apps
Script, so anyone can log in with their Google account and use it for their own
account, with no server to run.

Full design and the reasoning behind every choice: [PLAN.md](PLAN.md).

## How it is built

- Server code: TypeScript in `src/server/`.
- Browser code: TypeScript in `src/ui/`.
- `esbuild` bundles both into `dist/`; `clasp` (the Apps Script CLI) uploads
  `dist/` to your Apps Script project.

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
2. **Link a standard Google Cloud project.** In the Apps Script editor: Project
   Settings, then set a Google Cloud Platform project. In that Cloud project:
   - Enable the **YouTube Data API v3** (needed from milestone 2 on).
   - Configure the **OAuth consent screen** (User type: External). Add scopes as
     the app grows; the final list is in PLAN.md section 4. For the current
     milestone only `userinfo.email` is used, which shows no warning.
   - Set publishing status to **In production** when you want anyone to log in.
     PLAN.md section 4 explains the unverified-app warning and the user cap.
3. **Enable the YouTube advanced service** in the Apps Script editor (Services,
   then add YouTube) when you reach milestone 2.

## Develop

```
npm run build       # bundle into dist/
npm run typecheck   # report type errors only
npm run deploy      # build, then clasp push, then clasp deploy
```

Open the web app URL that `clasp deploy` prints, or find it in the Apps Script
editor under Deploy, then Manage deployments.

## Auto-deploy on push to main (optional)

`.github/workflows/deploy.yml` deploys on every push to `main`. Add these
repository secrets (GitHub: Settings, Secrets and variables, Actions):

- `CLASPRC_JSON` — contents of your `~/.clasprc.json` (created by `clasp login`).
- `CLASP_JSON` — contents of your project `.clasp.json`.
- `DEPLOYMENT_ID` — the deployment to update (`npx clasp deployments` lists ids).

Never commit the real `.clasp.json` or `.clasprc.json`; both are gitignored
because they hold credentials.
