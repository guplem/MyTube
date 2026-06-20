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
const SEEN_BEFORE_KEY = "seenBeforeDate"; // a single date cutoff, not per-video history

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
}

/** Removes a video from the watch history. No-op if it was not recorded. */
export function removeVideoSeen(videoId: string): void {
  const entries = readEntries();
  const remaining = entries.filter((entry) => entry.videoId !== videoId);
  if (remaining.length !== entries.length) writeEntries(remaining);
}

/** All seen video ids, used to flag videos in other lists. */
export function getSeenVideoIds(): string[] {
  return readEntries().map((entry) => entry.videoId);
}

/**
 * Date (YYYY-MM-DD) before which every video is treated as seen, or "" if unset.
 * This is one stored cutoff instead of 1000+ history rows, so "mark everything
 * before X as seen" stays cheap and never hits the history entry cap.
 */
export function getSeenBeforeDate(): string {
  return PropertiesService.getUserProperties().getProperty(SEEN_BEFORE_KEY) ?? "";
}

/** Sets the seen-before cutoff date, or clears it when given "". */
export function setSeenBeforeDate(date: string): void {
  const properties = PropertiesService.getUserProperties();
  if (date) properties.setProperty(SEEN_BEFORE_KEY, date);
  else properties.deleteProperty(SEEN_BEFORE_KEY);
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

function readEntries(): HistoryEntry[] {
  const all = PropertiesService.getUserProperties().getProperties();
  const chunkKeys = Object.keys(all)
    .filter((key) => key.startsWith(CHUNK_PREFIX))
    .sort((a, b) => chunkIndex(a) - chunkIndex(b));
  if (chunkKeys.length === 0) return [];
  try {
    return JSON.parse(chunkKeys.map((key) => all[key]).join("")) as HistoryEntry[];
  } catch {
    return [];
  }
}

function writeEntries(entries: HistoryEntry[]): void {
  const properties = PropertiesService.getUserProperties();
  // Start from the current store so non-history properties survive, drop old
  // history chunks, then add the new ones and write everything in one call.
  const next = properties.getProperties();
  for (const key of Object.keys(next)) {
    if (key.startsWith(CHUNK_PREFIX)) delete next[key];
  }
  const json = JSON.stringify(entries);
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
