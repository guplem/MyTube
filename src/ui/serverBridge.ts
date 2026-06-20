// Typed, promise-based wrappers around google.script.run, the Apps Script bridge
// for calling server functions from the browser. Centralizes the bridge typing
// so screens can `await` a server call instead of juggling success/failure
// handlers. Every function here must be an `export function` in
// src/server/main.ts.

import type { Video } from "../shared/video";

interface ScriptRunner {
  withSuccessHandler<T>(callback: (value: T) => void): ScriptRunner;
  withFailureHandler(callback: (error: Error) => void): ScriptRunner;
  getUploadsFeed(forceRefresh: boolean): void;
  getVideoDescription(videoId: string): void;
}
declare const google: { script: { run: ScriptRunner } };

export function getUploadsFeed(forceRefresh: boolean): Promise<Video[]> {
  return new Promise<Video[]>((resolve, reject) => {
    google.script.run
      .withSuccessHandler<Video[]>(resolve)
      .withFailureHandler(reject)
      .getUploadsFeed(forceRefresh);
  });
}

export function getVideoDescription(videoId: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    google.script.run
      .withSuccessHandler<string>(resolve)
      .withFailureHandler(reject)
      .getVideoDescription(videoId);
  });
}
