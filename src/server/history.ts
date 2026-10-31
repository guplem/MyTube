// Per-user watch history, stored in the script's own PropertiesService (no extra
// OAuth scope) so it stays private and never feeds YouTube's recommendations.
//
// We deliberately do NOT use a Google Sheet: that needed the `spreadsheets`
// scope, and adding that scope to an already-authorized web app made Google's
// in-page consent dialog crash, blocking the whole app. PropertiesService needs
// no scope, so the app runs on the permissions granted at first use. See
// PLAN.md section 6 and ADR 0005.
//
// A property value is capped at ~9KB, so the history JSON is split across
// numbered chunk properties and written in a single batch call.

import type { Video } from "../shared/video";

const CHUNK_PREFIX = "history_";
const CHUNK_SIZE = 3000; // chars; stays under the 9KB-per-value limit even for multi-byte text
const MAX_ENTRIES = 500; // keep the most recent; bounds the 500KB store

interface HistoryEntry {
  videoId: string;
  title: string;
  channelId: string;
  channelTitle: string;
  thumbnailUrl: string;
  publishedAt: string;
  seenAt: string;
}

/** Records a video as seen (the manual "mark as seen" action). No-op if already recorded. */
export function markVideoSeen(video: Video): void {
  withUserLock(() => {
    const entries = readEntries();
    if (entries.some((entry) => entry.videoId === video.videoId)) return;
    entries.push({
      videoId: video.videoId,
      title: video.title,
      channelId: video.channelId,
      channelTitle: video.channelTitle,
      thumbnailUrl: video.thumbnailUrl,
      publishedAt: video.publishedAt,
      seenAt: new Date().toISOString(),
    });
    writeEntries(entries.slice(-MAX_ENTRIES));
  });
}

/** Removes a video from the watch history. No-op if it was not recorded. */
export function removeVideoSeen(videoId: string): void {
  withUserLock(() => {
    const entries = readEntries();
    const remaining = entries.filter((entry) => entry.videoId !== videoId);
    if (remaining.length !== entries.length) writeEntries(remaining);
  });
}

// Serializes the read-modify-write against concurrent executions of this user
// (optimistic UI taps fire server calls in parallel). Reads stay lock-free.
function withUserLock<T>(action: () => T): T {
  const lock = LockService.getUserLock();
  lock.waitLock(10000);
  try {
    return action();
  } finally {
    lock.releaseLock();
  }
}

/** All seen video ids, used to flag videos in other lists. Pass the user
 *  properties when the caller already read them. */
export function getSeenVideoIds(all?: { [key: string]: string }): string[] {
  return readEntries(all).map((entry) => entry.videoId);
}

/** The watch history as Video[], newest first. */
export function getHistory(): Video[] {
  return readEntries()
    .reverse()
    .map((entry) => ({
      videoId: entry.videoId,
      title: entry.title,
      channelId: entry.channelId,
      channelTitle: entry.channelTitle,
      thumbnailUrl: entry.thumbnailUrl,
      publishedAt: entry.publishedAt,
      seen: true,
    }));
}

function readEntries(
  all: {
    [key: string]: string;
  } = PropertiesService.getUserProperties().getProperties(),
): HistoryEntry[] {
  const chunkKeys = Object.keys(all)
    .filter((key) => key.startsWith(CHUNK_PREFIX))
    .sort((a, b) => chunkIndex(a) - chunkIndex(b));
  if (chunkKeys.length === 0) return [];
  try {
    return JSON.parse(
      chunkKeys.map((key) => all[key]).join(""),
    ) as HistoryEntry[];
  } catch {
    return [];
  }
}

function writeEntries(entries: HistoryEntry[]): void {
  const properties = PropertiesService.getUserProperties();
  // Merge only our own chunk keys so a concurrent execution's writes (the
  // subscriptions cache, the other module's chunks) are never clobbered. Write
  // the new chunks, then delete any leftover higher-index chunks from a
  // previously longer history.
  const chunks: { [key: string]: string } = {};
  const json = JSON.stringify(entries);
  let index = 0;
  for (let offset = 0; offset < json.length; offset += CHUNK_SIZE) {
    chunks[CHUNK_PREFIX + index] = json.slice(offset, offset + CHUNK_SIZE);
    index += 1;
  }
  properties.setProperties(chunks, false);
  const stale = Object.keys(properties.getProperties()).filter(
    (key) => key.startsWith(CHUNK_PREFIX) && chunkIndex(key) >= index,
  );
  for (const key of stale) properties.deleteProperty(key);
}

function chunkIndex(key: string): number {
  return Number(key.slice(CHUNK_PREFIX.length));
}
