# 11. Show an instant preview of the last copy of a list

Status: Accepted

## Context

Each list loads through an Apps Script call, and that call takes seconds. The user opens the app a few times a day, so almost every visit is a cold load. Before this decision, the feed and Watch Later showed placeholder ("skeleton") cards for the whole wait. ADR 0008 keeps one feed page in memory, but that page is gone when the browser closes the app.

Two facts shape the design. Several Google accounts can share one browser, and so one `localStorage` (the browser's local key-value store). The user also does not want cards to move unexpectedly: a card that shifts under a finger is worse than a slow load.

## Decision

The browser keeps the last copy of two lists in `localStorage`: the feed's first page and Watch Later. The next visit paints that copy at once and loads the fresh list behind it. This is the "stale-while-revalidate" pattern: show the old copy, then check for a new one.

- **A copy belongs to one account.** `doGet` embeds `Session.getTemporaryActiveUserKey()` in the page (`accountKeyJson`, read as `window.MYTUBE_ACCOUNT_KEY`). The key names the user without revealing who they are and needs no OAuth scope. Every copy carries it. `parseListSnapshot` in `src/shared/listSnapshot.ts` refuses a copy with another account, another key, an age over 7 days, or no videos. An empty account key turns previews off.
- **The preview can play, but not page.** `VideoListOptions.inert` turns off its paging: a page turned on the copy would be lost when the fresh list replaces it. The toggles (Watch Later, watched, dismiss) act at once through `optimistic()`, like on any card. Each server write sets a state ("mark watched"), it never flips one, so the user's last tap is the state that the server keeps.
- **A video played from the preview resumes from the server's position.** The copy's `progressSeconds` can be days old. Each list marks its preview objects (`markPreviewVideos` in `src/ui/previewTaps.ts`), and the player asks `getVideoProgress` for a marked video. The first video of a player waits for the answer, at most 2.5 seconds (`settleWithin`), then starts. A later video (prev/next) starts at once, because the outgoing video still plays and its progress save would land on the new one. When the answer differs, the player seeks to it, unless the viewer already moved more than 10 seconds from the start (`staleResumeCorrection` in `src/shared/videoProgress.ts`).
- **A tap on the preview carries over to the fresh list.** The tap changes the preview's own `Video` objects. A player opened on the preview also writes into them: its toggles and the resume position. The fresh list holds other objects, and the server can read it before the write lands. `previewFlagsOf` records the flags and the position of the copy as first painted. `carryPreviewTaps` (both in `src/shared/listSnapshot.ts`) copies onto each fresh video every field that a tap changed, and leaves every other field at its fresh value. It then moves its record up to the preview's current values, so it copies each change once and a later tap on the fresh card stands. `linkPreviewToFresh` in `src/ui/previewTaps.ts` runs it when the fresh list arrives, even when the user has moved on, and keeps the pair. `optimistic()` and the player's position save then call `carryLinkedPreviewTaps` after every write, on any screen. The fresh feed objects are the kept page (ADR 0008), so the kept page, the saved copy and the Feed nav button all hold the tap.
- **A loading bar shows the fresh load in flight.** Two thin lines cross the top of the page while the copy is on show. The bar is fixed to the page, so it moves no card. Reduced motion shows a still bar.
- **The fresh list never moves a visible card.** The fresh list replaces the preview by itself only when `freshListMovesNothing` is true: the same list, or a list that gains or loses videos at the end only. Watch Later compares only its first page, because the read-only copy shows only that page. Otherwise a snackbar at the bottom of the screen (`src/ui/listUpdatePill.ts`, the same style as every other toast) warns first: "Showing 2 new videos in 5s". When the countdown ends, the fresh list replaces the preview. "Show now" skips the wait. "Cancel" stops the countdown and leaves a "Show" button, so nothing moves until the user taps it. The warning gives the user time to stop a tap, and the list still updates without a tap.
- **A list that the user left opens no snackbar.** When the fresh list arrives while the user is in the player, `src/ui/listUpdatePill.ts` sees that its list left the page and shows the fresh list in the detached element without a countdown.
- **A fast load skips the pill.** `previewPainted` is set by the next animation frame, just before the browser paints. A load that answers sooner replaces a preview that nobody saw, so it never asks to be shown.
- **A failed load keeps the preview** and the snackbar offers "Retry".
- **A changed filter and Force refresh never show a copy.** The copy would show the list that the user just asked to change.
- **The copy follows the user's taps.** Each list registers a live source with `keepListSnapshot`: the same `Video` objects that its cards change. `optimistic()` calls `persistListSnapshots()` after every apply and every revert. The saved copy leaves out a video that the user dismissed, saved, or removed (`feedSnapshotPage`, `watchLaterSnapshotVideos`).
- **The feed key leaves out the date filter.** Its cutoff date moves every day, so a key with it would never match on the first visit of a day.
- **The storage prefix is `mytubeSnapshot:`, never `mytube.`.** `src/ui/preferences.ts` owns the `mytube.` prefix. It uploads every key under it and deletes the ones that the account set lacks.

`src/ui/feedPageCache.ts` saves the feed copy only while the loaded page is still the kept page (`keepFirstPageSnapshot`), so a slow load that the cache replaced cannot overwrite a newer copy.

**Rejected alternative:** replace the preview with the fresh list at once, even when cards move. The cards jump under the user's finger. This is the case that the countdown exists for: it warns before the cards move.

**Rejected alternative:** keep the preview toggles off until the fresh list lands. This was the first version. The user had to wait seconds to save or dismiss a video that was already on screen. The race with the load is real, but the carry-over above settles it: the last tap wins.

**Deferred alternative:** a periodic background trigger that warms the server caches. It needs the `script.scriptapp` scope, and a new scope forces every user to consent again. Revisit it only if the cold load stays too slow.

## Consequences

- The feed and Watch Later show real cards in the first frame of a visit. The fresh list follows after the Apps Script call.
- A copy can be up to 7 days old and can lag the server. The read-only preview and the snackbar are the guard.
- For the few seconds of the load, the user can toggle and play a card but cannot turn the page. A video played from the copy can start up to 2.5 seconds later, while the player asks for its position.
- A tap on the preview acts on the flags of the copy, which can lag the server. The write sets what the button showed, so the last tap still wins. A failed write rolls back the preview card, and the next carry copies the rollback to the fresh list too.
- When the fresh list reorders or removes a visible card, the cards move after the 5-second countdown, unless the user taps "Cancel".
- A new list that wants a preview must register a live source with `keepListSnapshot` and keep to the key and prefix rules above.
- A full or blocked `localStorage` only costs the preview: the next visit loads with placeholders.
- The Watch Later copy also follows membership changes made on other screens. The feed, the player, playlists and history call `trackWatchLaterChange(video)` before the write, and every save of the Watch Later copy applies those videos by id (`withWatchLaterChanges`). Without it, each video saved from the feed made the next Watch Later visit show the countdown. The fresh Watch Later list clears these changes, because it is the truth.
- The feed copy follows only the taps on its own `Video` objects. A tap on another screen (for example, mark watched on Watch Later for a video that is also on feed page 1) changes another copy of that video. The next feed preview can then differ from the fresh page, and the countdown shows once. This is accepted: it costs a few seconds and never shows a wrong state as current.
