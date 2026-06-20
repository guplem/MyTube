// Browser entry point. Loads the uploads feed from the server and renders it
// with the shared VideoListView. Talks to the server through google.script.run.

import type { Video } from "../shared/video";
import { VideoListView } from "./videoListView";

interface GoogleScriptRunner {
  withSuccessHandler<T>(callback: (value: T) => void): GoogleScriptRunner;
  withFailureHandler(callback: (error: Error) => void): GoogleScriptRunner;
  getUploadsFeed(forceRefresh: boolean): void;
}
declare const google: { script: { run: GoogleScriptRunner } };

function renderFeed(): void {
  const container = document.getElementById("feed");
  if (!container) return;
  container.textContent = "Loading your subscriptions…";

  google.script.run
    .withSuccessHandler<Video[]>((videos): void => {
      container.innerHTML = "";
      container.appendChild(
        VideoListView(videos, (index): void => {
          // The player arrives in milestone 3; for now just record the choice.
          console.log("play", videos[index]?.videoId);
        }),
      );
    })
    .withFailureHandler((error): void => {
      container.textContent = `Could not load your feed: ${error.message}`;
    })
    .getUploadsFeed(false);
}

// Call only after the page (and the google.script bridge) is fully loaded.
if (document.readyState === "complete") {
  renderFeed();
} else {
  window.addEventListener("load", renderFeed);
}
