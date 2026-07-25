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
import type { CommentOrder, CommentPage } from "../shared/comment";
import type { FeedPage, FeedPageOptions } from "../shared/feed";
import * as feed from "./feed";
import * as youtube from "./youtube";
import * as history from "./history";
import * as dismissed from "./dismissed";
import * as progress from "./progress";

// No setFaviconUrl: it fetches and validates the image on Google's servers and
// only accepts a publicly-hosted raster image (PNG/ICO), rejecting both data:
// URIs and SVG with "The favicon icon image type is not supported." This repo
// has nowhere public to host one, so the icon ships as a best-effort inline
// <link rel="icon"> in index.html instead (see the note there).

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
  const uploads = feed.getUploadsFeed(options.forceRefresh);
  const all = uploads.videos;
  flagSeen(all);
  flagDismissed(all);
  let visible = all;
  // Cheapest filters first, so each costly step runs on an already smaller
  // list: the free ones (already-computed flags, a date string compare), then
  // Watch Later membership, then the duration lookup (hideShorts), the most
  // expensive of all.
  if (options.hideViewed) {
    visible = visible.filter((video) => !video.seen);
  }
  if (options.hideDismissed) {
    visible = visible.filter((video) => !video.dismissed);
  }
  if (options.beforeDate) {
    // Keep videos published on or after the cutoff date; compare date parts only.
    visible = visible.filter(
      (video) => video.publishedAt.slice(0, 10) >= options.beforeDate,
    );
  }
  if (options.hideSaved) {
    // After the free filters, before the duration lookup: this one can cost a
    // playlist fetch on a cold cache and its flag loop walks the whole list.
    // Membership is normally flagged after paging (it is only needed for the
    // cards shown), but filtering on it has to happen before the slice, so flag
    // the whole surviving list here. Both calls read the same 10-minute cache.
    flagInWatchLater(visible);
    visible = visible.filter((video) => !video.inWatchLater);
  }
  if (options.hideShorts) {
    enrichDurations(visible);
    visible = visible.filter((video) => !isShort(video));
  }
  const start = options.page * options.pageSize;
  const pageVideos = visible.slice(start, start + options.pageSize);
  // Durations power the on-card badge. With hideShorts on they are already
  // looked up for the whole list above; otherwise fetch them just for this page.
  if (!options.hideShorts) enrichDurations(pageVideos);
  flagInWatchLater(pageVideos);
  flagProgress(pageVideos);
  return {
    videos: pageVideos,
    total: visible.length,
    failedChannels: uploads.failedChannels,
    totalChannels: uploads.totalChannels,
  };
}

// A Short is a vertical clip up to ~3 minutes. RSS exposes no duration and no
// "is a Short" flag, so we approximate by length: any video at or under
// SHORT_MAX_SECONDS counts as a Short. This has false positives (a normal short
// clip), which is why the UI offers a toggle to show Shorts again.
const SHORT_MAX_SECONDS = 180;

