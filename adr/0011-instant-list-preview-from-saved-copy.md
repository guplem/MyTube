# 11. Show an instant preview of the last copy of a list

Status: Accepted

## Context

Each list loads through an Apps Script call, and that call takes seconds. The user opens the app a few times a day, so almost every visit is a cold load. Before this decision, the feed and Watch Later showed placeholder ("skeleton") cards for the whole wait. ADR 0008 keeps one feed page in memory, but that page is gone when the browser closes the app.

Two facts shape the design. Several Google accounts can share one browser, and so one `localStorage` (the browser's local key-value store). The user also does not want cards to move unexpectedly: a card that shifts under a finger is worse than a slow load.

## Decision

The browser keeps the last copy of two lists in `localStorage`: the feed's first page and Watch Later. The next visit paints that copy at once and loads the fresh list behind it. This is the "stale-while-revalidate" pattern: show the old copy, then check for a new one.

- **A copy belongs to one account.** `doGet` embeds `Session.getTemporaryActiveUserKey()` in the page (`accountKeyJson`, read as `window.MYTUBE_ACCOUNT_KEY`). The key names the user without revealing who they are and needs no OAuth scope. Every copy carries it. `parseListSnapshot` in `src/shared/listSnapshot.ts` refuses a copy with another account, another key, an age over 7 days, or no videos. An empty account key turns previews off.
- **The preview is read-only.** `VideoListOptions.inert` turns off its toggles, its play target and its paging. A tap can then never act on a state the server has moved past: a player opened on the copy would show stale flags and resume from a stale position. A page turned on the copy would be lost when the fresh list replaces it. The preview cards are also not the kept feed page's `Video` objects, so ADR 0008's identity rule cannot break.
- **A loading bar shows the fresh load in flight.** Two thin lines cross the top of the page while the copy is on show. The bar is fixed to the page, so it moves no card. Reduced motion shows a still bar.
- **The fresh list never moves a visible card.** The fresh list replaces the preview by itself only when `freshListMovesNothing` is true: the same list, or a list that gains or loses videos at the end only. Watch Later compares only its first page, because the read-only copy shows only that page. Otherwise the pill (`src/ui/listUpdatePill.ts`) offers the fresh list with a "Show" button, and nothing moves until the user taps it.
- **A fast load skips the pill.** `previewPainted` is set by the next animation frame, just before the browser paints. A load that answers sooner replaces a preview that nobody saw, so it never asks to be shown.
- **A failed load keeps the preview** and the pill offers "Retry".
- **A changed filter and Force refresh never show a copy.** The copy would show the list that the user just asked to change.
- **The copy follows the user's taps.** Each list registers a live source with `keepListSnapshot`: the same `Video` objects that its cards change. `optimistic()` calls `persistListSnapshots()` after every apply and every revert. The saved copy leaves out a video that the user dismissed, saved, or removed (`feedSnapshotPage`, `watchLaterSnapshotVideos`).
- **The feed key leaves out the date filter.** Its default moves every day, so a key with it would never match on the first visit of a day.
- **The storage prefix is `mytubeSnapshot:`, never `mytube.`.** `src/ui/preferences.ts` owns the `mytube.` prefix. It uploads every key under it and deletes the ones that the account set lacks.

`src/ui/feedPageCache.ts` saves the feed copy only while the loaded page is still the kept page (`keepFirstPageSnapshot`), so a slow load that the cache replaced cannot overwrite a newer copy.

**Rejected alternative:** replace the preview with the fresh list at once, even when cards move. The cards jump under the user's finger. This is the case that the pill exists for.

**Rejected alternative:** let the preview toggles act. A tap would race with the load in flight, and it would act on a state that the server may have changed. It would also mutate objects that are not the kept page, which ADR 0008 forbids.

**Deferred alternative:** a periodic background trigger that warms the server caches. It needs the `script.scriptapp` scope, and a new scope forces every user to consent again. Revisit it only if the cold load stays too slow.

## Consequences

- The feed and Watch Later show real cards in the first frame of a visit. The fresh list follows after the Apps Script call.
- A copy can be up to 7 days old and can lag the server. The read-only preview and the pill are the guard.
- For the few seconds of the load, the user can read the list but not act on it.
- When the fresh list reorders or removes a visible card, the user must tap "Show" to see it.
- A new list that wants a preview must register a live source with `keepListSnapshot` and keep to the key and prefix rules above.
- A full or blocked `localStorage` only costs the preview: the next visit loads with placeholders.
- The copy follows only the taps on its own `Video` objects. A tap on another screen (for example, mark watched on Watch Later for a video that is also on feed page 1) changes another copy of that video. The next feed preview can then differ from the fresh page, and the user taps "Show" once. This is accepted: it costs one tap and never shows a wrong state as current.
