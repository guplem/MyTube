// Per-user video playback positions ("resume where I left off"), stored in the
// same per-user PropertiesService as the watch history. Because storage is
// server-side and per Google account, a position saved on one device resumes
// the video on every other device with no extra sync work.
//
// Entries are kept in least-recently-saved-first order so the cap drops the
// videos the user touched longest ago. The JSON is split across numbered chunk
// properties like the history, because one property value is capped at ~9KB.
//
// The store is deliberately dumb: it persists whatever position it is given,
// keeps the PROGRESS_FINISHED marker (-1, "watched to the end" — the card
// shows a full bar and the player restarts from the top), and treats every
// other non-positive value as "clear". The policy for which positions are
// worth keeping lives in src/shared/videoProgress.ts, where the player
// applies it before calling here.

import { PROGRESS_FINISHED } from "../shared/videoProgress";

const CHUNK_PREFIX = "progress_";
const CHUNK_SIZE = 3000; // chars; stays under the 9KB-per-value limit
const MAX_ENTRIES = 500; // keep the most recently saved; bounds the store

interface ProgressEntry {
  videoId: string;
  seconds: number;
}

/**
 * Saves a video's playback position in whole seconds. PROGRESS_FINISHED is
 * stored as-is (a full-bar "watched to the end" marker); any other position
 * <= 0 clears the stored entry (the video restarts from the beginning next
 * time). Skips the write when nothing would change, so the player's periodic
 * saves cost no quota while paused.
 */
export function saveVideoProgress(videoId: string, seconds: number): void {
  // Floor only real positions: rounding must never turn a small negative
  // value into the finished marker.
  const position = seconds > 0 ? Math.floor(seconds) : seconds;
  withUserLock(() => {
    const entries = readEntries();
    const existing = entries.find((entry) => entry.videoId === videoId);
    if (position <= 0 && position !== PROGRESS_FINISHED) {
      if (!existing) return;
      writeEntries(entries.filter((entry) => entry.videoId !== videoId));
      return;
    }
    if (existing && existing.seconds === position) return;
    // Re-append so the entry becomes the most recent for the recency cap.
    const remaining = entries.filter((entry) => entry.videoId !== videoId);
    remaining.push({ videoId, seconds: position });
    writeEntries(remaining.slice(-MAX_ENTRIES));
  });
}

/** All stored positions as a videoId → seconds map, used to flag video lists. */
export function getProgressSeconds(): { [videoId: string]: number } {
  const progress: { [videoId: string]: number } = {};
  for (const entry of readEntries()) progress[entry.videoId] = entry.seconds;
  return progress;
}

// Serializes the read-modify-write against concurrent executions of this user
// (the player's periodic saves can race a save from another screen or device).
// Reads stay lock-free.
function withUserLock<T>(action: () => T): T {
  const lock = LockService.getUserLock();
  lock.waitLock(10000);
  try {
    return action();
  } finally {
    lock.releaseLock();
  }
}

function readEntries(): ProgressEntry[] {
  const all = PropertiesService.getUserProperties().getProperties();
  const chunkKeys = Object.keys(all)
    .filter((key) => key.startsWith(CHUNK_PREFIX))
    .sort((a, b) => chunkIndex(a) - chunkIndex(b));
  if (chunkKeys.length === 0) return [];
  try {
    return JSON.parse(
      chunkKeys.map((key) => all[key]).join(""),
    ) as ProgressEntry[];
  } catch {
    return [];
  }
}

function writeEntries(entries: ProgressEntry[]): void {
  const properties = PropertiesService.getUserProperties();
  // Merge only our own chunk keys so a concurrent execution's writes (the
  // history chunks, the subscriptions cache) are never clobbered. Write the new
  // chunks, then delete any leftover higher-index chunks from a longer list.
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
