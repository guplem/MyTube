# 4. One Video type, one VideoListView, one PlayerView

Status: Accepted

## Context

The app is almost entirely "lists of videos" plus "one player." Without a shared
model, each screen would grow its own copy of the list and the player. Full
design in PLAN.md section 13.

## Decision

Normalize every data source to a single `Video` type via adapters that return
`Video[]`. Render every list with one `VideoListView` and play everything with
one `PlayerView`. Watch Later is the playlist screen with add/remove enabled by a
prop, not a separate screen.

## Consequences

- A new data source is a new adapter, never a new screen.
- Playback has one entry point: `openPlayer(queue, startIndex, label)`.
- Per-source differences are props (for example, edit actions), not forks.
