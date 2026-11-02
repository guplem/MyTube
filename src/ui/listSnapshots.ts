// The last copy of the lists that open slowly, kept in localStorage so the
// next visit can show them at once (ADR 0011). The policy (which copy is
// valid, what to save) lives in src/shared/listSnapshot.ts; this module only
// reads and writes the browser storage.
//
// Two lists have a copy: the feed's first page and Watch Later. Each copy is
// tied to the account key that doGet embeds, because several Google accounts
// can share one browser.
//
// A copy must follow the user's taps, or the next visit would show a video the
// user already dismissed or removed. So each list registers a LIVE source: the
// very Video objects its cards change. optimistic() calls
// persistListSnapshots() after every apply and every revert, which saves each
// live source again.
//
// Watch Later membership also changes on other screens: the feed, the player,
// playlists and history save or remove a video through their own Video
// objects. Those screens call trackWatchLaterChange(video) before the write,
// and every save of the Watch Later copy applies those objects by id. This
// works even before the Watch Later screen loads in this session: the stored
// copy is the base then.
//
// The storage keys must NOT start with "mytube.": src/ui/preferences.ts owns
// that prefix, uploads every key under it and deletes the ones that the
// account set lacks.

import type { Video } from "../shared/video";
import {
  WATCH_LATER_SNAPSHOT_KEY,
  parseListSnapshot,
  withWatchLaterChanges,
  type ListSnapshot,
} from "../shared/listSnapshot";

export type SnapshotList = "feed" | "watchlater";

const STORAGE_PREFIX = "mytubeSnapshot:";

interface AccountKeyHost {
  // Undefined when the page carries no embed (a preview of the plain HTML).
  MYTUBE_ACCOUNT_KEY?: string;
}

interface LiveSource {
  key: string;
  read: () => { videos: Video[]; total: number };
}

const liveSources: Map<SnapshotList, LiveSource> = new Map();

// The latest object per video id whose Watch Later membership a tap changed
// since the last fresh Watch Later list. The object is read at save time, so
// a revert after a failed write is saved too.
const watchLaterChanges: Map<string, Video> = new Map();

function accountKey(): string {
  const key: unknown = (window as unknown as AccountKeyHost).MYTUBE_ACCOUNT_KEY;
  return typeof key === "string" ? key : "";
}

/** The saved copy of this list for this key, or null when none is valid. */
export function readListSnapshot(
  list: SnapshotList,
  key: string,
): ListSnapshot | null {
  try {
    return parseListSnapshot(
      window.localStorage.getItem(STORAGE_PREFIX + list),
      accountKey(),
      key,
      Date.now(),
    );
  } catch {
    return null;
  }
}

/** Saves the list now, and again after every later tap that changes it.
 *  `read` returns what to save; it reads the objects that the cards change. */
export function keepListSnapshot(
  list: SnapshotList,
  key: string,
  read: () => { videos: Video[]; total: number },
): void {
  liveSources.set(list, { key, read });
  // The fresh Watch Later list is the truth: it already holds every change
  // that the server took.
  if (list === "watchlater") watchLaterChanges.clear();
  saveListSnapshot(list, key, read());
}

/** Lets the Watch Later copy follow a membership change that a tap on this
 *  video makes on any screen. Call it before optimistic(), which saves. */
export function trackWatchLaterChange(video: Video): void {
  watchLaterChanges.set(video.videoId, video);
}

/** Saves every live source again. Called by optimistic() after each change. */
export function persistListSnapshots(): void {
  for (const [list, source] of liveSources)
    if (list !== "watchlater")
      saveListSnapshot(list, source.key, source.read());
  persistWatchLaterSnapshot();
}

function persistWatchLaterSnapshot(): void {
  const live: LiveSource | undefined = liveSources.get("watchlater");
  if (!live && watchLaterChanges.size === 0) return;
  // No live list yet this session: the stored copy is the base. No copy at
  // all: nothing to update, the next visit loads with placeholders.
  const base: Video[] | null = live
    ? live.read().videos
    : (readListSnapshot("watchlater", WATCH_LATER_SNAPSHOT_KEY)?.videos ??
      null);
  if (!base) return;
  const videos: Video[] = withWatchLaterChanges(base, [
    ...watchLaterChanges.values(),
  ]);
  saveListSnapshot("watchlater", WATCH_LATER_SNAPSHOT_KEY, {
    videos,
    total: videos.length,
  });
}

function saveListSnapshot(
  list: SnapshotList,
  key: string,
  content: { videos: Video[]; total: number },
): void {
  const account: string = accountKey();
  if (!account) return;
  const snapshot: ListSnapshot = {
    account,
    key,
    savedAt: Date.now(),
    videos: content.videos,
    total: content.total,
  };
  try {
    window.localStorage.setItem(
      STORAGE_PREFIX + list,
      JSON.stringify(snapshot),
    );
  } catch {
    // Storage full or blocked: the next visit loads with placeholders.
  }
}
