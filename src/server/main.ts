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
import type { SponsorSegment } from "../shared/sponsorBlock";
import type { DeArrowSubmissionsResult } from "../shared/dearrow";
import * as feed from "./feed";
import * as youtube from "./youtube";
import * as history from "./history";
import * as dismissed from "./dismissed";
import * as progress from "./progress";
import * as sponsorBlock from "./sponsorBlock";
import * as dearrow from "./dearrow";
import * as preferences from "./preferences";
import { startStopwatch, type Stopwatch } from "./timing";
import { preferencesScriptLiteral } from "../shared/preferences";

// The PWA wrapper on GitHub Pages (pages/) serves the icon and frames this page.
// setFaviconUrl only accepts a public PNG/ICO that Google fetches itself, so the
// icon lives on that site. It sets the favicon of Google's outer page, which the
// <link rel="icon"> in index.html can never reach. The URL is the final one:
// guplem.github.io redirects to the account's custom domain.
const FAVICON_URL = "https://triunitystudios.com/MyTube/icon-192.png";

/** Serves the single web app page. Called by Apps Script for GET requests. */
export function doGet(): GoogleAppsScript.HTML.HtmlOutput {
  const template: GoogleAppsScript.HTML.HtmlTemplate =
    HtmlService.createTemplateFromFile("index");
  // The page carries the account's preferences, so the browser applies them
  // before its first feed request, with no extra round trip.
  template.preferencesJson = preferencesScriptLiteral(
    preferences.getPreferences(),
  );
  const output: GoogleAppsScript.HTML.HtmlOutput = template
    .evaluate()
    .setTitle("MyTube")
    .addMetaTag("viewport", "width=device-width, initial-scale=1")
    // ALLOWALL lets the GitHub Pages wrapper embed the app. Each visitor
    // still sees only their own account's data.
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  // Google fetches the icon while it builds the page and throws when it
  // cannot. A missing icon must never take the whole app down.
  try {
    output.setFaviconUrl(FAVICON_URL);
  } catch (error) {
    console.warn("Favicon not set: " + String(error));
  }
  return output;
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
  const stopwatch: Stopwatch = startStopwatch("getFeedPage");
  const uploads = feed.getUploadsFeed(options.forceRefresh, stopwatch);
  const all = uploads.videos;
  stopwatch.lap("merge", all.length + " videos");
  flagSeen(all);
  flagDismissed(all);
  stopwatch.lap("history");
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
    // Membership is normally flagged after paging (it is only needed for the
    // cards shown), but filtering on it has to happen before the slice, so flag
    // the whole surviving list here. Both calls read the same 10-minute cache.
    flagInWatchLater(visible);
    visible = visible.filter((video) => !video.inWatchLater);
    stopwatch.lap("watch later");
  }
  if (options.hideShorts) {
    enrichDurations(visible);
    visible = visible.filter((video) => !isShort(video));
    stopwatch.lap("durations", "whole list");
  }
  const start = options.page * options.pageSize;
  const pageVideos = visible.slice(start, start + options.pageSize);
  // Durations power the on-card badge. With hideShorts on they are already
  // looked up for the whole list above; otherwise fetch them just for this page.
  if (!options.hideShorts) {
    enrichDurations(pageVideos);
    stopwatch.lap("durations", "page");
  }
  flagInWatchLater(pageVideos);
  flagProgress(pageVideos);
  stopwatch.lap("page flags");
  // No filter reads the community title, so the page alone needs it.
  flagCommunityTitle(pageVideos);
  stopwatch.lap("titles");
  console.log(stopwatch.summary());
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

/**
 * Sponsor and self-promotion time ranges to jump past in a video, from the
 * public SponsorBlock database. Empty when nothing is known or the lookup
 * failed, so playback never depends on it. `durationSeconds` is the video
 * length when the caller knows it, which bounds a bad crowd entry that would
 * otherwise seek past the end of the video.
 */
export function getSponsorSegments(
  videoId: string,
  durationSeconds?: number,
): SponsorSegment[] {
  return sponsorBlock.getSponsorSegments(videoId, durationSeconds);
}

/**
 * Every DeArrow title submission of one video, for the player Info tab. The
 * tab asks only when it opens, so a player that never opens it sends nothing.
 */
export function getDeArrowSubmissions(
  videoId: string,
): DeArrowSubmissionsResult {
  return dearrow.getDeArrowSubmissions(videoId);
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

/** Stores one UI preference for the account; null removes it. */
export function setPreference(key: string, value: string | null): void {
  preferences.setPreference(key, value);
}

/** Uploads a device's local preferences to an account that has none stored. */
export function importPreferences(prefs: unknown): void {
  preferences.importPreferences(prefs);
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
  const stopwatch: Stopwatch = startStopwatch("getHistory");
  const videos = history.getHistory();
  stopwatch.lap("history", videos.length + " videos");
  return enrichList(videos, stopwatch, { flagSeen: false });
}

/** The user's own playlists. */
export function getPlaylists(): PlaylistSummary[] {
  return youtube.getPlaylists();
}

/** Videos in a playlist, flagged seen, with durations for the card badge. */
export function getPlaylistVideos(playlistId: string): Video[] {
  const stopwatch: Stopwatch = startStopwatch("getPlaylistVideos");
  const videos = youtube.getPlaylistVideos(playlistId);
  stopwatch.lap("playlist", videos.length + " videos");
  return enrichList(videos, stopwatch, { flagSeen: true });
}

/** Videos in the app-managed Watch Later playlist, flagged seen. */
export function getWatchLaterVideos(): Video[] {
  const stopwatch: Stopwatch = startStopwatch("getWatchLaterVideos");
  const videos = youtube.getWatchLaterVideos();
  stopwatch.lap("playlist", videos.length + " videos");
  // Every video here is in Watch Later by definition; set the flag directly
  // (no membership lookup) so the card's Watch Later toggle starts on.
  for (const video of videos) video.inWatchLater = true;
  return enrichList(videos, stopwatch, {
    flagSeen: true,
    inWatchLater: true,
  });
}

// The flags and lookups every in-memory list gets: seen (except history, where
// every entry is seen), durations, Watch Later membership (unless already
// known), resume positions and community titles. Logs the stopwatch line.
function enrichList(
  videos: Video[],
  stopwatch: Stopwatch,
  options: { flagSeen: boolean; inWatchLater?: boolean },
): Video[] {
  if (options.flagSeen) flagSeen(videos);
  flagProgress(videos);
  stopwatch.lap("history");
  enrichDurations(videos);
  stopwatch.lap("durations");
  if (!options.inWatchLater) {
    flagInWatchLater(videos);
    stopwatch.lap("watch later");
  }
  flagCommunityTitle(videos);
  stopwatch.lap("titles");
  console.log(stopwatch.summary());
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

/** Sets the DeArrow community title on each video that has one, so the card
 *  can show it. Best-effort: without it every video shows its YouTube title. */
function flagCommunityTitle(videos: Video[]): void {
  try {
    const titles = dearrow.getCommunityTitles(
      videos.map((video: Video): string => video.videoId),
    );
    for (const video of videos) {
      const communityTitle: unknown = titles[video.videoId];
      if (typeof communityTitle === "string" && communityTitle)
        video.communityTitle = communityTitle;
    }
  } catch {
    // Community titles are best-effort.
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
