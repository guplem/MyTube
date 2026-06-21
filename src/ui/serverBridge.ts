// Typed, promise-based wrappers around google.script.run, the Apps Script bridge
// for calling server functions from the browser. Centralizes the bridge typing
// so screens can `await` a server call instead of juggling success/failure
// handlers. Every function here must be an `export function` in
// src/server/main.ts.

import type { Video } from "../shared/video";
import type { PlaylistSummary } from "../shared/playlist";
import type { CommentOrder, CommentPage } from "../shared/comment";
import type { FeedPage, FeedPageOptions } from "../shared/feed";

interface ScriptRunner {
  withSuccessHandler<T>(callback: (value: T) => void): ScriptRunner;
  withFailureHandler(callback: (error: Error) => void): ScriptRunner;
  getFeedPage(options: FeedPageOptions): void;
  getVideoDescription(videoId: string): void;
  getComments(videoId: string, order: CommentOrder, pageToken: string): void;
  markVideoSeen(video: Video): void;
  removeVideoSeen(videoId: string): void;
  markVideoDismissed(videoId: string): void;
  removeVideoDismissed(videoId: string): void;
  getHistory(): void;
  getPlaylists(): void;
  getPlaylistVideos(playlistId: string): void;
  getWatchLaterVideos(): void;
  addToWatchLater(videoId: string): void;
  removeFromWatchLater(videoId: string): void;
}
declare const google: { script: { run: ScriptRunner } };

function call<T>(invoke: (runner: ScriptRunner) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let runner = google.script.run.withSuccessHandler<T>(resolve);
    runner = runner.withFailureHandler(reject);
    invoke(runner);
  });
}

export function getFeedPage(options: FeedPageOptions): Promise<FeedPage> {
  return call<FeedPage>((runner) => runner.getFeedPage(options));
}

export function getVideoDescription(videoId: string): Promise<string> {
  return call<string>((runner) => runner.getVideoDescription(videoId));
}

export function getComments(
  videoId: string,
  order: CommentOrder,
  pageToken: string,
): Promise<CommentPage> {
  return call<CommentPage>((runner) => runner.getComments(videoId, order, pageToken));
}

export function markVideoSeen(video: Video): Promise<void> {
  return call<void>((runner) => runner.markVideoSeen(video));
}

export function removeVideoSeen(videoId: string): Promise<void> {
  return call<void>((runner) => runner.removeVideoSeen(videoId));
}

export function markVideoDismissed(videoId: string): Promise<void> {
  return call<void>((runner) => runner.markVideoDismissed(videoId));
}

export function removeVideoDismissed(videoId: string): Promise<void> {
  return call<void>((runner) => runner.removeVideoDismissed(videoId));
}

export function getHistory(): Promise<Video[]> {
  return call<Video[]>((runner) => runner.getHistory());
}

export function getPlaylists(): Promise<PlaylistSummary[]> {
  return call<PlaylistSummary[]>((runner) => runner.getPlaylists());
}

export function getPlaylistVideos(playlistId: string): Promise<Video[]> {
  return call<Video[]>((runner) => runner.getPlaylistVideos(playlistId));
}

export function getWatchLaterVideos(): Promise<Video[]> {
  return call<Video[]>((runner) => runner.getWatchLaterVideos());
}

export function addToWatchLater(videoId: string): Promise<void> {
  return call<void>((runner) => runner.addToWatchLater(videoId));
}

export function removeFromWatchLater(videoId: string): Promise<void> {
  return call<void>((runner) => runner.removeFromWatchLater(videoId));
}
