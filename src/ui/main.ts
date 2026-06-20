// Browser entry point. Loads screens into the #app container and wires the
// header navigation. Every list screen is the shared VideoListView with
// different data and actions; every video plays through the shared PlayerView.

import type { Video } from "../shared/video";
import type { PlaylistSummary } from "../shared/playlist";
import {
  getFeedPage,
  getHistory,
  getPlaylists,
  getPlaylistVideos,
  getWatchLaterVideos,
  addToWatchLater,
  removeFromWatchLater,
  getSeenBeforeDate,
  setSeenBeforeDate,
} from "./serverBridge";
import { VideoListView, PagedVideoListView, type VideoAction } from "./videoListView";
import { PlayerView } from "./playerView";
import { getBoolPreference, setBoolPreference } from "./preferences";

const HIDE_SHORTS_PREF = "mytube.hideShorts";
const HIDE_VIEWED_PREF = "mytube.hideViewed";

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

// The feed pages on the server (PagedVideoListView): each page is a separate
// google.script.run call, so the browser never receives the whole 1000+ video
// list at once. Refresh rebuilds the view and forces a fresh RSS fetch for the
// first page load only (forceRefresh on every page would refetch all channels).
function showFeed(forceFirstLoad: boolean = false): void {
  const app = appContainer();
  if (!app) return;
  app.innerHTML = "";

  const toolbar = document.createElement("div");
  toolbar.className = "feed-toolbar";

  const refresh = document.createElement("button");
  refresh.type = "button";
  refresh.className = "refresh-button";
  refresh.textContent = "↻ Refresh";
  refresh.addEventListener("click", (): void => showFeed(true));

  // Re-rendering the whole feed (showFeed) resets to page 0 and reloads with the
  // new toggle state, which the loader reads fresh on each page request.
  const hideShortsToggle = feedToggle("Hide Shorts", HIDE_SHORTS_PREF, true);
  const hideViewedToggle = feedToggle("Hide viewed", HIDE_VIEWED_PREF, false);

  toolbar.append(refresh, hideShortsToggle, hideViewedToggle, seenBeforeControl());
  app.appendChild(toolbar);

  let pendingForce = forceFirstLoad;
  app.appendChild(
    PagedVideoListView(
      (page, pageSize) => {
        const forceRefresh = pendingForce;
        pendingForce = false;
        return getFeedPage({
          page,
          pageSize,
          forceRefresh,
          hideShorts: getBoolPreference(HIDE_SHORTS_PREF, true),
          hideViewed: getBoolPreference(HIDE_VIEWED_PREF, false),
        });
      },
      {
        onPlay: (index, queue): void => showPlayer(queue, index, "Subscriptions", (): void => showFeed()),
        actions: [addToWatchLaterAction],
      },
    ),
  );
}

// A persisted checkbox toggle for the feed toolbar. Saves to localStorage and
// re-renders the feed so the change takes effect immediately.
function feedToggle(labelText: string, prefKey: string, defaultValue: boolean): HTMLElement {
  const label = document.createElement("label");
  label.className = "feed-toggle";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = getBoolPreference(prefKey, defaultValue);
  checkbox.addEventListener("change", (): void => {
    setBoolPreference(prefKey, checkbox.checked);
    showFeed();
  });
  label.append(checkbox, document.createTextNode(labelText));
  return label;
}

// "Mark everything before this date as seen": stores a single cutoff date on the
// server (history.setSeenBeforeDate) instead of writing a history row per video.
// Videos published before the cutoff then show as seen and obey "Hide viewed".
function seenBeforeControl(): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "seen-before";

  const input = document.createElement("input");
  input.type = "date";

  const apply = document.createElement("button");
  apply.type = "button";
  apply.className = "refresh-button";
  apply.textContent = "Mark earlier as seen";

  const clear = document.createElement("button");
  clear.type = "button";
  clear.className = "refresh-button";
  clear.textContent = "Clear";

  const note = document.createElement("span");
  note.className = "list-info";

  const today = new Date().toISOString().slice(0, 10);
  getSeenBeforeDate()
    .then((cutoff): void => {
      input.value = cutoff || today;
      note.textContent = cutoff ? `Marked seen before ${cutoff}` : "";
    })
    .catch((): void => {
      input.value = today;
    });

  apply.addEventListener("click", (): void => applyCutoff(input.value));
  clear.addEventListener("click", (): void => applyCutoff(""));

  function applyCutoff(date: string): void {
    apply.disabled = true;
    clear.disabled = true;
    setSeenBeforeDate(date)
      .then((): void => showFeed())
      .catch((): void => {
        apply.disabled = false;
        clear.disabled = false;
      });
  }

  wrap.append(input, apply, clear, note);
  return wrap;
}

function showHistory(): void {
  renderVideoScreen("Loading your history…", getHistory(), () => ({
    onPlay: (index, queue): void => showPlayer(queue, index, "History", showHistory),
    actions: [addToWatchLaterAction],
  }));
}

function showWatchLater(): void {
  renderVideoScreen("Loading Watch Later…", getWatchLaterVideos(), () => ({
    onPlay: (index, queue): void => showPlayer(queue, index, "Watch Later", showWatchLater),
    actions: [removeFromWatchLaterAction],
  }));
}

function showPlaylist(playlist: PlaylistSummary): void {
  renderVideoScreen(`Loading "${playlist.title}"…`, getPlaylistVideos(playlist.playlistId), () => ({
    onPlay: (index, queue): void => showPlayer(queue, index, playlist.title, (): void => showPlaylist(playlist)),
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
  optionsFor: () => { onPlay: (index: number, queue: Video[]) => void; actions: VideoAction[] },
): void {
  const app = appContainer();
  if (!app) return;
  app.textContent = loadingMessage;
  load
    .then((videos): void => {
      app.innerHTML = "";
      app.appendChild(VideoListView(videos, optionsFor()));
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
    if (!term) return;
    // Build with concatenation, NOT a template literal: Apps Script's page
    // serializer mishandles "//" inside a backtick template literal (treats it
    // as a line comment), which broke the whole bundle. Double-quoted strings
    // with "//" are fine (see the IFrame API URL in playerView.ts).
    const searchUrl = "https://www.youtube.com/results?search_query=" + encodeURIComponent(term);
    window.open(searchUrl, "_blank");
  });
}

function start(): void {
  const app = appContainer();
  if (!app) return;
  setupNav();
  setupSearch();
  showFeed();
}

// Run only after the page (and the google.script bridge) is fully loaded.
if (document.readyState === "complete") {
  start();
} else {
  window.addEventListener("load", (): void => start());
}
