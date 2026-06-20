# 5. Store watch history in PropertiesService, not a Google Sheet

Status: Accepted (supersedes the Sheet approach in PLAN.md section 6)

## Context

Milestone 4 stored watch history in a per-user Google Sheet, which needs the
`spreadsheets` scope ("see, edit, create, and delete all your spreadsheets") —
a broad fourth sensitive scope. We removed it while debugging an (unrelated)
load failure, and chose to keep it removed once the app worked again.

## Decision

Store watch history in the script's per-user `PropertiesService`, which needs no
OAuth scope. The history JSON is split across numbered chunk properties (the
9KB-per-value limit) and capped at the most recent 500 entries.

## Consequences

- One fewer sensitive scope: simpler consent, less to authorize, smaller privacy
  surface.
- History is capped at ~500 entries (the Sheet was unbounded) and is not visible
  as a file in the user's Drive.
- If unbounded or exportable history is wanted later, revert to a Sheet and
  re-add the `spreadsheets` scope.
