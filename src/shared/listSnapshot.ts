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
//    (freshListMovesNothing). Any other change shows a short countdown
//    first, so the user sees the move coming and can stop it.

import type { Video } from "./video";
import type { FeedPageOptions } from "./feed";
import { belongsInFeed, remainingFeedTotal } from "./feedInclusion";
import { countLabel } from "./countLabel";

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

/** The key of the Watch Later copy. */
export const WATCH_LATER_SNAPSHOT_KEY = "watchlater";

/** The Watch Later copy with the membership changes made on other screens.
 *  A save from the feed or the player changes another object for the video,
 *  so the copy matches by id. Without this, the next visit's copy lacks the
 *  saved video, and the fresh list then moves cards. A video whose
 *  `inWatchLater` is still undefined changed nothing that is known. */
export function withWatchLaterChanges(
  base: readonly Video[],
  changed: readonly Video[],
): Video[] {
  const removed: Set<string> = new Set();
  const added: Video[] = [];
  for (const video of changed) {
    if (video.inWatchLater === false) removed.add(video.videoId);
    else if (video.inWatchLater === true) added.push(video);
  }
  const result: Video[] = base.filter(
    (video: Video): boolean => !removed.has(video.videoId),
  );
  const present: Set<string> = new Set(
    result.map((video: Video): string => video.videoId),
  );
  for (const video of added) {
    if (present.has(video.videoId)) continue;
    present.add(video.videoId);
    result.push(video);
  }
  return result;
}

/** How long the notice waits before the fresh list replaces a preview whose
 *  cards it moves. Long enough to read and to tap Cancel, short enough that
 *  the list feels live. */
export const LIST_UPDATE_COUNTDOWN_SECONDS = 5;

/** The countdown notice: "Showing 2 new videos in 5s". The short unit
 *  keeps the text to two lines on a phone. */
export function listUpdateCountdownLabel(
  added: number,
  secondsLeft: number,
): string {
  const what: string =
    added > 0
      ? "Showing " + countLabel(added, "new video", "new videos")
      : "Updating this list";
  return what + " in " + String(secondsLeft) + "s";
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
      hideUpcoming: options.hideUpcoming,
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

// The flags that a card toggle writes. A tap on the preview changes these on
// the preview's own Video objects, never on the fresh list's.
const TAPPED_FLAGS = ["seen", "inWatchLater", "dismissed"] as const;
type TappedFlag = (typeof TAPPED_FLAGS)[number];
export type PreviewFlags = Pick<Video, TappedFlag>;

/** The flags of each preview video as painted, before any tap. */
export function previewFlagsOf(
  videos: readonly Video[],
): Map<string, PreviewFlags> {
  const flags: Map<string, PreviewFlags> = new Map();
  for (const video of videos)
    flags.set(video.videoId, {
      seen: video.seen,
      inWatchLater: video.inWatchLater,
      dismissed: video.dismissed,
    });
  return flags;
}

/** Copies onto each fresh video every flag that a tap on the preview changed,
 *  so the user's last tap wins over a fresh list that the server read before
 *  the write landed. A flag that no tap changed keeps its fresh value: the
 *  copy is older than the server. Returns true when a fresh video changed. */
export function carryPreviewTaps(
  before: ReadonlyMap<string, PreviewFlags>,
  preview: readonly Video[],
  fresh: readonly Video[],
): boolean {
  const freshById: Map<string, Video> = new Map(
    fresh.map((video: Video): [string, Video] => [video.videoId, video]),
  );
  let changed = false;
  for (const tapped of preview) {
    const painted: PreviewFlags | undefined = before.get(tapped.videoId);
    const target: Video | undefined = freshById.get(tapped.videoId);
    if (!painted || !target) continue;
    for (const flag of TAPPED_FLAGS) {
      if (tapped[flag] === painted[flag] || target[flag] === tapped[flag])
        continue;
      (target as Record<TappedFlag, boolean | undefined>)[flag] = tapped[flag];
      changed = true;
    }
  }
  return changed;
}
