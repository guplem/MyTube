// The policy behind the instant preview of a list (ADR 0011). Every list loads
// through an Apps Script call that takes seconds. So the browser keeps the
// last copy of the feed's first page and of Watch Later, shows that copy at
// once, and loads the fresh list behind it. Pure rules, kept out of src/ui/ so
// tests pin them without a browser.
//
// Two rules matter most:
//
// 1. A copy belongs to ONE Google account. Several accounts can share one
//    browser, and so one localStorage, so every copy carries the account key
//    that doGet embeds in the page.
// 2. The fresh list never moves a card that the user can see. It replaces the
//    preview only when it adds or drops videos at the END
//    (freshListMovesNothing). Any other change waits for the user to tap.

import type { Video } from "./video";
import type { FeedPageOptions } from "./feed";
import { belongsInFeed, remainingFeedTotal } from "./feedInclusion";

// A preview older than this tells the user little about the list today.
export const LIST_SNAPSHOT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface ListSnapshot {
  /** The account key that doGet embedded when the copy was saved. */
  account: string;
  /** Which list, and for the feed which filters, the copy shows. */
  key: string;
  /** Date.now() at the save. */
  savedAt: number;
  videos: Video[];
  /** The count the list showed: the feed's server total, else videos.length. */
  total: number;
}

/** The saved copy, or null when it is missing, broken, too old, empty, or
 *  saved for another account or another key. */
export function parseListSnapshot(
  raw: string | null,
  account: string,
  key: string,
  now: number,
): ListSnapshot | null {
  if (raw === null || !account) return null;
  let value: Partial<ListSnapshot>;
  try {
    value = JSON.parse(raw) as Partial<ListSnapshot>;
  } catch {
    return null;
  }
  if (
    typeof value !== "object" ||
    value === null ||
    value.account !== account ||
    value.key !== key ||
    typeof value.savedAt !== "number" ||
    now - value.savedAt > LIST_SNAPSHOT_MAX_AGE_MS ||
    !Array.isArray(value.videos) ||
    value.videos.length === 0 ||
    typeof value.total !== "number"
  )
    return null;
  return value as ListSnapshot;
}

/** True when showing `freshIds` in place of `previewIds` moves no card: the
 *  same list, or one that only gains or loses videos at the end. Pass
 *  `visibleCount` when only the first cards are on show (an in-memory list
 *  shows one page): a change past them moves nothing that the user sees. */
export function freshListMovesNothing(
  previewIds: readonly string[],
  freshIds: readonly string[],
  visibleCount: number = Infinity,
): boolean {
  const shorter: number = Math.min(
    previewIds.length,
    freshIds.length,
    visibleCount,
  );
  for (let index = 0; index < shorter; index += 1)
    if (previewIds[index] !== freshIds[index]) return false;
  return true;
}

/** How many fresh videos the preview did not show, for the "N new" label. */
export function newVideoCount(
  previewIds: readonly string[],
  freshIds: readonly string[],
): number {
  const shown: Set<string> = new Set(previewIds);
  return freshIds.filter((id: string): boolean => !shown.has(id)).length;
}

/** The Watch Later videos to save. A video removed this session stays on
 *  screen, dimmed, but the next preview must not show it. */
export function watchLaterSnapshotVideos(videos: readonly Video[]): Video[] {
  return videos.filter((video: Video): boolean => video.inWatchLater !== false);
}

/** The key of a feed copy. The date filter is left out on purpose: its
 *  default is a date computed from today, so a key with it would never match
 *  on the first visit of a day. A changed filter never shows a preview anyway
 *  (see showFeed in src/ui/main.ts). */
export function feedSnapshotKey(options: FeedPageOptions): string {
  return (
    "feed:" +
    JSON.stringify({
      pageSize: options.pageSize,
      hideShorts: options.hideShorts,
      hideViewed: options.hideViewed,
      hideDismissed: options.hideDismissed,
      hideSaved: options.hideSaved,
    })
  );
}

/** The feed videos and total to save. A video the user dealt with this
 *  session stays on screen, dimmed, but the next preview must not show it. */
export function feedSnapshotPage(
  videos: readonly Video[],
  total: number,
  options: FeedPageOptions,
): { videos: Video[]; total: number } {
  return {
    videos: videos.filter((video: Video): boolean =>
      belongsInFeed(video, options),
    ),
    total: remainingFeedTotal(total, videos, options),
  };
}
