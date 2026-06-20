// Browser entry point. Loads the uploads feed and swaps the #app container
// between the feed list and the player, both built from shared components.

import type { Video } from "../shared/video";
import { getUploadsFeed } from "./serverBridge";
import { VideoListView } from "./videoListView";
import { PlayerView } from "./playerView";

let feedVideos: Video[] = [];

function appContainer(): HTMLElement | null {
  return document.getElementById("app");
}

function showFeed(): void {
  const app = appContainer();
  if (!app) return;
  app.innerHTML = "";
  app.appendChild(VideoListView(feedVideos, (index): void => showPlayer(feedVideos, index)));
}

function showPlayer(queue: Video[], startIndex: number): void {
  const app = appContainer();
  if (!app) return;
  app.innerHTML = "";
  app.appendChild(
    PlayerView({ queue, startIndex, contextLabel: "Subscriptions", onBack: showFeed }),
  );
}

async function start(): Promise<void> {
  const app = appContainer();
  if (!app) return;
  app.textContent = "Loading your subscriptions…";
  try {
    feedVideos = await getUploadsFeed(false);
    showFeed();
  } catch (error) {
    app.textContent = `Could not load your feed: ${(error as Error).message}`;
  }
}

// Run only after the page (and the google.script bridge) is fully loaded.
if (document.readyState === "complete") {
  void start();
} else {
  window.addEventListener("load", (): void => void start());
}
