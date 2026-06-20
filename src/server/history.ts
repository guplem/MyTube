// Per-user watch history, stored in a Google Sheet in the user's own Drive so it
// stays private and never feeds YouTube's recommendations. The sheet id is kept
// in user properties; the set of seen video ids is cached briefly so the feed
// does not read the sheet on every load. See PLAN.md sections 2 and 6.

import type { Video } from "../shared/video";

const SHEET_ID_KEY = "historySheetId";
const SEEN_IDS_CACHE_KEY = "seenVideoIds";
const SEEN_IDS_TTL_SECONDS = 600;
const HEADER = ["videoId", "title", "channelId", "channelTitle", "thumbnailUrl", "publishedAt", "seenAt"];

/** Records a video as seen (the manual "mark as seen" action). No-op if already recorded. */
export function markVideoSeen(video: Video): void {
  if (getSeenVideoIds().indexOf(video.videoId) !== -1) return;
  getHistorySheet().appendRow([
    video.videoId,
    video.title,
    video.channelId,
    video.channelTitle,
    video.thumbnailUrl,
    video.publishedAt,
    new Date().toISOString(),
  ]);
  CacheService.getUserCache().remove(SEEN_IDS_CACHE_KEY);
}

/** All seen video ids, used to flag videos in other lists. Cached briefly. */
export function getSeenVideoIds(): string[] {
  const cache = CacheService.getUserCache();
  const cached = cache.get(SEEN_IDS_CACHE_KEY);
  if (cached) {
    try {
      return JSON.parse(cached) as string[];
    } catch {
      // Corrupt cache entry; rebuild from the sheet.
    }
  }
  const ids = readRows().map((row) => String(row[0]));
  cache.put(SEEN_IDS_CACHE_KEY, JSON.stringify(ids), SEEN_IDS_TTL_SECONDS);
  return ids;
}

/** The watch history as Video[], newest first. */
export function getHistory(): Video[] {
  const videos: Video[] = readRows().map((row) => ({
    videoId: String(row[0]),
    title: String(row[1]),
    channelId: String(row[2]),
    channelTitle: String(row[3]),
    thumbnailUrl: String(row[4]),
    publishedAt: String(row[5]),
    seen: true,
  }));
  // Rows are appended in the order they were seen (oldest first), so reverse.
  return videos.reverse();
}

function readRows(): unknown[][] {
  const sheet = getHistorySheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return []; // only the header row, or empty
  return sheet.getRange(2, 1, lastRow - 1, HEADER.length).getValues();
}

function getHistorySheet(): GoogleAppsScript.Spreadsheet.Sheet {
  const properties = PropertiesService.getUserProperties();
  const existingId = properties.getProperty(SHEET_ID_KEY);
  if (existingId) {
    return SpreadsheetApp.openById(existingId).getSheets()[0];
  }
  const spreadsheet = SpreadsheetApp.create("MyTube — Watch History");
  const sheet = spreadsheet.getSheets()[0];
  sheet.appendRow(HEADER);
  properties.setProperty(SHEET_ID_KEY, spreadsheet.getId());
  return sheet;
}
