// Browser entry point. Loads screens into the #app container and wires the
// header navigation. Every list screen is the shared VideoListView with
// different data and actions; every video plays through the shared PlayerView.

import type { Video } from "../shared/video";
import type { PlaylistSummary } from "../shared/playlist";
import {
  getUploadsFeed,
  getHistory,
  getPlaylists,
  getPlaylistVideos,
  getWatchLaterVideos,
  addToWatchLater,
  removeFromWatchLater,
} from "./serverBridge";
import { VideoListView, type VideoAction } from "./videoListView";
import { PlayerView } from "./playerView";

let feedVideos: Video[] = [];

function appContainer(): HTMLElement | null {
  return document.getElementById("app");
}

// Per-card action: add the video to Watch Later, with inline feedback.
const addToWatchLaterAction: VideoAction = {
  label: "+ Watch Later",
  onClick: (video, button): void => {
    button.disabled = true;
    button.textContent = "Adding…";
    addToWatchLater(video.videoId)
      .then((): void => {
        button.textContent = "Added ✓";
      })
      .catch((): void => {
        button.disabled = false;
        button.textContent = "+ Watch Later";
      });
  },
};

// Per-card action: remove the video from Watch Later and drop its card.
const removeFromWatchLaterAction: VideoAction = {
  label: "Remove",
  onClick: (video, button): void => {
    button.disabled = true;
    removeFromWatchLater(video.videoId)
      .then((): void => {
        button.closest(".video-card")?.remove();
      })
      .catch((): void => {
        button.disabled = false;
      });
  },
};

function showPlayer(queue: Video[], startIndex: number, contextLabel: string, onBack: () => void): void {
  const app = appContainer();
  if (!app) return;
  app.innerHTML = "";
  app.appendChild(PlayerView({ queue, startIndex, contextLabel, onBack }));
}

function showFeed(): void {
  const app = appContainer();
  if (!app) return;
  app.innerHTML = "";

  const refresh = document.createElement("button");
  refresh.type = "button";
  refresh.className = "refresh-button";
  refresh.textContent = "↻ Refresh";
  refresh.addEventListener("click", refreshFeed);
  app.appendChild(refresh);

  app.appendChild(
    VideoListView(feedVideos, {
      onPlay: (index): void => showPlayer(feedVideos, index, "Subscriptions", showFeed),
      actions: [addToWatchLaterAction],
    }),
  );
}

// Re-fetches the feed bypassing the per-channel cache (the cached load is fast
// but can be stale; this pulls fresh RSS for every channel).
function refreshFeed(): void {
  const app = appContainer();
  if (!app) return;
  app.textContent = "Refreshing your subscriptions…";
  getUploadsFeed(true)
    .then((videos): void => {
      feedVideos = videos;
      showFeed();
    })
    .catch((error: Error): void => {
      app.textContent = `Could not refresh your feed: ${error.message}`;
    });
}

function showHistory(): void {
  renderVideoScreen("Loading your history…", getHistory(), (videos) => ({
    onPlay: (index): void => showPlayer(videos, index, "History", showHistory),
    actions: [addToWatchLaterAction],
  }));
}

function showWatchLater(): void {
  renderVideoScreen("Loading Watch Later…", getWatchLaterVideos(), (videos) => ({
    onPlay: (index): void => showPlayer(videos, index, "Watch Later", showWatchLater),
    actions: [removeFromWatchLaterAction],
  }));
}

function showPlaylist(playlist: PlaylistSummary): void {
  renderVideoScreen(`Loading "${playlist.title}"…`, getPlaylistVideos(playlist.playlistId), (videos) => ({
    onPlay: (index): void => showPlayer(videos, index, playlist.title, (): void => showPlaylist(playlist)),
    actions: [addToWatchLaterAction],
  }));
}

function showPlaylists(): void {
  const app = appContainer();
  if (!app) return;
  app.textContent = "Loading your playlists…";
  getPlaylists()
    .then((playlists): void => {
      app.innerHTML = "";
      if (playlists.length === 0) {
        app.textContent = "You have no playlists.";
        return;
      }
      const list = document.createElement("div");
      list.className = "playlist-list";
      for (const playlist of playlists) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "playlist-item";
        button.textContent = `${playlist.title} (${playlist.itemCount})`;
        button.addEventListener("click", (): void => showPlaylist(playlist));
        list.appendChild(button);
      }
      app.appendChild(list);
    })
    .catch((error: Error): void => {
      app.textContent = `Could not load your playlists: ${error.message}`;
    });
}

// Loads a Video[] and renders it with VideoListView, showing a loading message
// and a failure message in the #app container.
function renderVideoScreen(
  loadingMessage: string,
  load: Promise<Video[]>,
  optionsFor: (videos: Video[]) => { onPlay: (index: number) => void; actions: VideoAction[] },
): void {
  const app = appContainer();
  if (!app) return;
  app.textContent = loadingMessage;
  load
    .then((videos): void => {
      app.innerHTML = "";
      app.appendChild(VideoListView(videos, optionsFor(videos)));
    })
    .catch((error: Error): void => {
      app.textContent = `Could not load this list: ${error.message}`;
    });
}

function setupNav(): void {
  const buttons = document.querySelectorAll<HTMLButtonElement>(".app-nav button");
  buttons.forEach((button): void => {
    button.addEventListener("click", (): void => {
      buttons.forEach((other): void => {
        other.classList.toggle("active", other === button);
      });
      switch (button.dataset.view) {
        case "watchlater":
          showWatchLater();
          break;
        case "playlists":
          showPlaylists();
          break;
        case "history":
          showHistory();
          break;
        default:
          showFeed();
      }
    });
  });
}

// The search box redirects to YouTube's results page (PLAN.md section 4); we do
// not run in-app search, which would cost 100 quota units per query.
function setupSearch(): void {
  const form = document.querySelector<HTMLFormElement>(".app-search");
  const input = form?.querySelector<HTMLInputElement>("input");
  form?.addEventListener("submit", (event): void => {
    event.preventDefault();
    const term = input?.value.trim();
    if (term) {
      window.open(`https://www.youtube.com/results?search_query=${encodeURIComponent(term)}`, "_blank");
    }
  });
}

async function start(): Promise<void> {
  const app = appContainer();
  if (!app) return;
  setupNav();
  setupSearch();
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
