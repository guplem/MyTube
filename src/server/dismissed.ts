// Per-user list of videos the user dismissed from the feed. Stored in the same
// per-user PropertiesService as the watch history, but we keep only the video
// ids (there is no "dismissed" screen, we only need to hide them from the feed),
// so it stays small. The id list is split across numbered chunk properties like
// the history, because one property value is capped at ~9KB.
//
// This mirrors history.ts on purpose: dismissing is the same idea as marking
// seen, but aimed only at hiding videos from the feed.

const CHUNK_PREFIX = "dismissed_";
const CHUNK_SIZE = 3000; // chars; stays under the 9KB-per-value limit
const MAX_IDS = 2000; // keep the most recent; bounds the store

/** Marks a video dismissed. No-op if already dismissed. */
export function markVideoDismissed(videoId: string): void {
  const ids = readIds();
  if (ids.includes(videoId)) return;
  ids.push(videoId);
  writeIds(ids.slice(-MAX_IDS));
}

/** Removes a video from the dismissed list (un-dismisses it). No-op if absent. */
export function removeVideoDismissed(videoId: string): void {
  const ids = readIds();
  const remaining = ids.filter((id) => id !== videoId);
  if (remaining.length !== ids.length) writeIds(remaining);
}

/** All dismissed video ids, used to flag and hide videos in the feed. */
export function getDismissedVideoIds(): string[] {
  return readIds();
}

function readIds(): string[] {
  const all = PropertiesService.getUserProperties().getProperties();
  const chunkKeys = Object.keys(all)
    .filter((key) => key.startsWith(CHUNK_PREFIX))
    .sort((a, b) => chunkIndex(a) - chunkIndex(b));
  if (chunkKeys.length === 0) return [];
  try {
    return JSON.parse(chunkKeys.map((key) => all[key]).join("")) as string[];
  } catch {
    return [];
  }
}

function writeIds(ids: string[]): void {
  const properties = PropertiesService.getUserProperties();
  // Start from the current store so other properties (history, etc.) survive,
  // drop old dismissed chunks, then write everything in one call.
  const next = properties.getProperties();
  for (const key of Object.keys(next)) {
    if (key.startsWith(CHUNK_PREFIX)) delete next[key];
  }
  const json = JSON.stringify(ids);
  let index = 0;
  for (let offset = 0; offset < json.length; offset += CHUNK_SIZE) {
    next[CHUNK_PREFIX + index] = json.slice(offset, offset + CHUNK_SIZE);
    index += 1;
  }
  properties.setProperties(next, true);
}

function chunkIndex(key: string): number {
  return Number(key.slice(CHUNK_PREFIX.length));
}
