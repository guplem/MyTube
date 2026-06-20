// Browser entry point. App state (which tab, which video) lives in the browser
// URL via urlState, so back/forward and shareable links work. Navigation flows
// through go()/render(): go() renders a screen AND pushes it to history; render()
// only draws it (used by the back/forward handler and the first load). Every list
// screen is the shared VideoListView; every video plays through PlayerView.

import type { Video } from "../shared/video";
import {
  getFeedPage,
  getHistory,
  getPlaylists,
  getPlaylistVideos,
  getWatchLaterVideos,
  addToWatchLater,
  removeFromWatchLater,
  markVideoSeen,
  removeVideoSeen,
} from "./serverBridge";
import { VideoListView, PagedVideoListView, type VideoAction } from "./videoListView";
import { PlayerView } from "./playerView";
import {
  getBoolPreference,
  setBoolPreference,
  getStringPreference,
  setStringPreference,
} from "./preferences";
import {
  pushUrlState,
  replaceUrlState,
  onUrlStateChange,
  readInitialParams,
  type UrlParams,
} from "./urlState";

const HIDE_SHORTS_PREF = "mytube.hideShorts";
const HIDE_VIEWED_PREF = "mytube.hideViewed";
const BEFORE_DATE_PREF = "mytube.beforeDate";

// A navigable screen. The player carries its queue/index in memory when opened
// from a list; on a shared link or forward-nav the queue is rebuilt from context.
type PlayerContext =
  | { source: "feed" }
  | { source: "watchlater" }
  | { source: "history" }
  | { source: "playlist"; playlistId: string; title: string };

interface PlayerScreen {
  view: "player";
  videoId: string;
  label: string;
  context: PlayerContext;
  queue?: Video[];
  index?: number;
}

type Screen =
  | { view: "feed" }
  | { view: "watchlater" }
  | { view: "playlists" }
  | { view: "history" }
  | { view: "playlist"; playlistId: string; title: string }
  | PlayerScreen;

// Which nav tab a screen belongs to (for highlighting the active button).
type Section = "feed" | "watchlater" | "playlists" | "history";

function appContainer(): HTMLElement | null {
  return document.getElementById("app");
}

// --- Per-card actions ------------------------------------------------------

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

// Reflects the current seen state on the card and its toggle button.
function reflectSeen(video: Video, button: HTMLButtonElement): void {
  button.disabled = false;
  button.textContent = video.seen ? "Seen ✓" : "Mark seen";
  button.closest(".video-card")?.classList.toggle("video-card--seen", video.seen);
}

// Toggles a video in/out of the watch history. Used on the feed and playlists,
// where the card stays in place and only its seen styling changes.
function toggleSeen(video: Video, button: HTMLButtonElement): void {
  button.disabled = true;
  const request = video.seen ? removeVideoSeen(video.videoId) : markVideoSeen(video);
  request
    .then((): void => {
      video.seen = !video.seen;
      reflectSeen(video, button);
    })
    .catch((): void => {
      button.disabled = false;
    });
}

const markSeenAction: VideoAction = {
  label: (video) => (video.seen ? "Seen ✓" : "Mark seen"),
  onClick: toggleSeen,
};

// Watch Later: marking a video seen also drops it from the playlist.
const watchLaterSeenAction: VideoAction = {
  label: (video) => (video.seen ? "Seen ✓" : "Mark seen"),
  onClick: (video, button): void => {
    if (video.seen) {
      toggleSeen(video, button);
      return;
    }
    button.disabled = true;
    markVideoSeen(video)
      .then((): Promise<void> => removeFromWatchLater(video.videoId))
      .then((): void => {
        button.closest(".video-card")?.remove();
      })
      .catch((): void => {
        button.disabled = false;
      });
  },
};

// History: every video is already seen, so the button removes it from history
// and drops the card.
const historySeenAction: VideoAction = {
  label: "Seen ✓",
  onClick: (video, button): void => {
    button.disabled = true;
    removeVideoSeen(video.videoId)
      .then((): void => {
        button.closest(".video-card")?.remove();
      })
      .catch((): void => {
        button.disabled = false;
      });
  },
};

// --- Screens ---------------------------------------------------------------

