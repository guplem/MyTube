// Server entry point. Runs on Google's servers as the logged-in user
// (deploy setting "Execute as: user accessing the web app").
//
// EXPORT every function that must be reachable from outside: the web app entry
// point doGet, and every function the browser calls through google.script.run.
// Apps Script only exposes functions that appear as top-level declarations in
// the pushed file. esbuild hides ours inside an IIFE, so build.mjs reads these
// `export function` names and appends matching top-level wrappers to the bundle.

import type { Video } from "../shared/video";
import type { PlaylistSummary } from "../shared/playlist";
import type { VideoComment } from "../shared/comment";
import type { FeedPage, FeedPageOptions } from "../shared/feed";
import * as feed from "./feed";
import * as youtube from "./youtube";
import * as history from "./history";

/** Serves the single web app page. Called by Apps Script for GET requests. */
export function doGet(): GoogleAppsScript.HTML.HtmlOutput {
  return HtmlService.createTemplateFromFile("index")
    .evaluate()
    .setTitle("MyTube")
    .addMetaTag("viewport", "width=device-width, initial-scale=1");
}

/** Inlines another HTML file into a template (used by index.html for the UI bundle). */
export function include(filename: string): string {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * One page of the subscriptions feed (newest first), each video flagged seen
 * against the watch history. The full feed is built from the per-channel RSS
 * cache on every call (cheap when warm); only the requested page is returned,
 * so the browser never receives the whole 1000+ video list at once.
 */
export function getFeedPage(options: FeedPageOptions): FeedPage {
  const all = feed.getUploadsFeed(options.forceRefresh);
  flagSeen(all);
  let visible = all;
  if (options.hideShorts) {
    enrichDurations(visible);
    visible = visible.filter((video) => !isShort(video));
  }
  if (options.hideViewed) {
    visible = visible.filter((video) => !video.seen);
  }
  const start = options.page * options.pageSize;
  return { videos: visible.slice(start, start + options.pageSize), total: visible.length };
}

// A Short is a vertical clip up to ~3 minutes. RSS exposes no duration and no
// "is a Short" flag, so we approximate by length: any video at or under
// SHORT_MAX_SECONDS counts as a Short. This has false positives (a normal short
// clip), which is why the UI offers a toggle to show Shorts again.
const SHORT_MAX_SECONDS = 180;

function enrichDurations(videos: Video[]): void {
  try {
    const durations = youtube.getVideoDurationsSeconds(videos.map((video) => video.videoId));
    for (const video of videos) video.durationSeconds = durations[video.videoId];
  } catch {
    // Length lookup is best-effort; without it no video is treated as a Short.
  }
}

function isShort(video: Video): boolean {
  return (
    video.durationSeconds !== undefined &&
    video.durationSeconds > 0 &&
    video.durationSeconds <= SHORT_MAX_SECONDS
  );
}

/** Description text of a single video, for the player screen. */
export function getVideoDescription(videoId: string): string {
  return youtube.getVideoDescription(videoId);
}

/** Top-level comments for a video (empty if comments are disabled). */
export function getComments(videoId: string): VideoComment[] {
  return youtube.getComments(videoId);
}

/** Records a video as seen in the user's watch history. */
export function markVideoSeen(video: Video): void {
  history.markVideoSeen(video);
}

/** The user's watch history as a video list, newest first. */
export function getHistory(): Video[] {
  return history.getHistory();
}

/** The user's own playlists. */
export function getPlaylists(): PlaylistSummary[] {
  return youtube.getPlaylists();
}

/** Videos in a playlist, flagged seen. */
export function getPlaylistVideos(playlistId: string): Video[] {
  const videos = youtube.getPlaylistVideos(playlistId);
  flagSeen(videos);
  return videos;
}

/** Videos in the app-managed Watch Later playlist, flagged seen. */
export function getWatchLaterVideos(): Video[] {
  const videos = youtube.getWatchLaterVideos();
  flagSeen(videos);
  return videos;
}

/** Adds a video to the Watch Later playlist. */
export function addToWatchLater(videoId: string): void {
  youtube.addToWatchLater(videoId);
}

/** Removes a video from the Watch Later playlist. */
export function removeFromWatchLater(videoId: string): void {
  youtube.removeFromWatchLater(videoId);
}

/** Flags each video seen against the watch history. Best-effort: never breaks a list. */
function flagSeen(videos: Video[]): void {
  try {
    const seen = new Set(history.getSeenVideoIds());
    for (const video of videos) video.seen = seen.has(video.videoId);
  } catch {
    // History is best-effort.
  }
}