function enrichDurations(videos: Video[]): void {
  try {
    const durations = youtube.getVideoDurationsSeconds(
      videos.map((video) => video.videoId),
    );
    for (const video of videos)
      video.durationSeconds = durations[video.videoId];
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

/** One page of a video's top-level comments, sorted by order ("relevance"/"time"). */
export function getComments(
  videoId: string,
  order: CommentOrder,
  pageToken: string,
): CommentPage {
  return youtube.getComments(videoId, order, pageToken);
}

/**
 * Records a video as seen in the user's watch history, and drops it from Watch
 * Later if it is saved there. Marking seen is the single "I'm done with this"
 * action, so the removal happens from every screen and the player — not just the
 * Watch Later list. Guarded on the cached membership set, so it costs nothing
 * when the video isn't in Watch Later (the common case on the feed) or the user
 * has no Watch Later playlist yet.
 */
export function markVideoSeen(video: Video): void {
  history.markVideoSeen(video);
  try {
    if (youtube.getWatchLaterVideoIds().includes(video.videoId)) {
      youtube.removeFromWatchLater(video.videoId);
    }
  } catch {
    // Watch Later removal is best-effort; never block recording the view.
  }
}

/** Removes a video from the user's watch history (un-marks it as seen). */
export function removeVideoSeen(videoId: string): void {
  history.removeVideoSeen(videoId);
}

/**
 * The inverse of markVideoSeen, for the Watch Later screen's seen toggle:
 * restores the video to Watch Later (guarded on membership; never creates the
 * playlist), then un-marks it as seen. Everywhere else un-marking stays
 * one-directional (removeVideoSeen) — only here does the user expect a mis-tap
 * to put the saved video back. The restore runs FIRST and its failure
 * propagates: if the video can't be put back, the view stays recorded, so the
 * UI rolls the toggle back and the user sees the failure instead of silently
 * losing the video from Watch Later.
 */
export function undoMarkVideoSeen(videoId: string): void {
  youtube.restoreToWatchLater(videoId);
  history.removeVideoSeen(videoId);
}

/** Marks a video dismissed from the feed. */
export function markVideoDismissed(videoId: string): void {
  dismissed.markVideoDismissed(videoId);
}

/** Removes a video from the dismissed list (un-dismisses it). */
export function removeVideoDismissed(videoId: string): void {
  dismissed.removeVideoDismissed(videoId);
}

/**
 * Saves a video's playback position so the player can resume it later, from
 * any device. A position <= 0 clears the entry (the video restarts). Called
 * periodically by the player, so it must stay cheap: the store skips the
 * write when the position hasn't changed.
 */
export function saveVideoProgress(videoId: string, seconds: number): void {
  progress.saveVideoProgress(videoId, seconds);
}

/** The user's watch history as a video list, newest first. */
export function getHistory(): Video[] {
  const videos = history.getHistory();
  enrichDurations(videos);
  flagInWatchLater(videos);
  flagProgress(videos);
  return videos;
}

/** The user's own playlists. */
export function getPlaylists(): PlaylistSummary[] {
  return youtube.getPlaylists();
}

/** Videos in a playlist, flagged seen, with durations for the card badge. */
export function getPlaylistVideos(playlistId: string): Video[] {
  const videos = youtube.getPlaylistVideos(playlistId);
  flagSeen(videos);
  enrichDurations(videos);
  flagInWatchLater(videos);
  flagProgress(videos);
  return videos;
}

/** Videos in the app-managed Watch Later playlist, flagged seen. */
export function getWatchLaterVideos(): Video[] {
  const videos = youtube.getWatchLaterVideos();
  flagSeen(videos);
  enrichDurations(videos);
  // Every video here is in Watch Later by definition; set the flag directly
  // (no membership lookup) so the card's Watch Later toggle starts on.
  for (const video of videos) video.inWatchLater = true;
  flagProgress(videos);
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

/** Flags each video dismissed against the dismissed list. Best-effort. */
function flagDismissed(videos: Video[]): void {
  try {
    const ids = new Set(dismissed.getDismissedVideoIds());
    for (const video of videos) video.dismissed = ids.has(video.videoId);
  } catch {
    // Dismissed list is best-effort.
  }
}

/** Flags each video with its stored resume position, so the player starts
 *  where the user left off. Best-effort: without it videos start at 0. */
function flagProgress(videos: Video[]): void {
  try {
    const positions = progress.getProgressSeconds();
    for (const video of videos) {
      const seconds = positions[video.videoId];
      if (seconds !== undefined) video.progressSeconds = seconds;
    }
  } catch {
    // Resume positions are best-effort.
  }
}

/** Flags each video that is already in Watch Later. Best-effort; no-op if the
 *  user has no Watch Later playlist yet (so it costs nothing then). */
function flagInWatchLater(videos: Video[]): void {
  try {
    const ids = new Set(youtube.getWatchLaterVideoIds());
    if (ids.size === 0) return;
    for (const video of videos) video.inWatchLater = ids.has(video.videoId);
  } catch {
    // Watch Later membership is best-effort.
  }
}
