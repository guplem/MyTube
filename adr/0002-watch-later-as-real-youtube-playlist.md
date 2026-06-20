# 2. Watch Later is a real YouTube playlist managed from the app

Status: Accepted

## Context

YouTube's special "Watch Later" playlist is not readable via the API. We need a
Watch Later the app can read and edit. Options are compared in PLAN.md section 1.

## Decision

Use a normal YouTube playlist that the app creates and edits (PLAN.md option C).
This requires the `youtube` write scope.

## Consequences

- The list syncs with the user's real YouTube account and phone app, and the app
  can add and remove items from within the UI.
- The OAuth consent screen asks for "Manage your YouTube account," a scarier
  sensitive scope. One scope (`youtube`) still covers both read and write.
- Watch history stays app-managed (a per-user Sheet), separate from this, to keep
  it out of YouTube's recommendations (PLAN.md sections 2 and 6).
