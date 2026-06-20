// Browser entry point. Loads the uploads feed, offers a Feed/History switch in
// the header, and swaps the #app container between the feed list, the history
// list, and the player, all built from the shared components.

import type { Video } from "../shared/video";
import { getUploadsFeed, getHistory } from "./serverBridge";
import { VideoListView } from "./videoListView";
import { PlayerView } from "./playerView";

let feedVideos: Video[] = [];
let historyVideos: Video[] = [];

function appContainer(): HTMLElement | null {
  return document.getElementById("app");
}

function showFeed(): void {
  const app = appContainer();
  if (!app) return;
  app.innerHTML = "";
  app.appendChild(
    VideoListView(feedVideos, (index): void => showPlayer(feedVideos, index, "Subscriptions", showFeed)),
  );
}

function showHistory(): void {
  const app = appContainer();
  if (!app) return;
  app.textContent = "Loading your history…";
  getHistory()
    .then((videos): void => {
      historyVideos = videos;
      app.innerHTML = "";
      app.appendChild(
        VideoListView(historyVideos, (index): void => showPlayer(historyVideos, index, "History", showHistory)),
      );
    })
    .catch((error: Error): void => {
      app.textContent = `Could not load your history: ${error.message}`;
    });
}

function showPlayer(queue: Video[], startIndex: number, contextLabel: string, onBack: () => void): void {
  const app = appContainer();
  if (!app) return;
  app.innerHTML = "";
  app.appendChild(PlayerView({ queue, startIndex, contextLabel, onBack }));
}

function setupNav(): void {
  const buttons = document.querySelectorAll<HTMLButtonElement>(".app-nav button");
  buttons.forEach((button): void => {
    button.addEventListener("click", (): void => {
      buttons.forEach((other): void => {
        other.classList.toggle("active", other === button);
      });
      if (button.dataset.view === "history") showHistory();
      else showFeed();
    });
  });
}

async function start(): Promise<void> {
  const app = appContainer();
  if (!app) return;
  setupNav();
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