function showFeed(forceFirstLoad: boolean = false): void {
  const app = appContainer();
  if (!app) return;
  app.innerHTML = "";

  const toolbar = document.createElement("div");
  toolbar.className = "feed-toolbar";

  // Filters on the left; changing any of them re-renders the feed (showFeed),
  // which resets to page 0 and reloads with the new state. The loader reads each
  // preference fresh on every page request.
  const filters = document.createElement("div");
  filters.className = "feed-filters";
  filters.append(
    feedToggle("Hide Shorts", HIDE_SHORTS_PREF, true),
    feedToggle("Hide viewed", HIDE_VIEWED_PREF, false),
    beforeDateControl(),
  );

  // The cache refresh sits apart on the right: it force-fetches fresh RSS for
  // every channel (bypassing the 30-minute cache), unlike the filters.
  const refresh = document.createElement("button");
  refresh.type = "button";
  refresh.className = "refresh-button refresh-button--right";
  refresh.textContent = "↻ Clear cache and refresh";
  refresh.addEventListener("click", (): void => showFeed(true));

  toolbar.append(filters, refresh);
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
          beforeDate: getStringPreference(BEFORE_DATE_PREF, ""),
        });
      },
      {
        onPlay: (index, queue): void => playFromList(queue, index, { source: "feed" }),
        actions: [addToWatchLaterAction, markSeenAction],
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

// Feed-only date filter: hide videos published before the chosen date. Auto-
// applies on change (clearing the field shows all). Stored in localStorage; it
// does not mark anything as seen, so playlists and Watch Later are unaffected.
function beforeDateControl(): HTMLElement {
  const label = document.createElement("label");
  label.className = "feed-toggle";
  const input = document.createElement("input");
  input.type = "date";
  input.className = "feed-date";
  input.value = getStringPreference(BEFORE_DATE_PREF, "");
  input.addEventListener("change", (): void => {
    setStringPreference(BEFORE_DATE_PREF, input.value);
    showFeed();
  });
  label.append(document.createTextNode("Hide before "), input);
  return label;
}

// "Hide viewed" is intentionally absent here: the history list is entirely seen
// videos, so hiding them would empty it.
function showHistory(): void {
  renderVideoScreen("Loading your history…", getHistory(), () => ({
    onPlay: (index, queue): void => playFromList(queue, index, { source: "history" }),
    actions: [addToWatchLaterAction, historySeenAction],
  }));
}

function showWatchLater(): void {
  renderVideoScreen("Loading Watch Later…", getWatchLaterVideos(), () => ({
    onPlay: (index, queue): void => playFromList(queue, index, { source: "watchlater" }),
    actions: [watchLaterSeenAction, removeFromWatchLaterAction],
  }));
}

function showPlaylist(playlistId: string, title: string): void {
  renderVideoScreen(`Loading "${title}"…`, getPlaylistVideos(playlistId), () => ({
    onPlay: (index, queue): void =>
      playFromList(queue, index, { source: "playlist", playlistId, title }),
    actions: [addToWatchLaterAction, markSeenAction],
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
        button.addEventListener("click", (): void =>
          go({ view: "playlist", playlistId: playlist.playlistId, title: playlist.title }),
        );
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

// --- Player ----------------------------------------------------------------

function playFromList(queue: Video[], index: number, context: PlayerContext): void {
  const video = queue[index];
  if (!video) return;
  go({ view: "player", videoId: video.videoId, label: labelForContext(context), context, queue, index });
}

function renderPlayer(screen: PlayerScreen): void {
  if (screen.queue && screen.queue.length > 0) {
    mountPlayer(screen, screen.queue, screen.index ?? 0);
    return;
  }
  // No in-memory queue (shared link or forward navigation): rebuild it.
  const app = appContainer();
  if (app) app.textContent = "Loading video…";
  rebuildQueue(screen.context, screen.videoId)
    .then((queue): void => {
      const index = Math.max(
        0,
        queue.findIndex((video) => video.videoId === screen.videoId),
      );
      mountPlayer(screen, queue, index);
    })
    .catch((): void => {
      mountPlayer(screen, [minimalVideo(screen.videoId)], 0);
    });
}

function rebuildQueue(context: PlayerContext, videoId: string): Promise<Video[]> {
  switch (context.source) {
    case "watchlater":
      return getWatchLaterVideos();
    case "history":
      return getHistory();
    case "playlist":
      return getPlaylistVideos(context.playlistId);
    default:
      // The feed pages on the server, so there is no full list to rebuild from;
      // play the single shared video without a prev/next queue.
      return Promise.resolve([minimalVideo(videoId)]);
  }
}

function minimalVideo(videoId: string): Video {
  return { videoId, title: "", channelId: "", channelTitle: "", thumbnailUrl: "", publishedAt: "", seen: false };
}

function mountPlayer(screen: PlayerScreen, queue: Video[], index: number): void {
  const app = appContainer();
  if (!app) return;
  app.innerHTML = "";
  app.appendChild(
    PlayerView({
      queue,
      startIndex: index,
      contextLabel: screen.label,
      onBack: (): void => go(screenForContext(screen.context)),
      onVideoChange: (videoId, currentIndex): void => {
        // Reflect the current video in the URL without a new history entry, so
        // the link is shareable but prev/next does not flood back/forward.
        const next: PlayerScreen = { ...screen, videoId, index: currentIndex, queue };
        replaceUrlState(next, paramsFor(next));
      },
    }),
  );
}

// --- Routing ---------------------------------------------------------------

function go(screen: Screen): void {
  render(screen);
  pushUrlState(screen, paramsFor(screen));
}

function render(screen: Screen): void {
  setActiveNav(sectionOf(screen));
  switch (screen.view) {
    case "watchlater":
      showWatchLater();
      break;
    case "playlists":
      showPlaylists();
      break;
    case "history":
      showHistory();
      break;
    case "playlist":
      showPlaylist(screen.playlistId, screen.title);
      break;
    case "player":
      renderPlayer(screen);
      break;
    default:
      showFeed();
  }
}

function paramsFor(screen: Screen): UrlParams {
  switch (screen.view) {
    case "playlist":
      return { view: "playlist", pl: screen.playlistId, title: screen.title };
    case "player": {
      const params: UrlParams = { view: "player", v: screen.videoId, src: screen.context.source };
      if (screen.context.source === "playlist") {
        params.pl = screen.context.playlistId;
        params.title = screen.context.title;
      }
      return params;
    }
    default:
      return { view: screen.view };
  }
}

function screenFromParams(params: UrlParams): Screen {
  switch (params.view) {
    case "watchlater":
      return { view: "watchlater" };
    case "playlists":
      return { view: "playlists" };
    case "history":
      return { view: "history" };
    case "playlist":
      return params.pl
        ? { view: "playlist", playlistId: params.pl, title: params.title ?? "" }
        : { view: "feed" };
    case "player": {
      if (!params.v) return { view: "feed" };
      const context = playerContextFromParams(params);
      return { view: "player", videoId: params.v, label: labelForContext(context), context };
    }
    default:
      return { view: "feed" };
  }
}

function playerContextFromParams(params: UrlParams): PlayerContext {
  switch (params.src) {
    case "watchlater":
      return { source: "watchlater" };
    case "history":
      return { source: "history" };
    case "playlist":
      return params.pl
        ? { source: "playlist", playlistId: params.pl, title: params.title ?? "" }
        : { source: "feed" };
    default:
      return { source: "feed" };
  }
}

function labelForContext(context: PlayerContext): string {
  switch (context.source) {
    case "watchlater":
      return "Watch Later";
    case "history":
      return "History";
    case "playlist":
      return context.title;
    default:
      return "Subscriptions";
  }
}

function screenForContext(context: PlayerContext): Screen {
  switch (context.source) {
    case "watchlater":
      return { view: "watchlater" };
    case "history":
      return { view: "history" };
    case "playlist":
      return { view: "playlist", playlistId: context.playlistId, title: context.title };
    default:
      return { view: "feed" };
  }
}

function sectionOf(screen: Screen): Section {
  switch (screen.view) {
    case "watchlater":
      return "watchlater";
    case "playlists":
    case "playlist":
      return "playlists";
    case "history":
      return "history";
    case "player":
      return sectionOf(screenForContext(screen.context));
    default:
      return "feed";
  }
}

function setActiveNav(section: Section): void {
  document.querySelectorAll<HTMLButtonElement>(".app-nav button").forEach((button): void => {
    button.classList.toggle("active", button.dataset.view === section);
  });
}

function setupNav(): void {
  document.querySelectorAll<HTMLButtonElement>(".app-nav button").forEach((button): void => {
    button.addEventListener("click", (): void => {
      switch (button.dataset.view) {
        case "watchlater":
          go({ view: "watchlater" });
          break;
        case "playlists":
          go({ view: "playlists" });
          break;
        case "history":
          go({ view: "history" });
          break;
        default:
          go({ view: "feed" });
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
  onUrlStateChange((state, params): void => {
    render((state as Screen | null) ?? screenFromParams(params));
  });
  readInitialParams((params): void => {
    const screen = screenFromParams(params);
    render(screen);
    // Normalize the URL so even the default feed view is shareable.
    replaceUrlState(screen, paramsFor(screen));
  });
}

// Run only after the page (and the google.script bridge) is fully loaded.
if (document.readyState === "complete") {
  start();
} else {
  window.addEventListener("load", (): void => start());
}
