// Browser entry point. App state (which tab, which video) lives in the browser
// URL via urlState, so back/forward and shareable links work. Navigation flows
// through go()/render(): go() renders a screen AND pushes it to history; render()
// only draws it (used by the back/forward handler and the first load). Every list
// screen is the shared VideoListView; every video plays through PlayerView.

import type { Video } from "../shared/video";
import type { FeedPageOptions } from "../shared/feed";
import { defaultFeedBeforeDate } from "../shared/feed";
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
  markVideoDismissed,
  removeVideoDismissed,
} from "./serverBridge";
import {
  VideoListView,
  PagedVideoListView,
  skeletonGrid,
  DEFAULT_PAGE_SIZE,
  type VideoAction,
} from "./videoListView";
import { warmFeedPage, takePrefetchedFeedPage } from "./feedPrefetch";
import { skeletonPlaylistList, skeletonPlayerView, skeletonSortToolbar } from "./skeleton";
import { PlayerView, type PlayerController } from "./playerView";
import { optimistic } from "./optimistic";
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
const HIDE_DISMISSED_PREF = "mytube.hideDismissed";
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

// The screen shown on a fresh launch (no view param) and as the fallback for an
// unrecognized/incomplete URL. Watch Later is the default: it is the "watch the
// backlog" list you came here to clear, not the never-ending uploads feed.
const DEFAULT_SCREEN: Screen = { view: "watchlater" };

function appContainer(): HTMLElement | null {
  return document.getElementById("app");
}

// --- Per-card actions ------------------------------------------------------
//
// Every action is optimistic (see src/ui/optimistic.ts): it updates the card the
// instant it is tapped, as if the server call had already succeeded, and only
// fires the request in the background. If the request fails, the change is rolled
// back to its previous state and a toast tells the user (with a one-tap page
// refresh). This keeps the UI snappy even when the underlying Apps Script calls
// are slow. The same `optimistic` helper drives the player's buttons too.

// Optimistically removes a card from the list: hides it immediately, then drops
// it for good once the request succeeds. On failure the card is restored to its
// original place (it was only hidden, never detached), any extra state change is
// undone via onRollback, and a toast is shown.
function optimisticRemove(
  button: HTMLButtonElement,
  request: Promise<void>,
  failMessage: string,
  onRollback?: () => void,
): void {
  const card = button.closest<HTMLElement>(".video-card");
  optimistic({
    apply: (): void => {
      if (card) card.style.display = "none";
    },
    revert: (): void => {
      if (card) card.style.display = "";
      onRollback?.();
    },
    onSuccess: (): void => card?.remove(),
    send: (): Promise<void> => request,
    failMessage,
  });
}

const addToWatchLaterAction: VideoAction = {
  label: (video) => (video.inWatchLater ? "Added ✓" : "+ Watch Later"),
  disabled: (video) => Boolean(video.inWatchLater),
  onClick: (video, button): void => {
    optimistic({
      key: button,
      // Assume success: show "Added ✓" and lock the button right away.
      apply: (): void => {
        video.inWatchLater = true;
        button.disabled = true;
        button.textContent = "Added ✓";
      },
      revert: (): void => {
        video.inWatchLater = false;
        button.disabled = false;
        button.textContent = "+ Watch Later";
      },
      send: (): Promise<void> => addToWatchLater(video.videoId),
      failMessage: "Couldn't add to Watch Later",
    });
  },
};

const removeFromWatchLaterAction: VideoAction = {
  label: "Remove",
  onClick: (video, button): void => {
    optimisticRemove(
      button,
      removeFromWatchLater(video.videoId),
      "Couldn't remove from Watch Later",
    );
  },
};

// Optimistic toggle for the in-place boolean flags (seen, dismissed). Flips the
// flag, reflects it, fires the request, and rolls back + toasts only if this is
// still the most recent tap on the button when the request fails (the button is
// the dedup key). See src/ui/optimistic.ts.
function optimisticToggle(
  button: HTMLButtonElement,
  get: () => boolean,
  set: (value: boolean) => void,
  send: (next: boolean) => Promise<void>,
  failMessage: (next: boolean) => string,
): void {
  const target = !get();
  optimistic({
    key: button,
    apply: (): void => set(target),
    revert: (): void => set(!target),
    send: (): Promise<void> => send(target),
    failMessage: failMessage(target),
  });
}

// Reflects the current seen state on the card and its toggle button.
function reflectSeen(video: Video, button: HTMLButtonElement): void {
  button.textContent = video.seen ? "Seen ✓" : "Mark seen";
  button.closest(".video-card")?.classList.toggle("video-card--seen", video.seen);
}

// Toggles a video in/out of the watch history. Used on the feed and playlists,
// where the card stays in place and only its seen styling changes. Flips the
// state immediately and rolls back if the request fails.
function toggleSeen(video: Video, button: HTMLButtonElement): void {
  optimisticToggle(
    button,
    (): boolean => video.seen,
    (value): void => {
      video.seen = value;
      reflectSeen(video, button);
    },
    (next): Promise<void> => (next ? markVideoSeen(video) : removeVideoSeen(video.videoId)),
    (next): string => (next ? "Couldn't mark as seen" : "Couldn't mark as unseen"),
  );
}

// Marking a video seen also drops it from Watch Later (server-side, from every
// screen), so revert any "Added ✓" indicator left on this card.
function reflectLeftWatchLater(video: Video, seenButton: HTMLButtonElement): void {
  if (!video.inWatchLater) return;
  video.inWatchLater = false;
  const row = seenButton.closest(".video-actions");
  row?.querySelectorAll<HTMLButtonElement>(".video-action").forEach((button): void => {
    if (button.textContent === "Added ✓") {
      button.textContent = "+ Watch Later";
      button.disabled = false;
    }
  });
}

const markSeenAction: VideoAction = {
  label: (video) => (video.seen ? "Seen ✓" : "Mark seen"),
  onClick: (video, button): void => {
    const wasSeen = video.seen;
    toggleSeen(video, button);
    // Only the seen→unseen-free direction drops it from Watch Later; un-marking
    // seen never re-adds it.
    if (!wasSeen) reflectLeftWatchLater(video, button);
  },
};

// Watch Later: marking a video seen drops it from the playlist server-side, so
// the card leaves the list. Optimistically remove it and roll back on failure.
const watchLaterSeenAction: VideoAction = {
  label: "Mark seen",
  onClick: (video, button): void => {
    video.seen = true;
    optimisticRemove(button, markVideoSeen(video), "Couldn't mark as seen", (): void => {
      video.seen = false;
    });
  },
};

// History: every video is already seen, so the button removes it from history
// and drops the card.
const historySeenAction: VideoAction = {
  label: "Seen ✓",
  onClick: (video, button): void => {
    optimisticRemove(button, removeVideoSeen(video.videoId), "Couldn't remove from history");
  },
};

// Reflects the current dismissed state on the corner button and dims the card.
// The button is a top-right cross (✕ to dismiss, ↩ to undo); feed only.
function reflectDismissed(video: Video, button: HTMLButtonElement): void {
  button.textContent = video.dismissed ? "↩" : "✕";
  button.setAttribute("aria-label", video.dismissed ? "Undo dismiss" : "Dismiss video from feed");
  button.closest(".video-card")?.classList.toggle("video-card--dismissed", Boolean(video.dismissed));
}

// Feed-only: toggles a video in/out of the dismissed list. Mirrors the seen
// toggle; the card stays in place (dimmed) and "Hide dismissed" removes it on
// the next feed load. Flips immediately and rolls back on failure.
function toggleDismiss(video: Video, button: HTMLButtonElement): void {
  optimisticToggle(
    button,
    (): boolean => Boolean(video.dismissed),
    (value): void => {
      video.dismissed = value;
      reflectDismissed(video, button);
    },
    (next): Promise<void> =>
      next ? markVideoDismissed(video.videoId) : removeVideoDismissed(video.videoId),
    (next): string => (next ? "Couldn't dismiss video" : "Couldn't undo dismiss"),
  );
}

const dismissAction: VideoAction = {
  label: (video) => (video.dismissed ? "↩" : "✕"),
  onClick: toggleDismiss,
};

// --- Screens ---------------------------------------------------------------

// The feed page options for the current filter preferences. Used by the feed
// screen's loader AND the background warm-up, so a warmed page matches the
// exact request the feed screen would make.
function feedPageOptions(page: number, pageSize: number, forceRefresh: boolean): FeedPageOptions {
  return {
    page,
    pageSize,
    forceRefresh,
    hideShorts: getBoolPreference(HIDE_SHORTS_PREF, true),
    hideViewed: getBoolPreference(HIDE_VIEWED_PREF, false),
    hideDismissed: getBoolPreference(HIDE_DISMISSED_PREF, true),
    beforeDate: getStringPreference(BEFORE_DATE_PREF, defaultFeedBeforeDate(new Date())),
  };
}

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
    feedToggle("Hide dismissed", HIDE_DISMISSED_PREF, true),
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

  // Warns when some channels' RSS could not be fetched this load, so a partial
  // feed is never silently mistaken for "no new videos". Hidden until needed.
  const notice = document.createElement("div");
  notice.className = "feed-notice";
  notice.style.display = "none";
  app.appendChild(notice);

  let pendingForce = forceFirstLoad;
  app.appendChild(
    PagedVideoListView(
      (page, pageSize) => {
        const forceRefresh = pendingForce;
        pendingForce = false;
        const options = feedPageOptions(page, pageSize, forceRefresh);
        // First page, no forced refresh: use the page warmed in the background
        // while the user was on another screen (see feedPrefetch.ts). A miss
        // (different filters, gone stale, already used) falls through to a
        // normal server call.
        if (!forceRefresh) {
          const prefetched = takePrefetchedFeedPage(options);
          if (prefetched) return prefetched;
        }
        return getFeedPage(options);
      },
      {
        onPlay: (index, queue): void => playFromList(queue, index, { source: "feed" }),
        actions: [addToWatchLaterAction, markSeenAction],
        cornerAction: dismissAction,
        onPageLoaded: (result): void => updateFeedNotice(notice, result),
      },
    ),
  );
}

// Shows or hides the feed load-health warning. failedChannels/totalChannels are
// feed-only fields on the loader result; absent (in-memory lists) means no notice.
function updateFeedNotice(
  notice: HTMLElement,
  result: { failedChannels?: number; totalChannels?: number },
): void {
  const failed = result.failedChannels ?? 0;
  if (failed <= 0) {
    notice.style.display = "none";
    notice.textContent = "";
    return;
  }
  const total = result.totalChannels ?? 0;
  notice.textContent =
    "⚠ " +
    failed +
    " of " +
    total +
    " channels couldn't be loaded right now (YouTube may be rate-limiting). " +
    "Showing cached videos where available — try refreshing in a moment.";
  notice.style.display = "";
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
// applies on change. The feed is always bounded — with nothing stored (first
// login, or after clearing the field) it defaults to defaultFeedBeforeDate;
// the user can pick an older date to widen it, but there is no "show all"
// state, which keeps the Shorts-duration lookups small. Stored in localStorage;
// it does not mark anything as seen, so playlists and Watch Later are unaffected.
function beforeDateControl(): HTMLElement {
  const label = document.createElement("label");
  label.className = "feed-toggle";
  const input = document.createElement("input");
  input.type = "date";
  input.className = "feed-date";
  input.value = getStringPreference(BEFORE_DATE_PREF, defaultFeedBeforeDate(new Date()));
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
  renderVideoScreen(getHistory(), () => ({
    onPlay: (index, queue): void => playFromList(queue, index, { source: "history" }),
    actions: [addToWatchLaterAction, historySeenAction],
  }));
}

// Watch Later defaults to oldest upload first (the natural "watch the backlog"
// order); other playlists default to their YouTube order.
function showWatchLater(): void {
  renderPlaylistScreen(getWatchLaterVideos(), "oldest", () => ({
    onPlay: (index, queue): void => playFromList(queue, index, { source: "watchlater" }),
    actions: [watchLaterSeenAction, removeFromWatchLaterAction],
  }));
}

function showPlaylist(playlistId: string, title: string): void {
  renderPlaylistScreen(getPlaylistVideos(playlistId), "playlist", () => ({
    onPlay: (index, queue): void =>
      playFromList(queue, index, { source: "playlist", playlistId, title }),
    actions: [addToWatchLaterAction, markSeenAction],
  }));
}

function showPlaylists(): void {
  const app = appContainer();
  if (!app) return;
  app.innerHTML = "";
  app.appendChild(skeletonPlaylistList());
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

// Loads a Video[] and renders it with VideoListView. Shows placeholder cards
// while loading (old content is cleared first) and a failure message on error.
function renderVideoScreen(
  load: Promise<Video[]>,
  optionsFor: () => { onPlay: (index: number, queue: Video[]) => void; actions: VideoAction[] },
): void {
  const app = appContainer();
  if (!app) return;
  app.innerHTML = "";
  app.appendChild(skeletonGrid());
  load
    .then((videos): void => {
      app.innerHTML = "";
      app.appendChild(VideoListView(videos, optionsFor()));
    })
    .catch((error: Error): void => {
      app.textContent = `Could not load this list: ${error.message}`;
    });
}

// Sort orders offered on playlist screens. "playlist" keeps YouTube's own order.
type SortKey = "playlist" | "newest" | "oldest" | "title";

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "playlist", label: "Playlist order" },
  { key: "newest", label: "Upload date (newest first)" },
  { key: "oldest", label: "Upload date (oldest first)" },
  { key: "title", label: "Title (A–Z)" },
];

// Returns a sorted copy; "playlist" keeps the original (YouTube) order.
function sortVideos(videos: Video[], key: SortKey): Video[] {
  if (key === "playlist") return videos;
  const sorted = videos.slice();
  if (key === "newest") sorted.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  else if (key === "oldest") sorted.sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
  else sorted.sort((a, b) => a.title.localeCompare(b.title));
  return sorted;
}

// Like renderVideoScreen, but with a sort-order selector at the top. Re-sorting
// re-renders only the list. The player queue follows the displayed order.
function renderPlaylistScreen(
  load: Promise<Video[]>,
  defaultSort: SortKey,
  optionsFor: () => { onPlay: (index: number, queue: Video[]) => void; actions: VideoAction[] },
): void {
  const app = appContainer();
  if (!app) return;
  app.innerHTML = "";
  // The placeholder mirrors the loaded layout (sort toolbar + grid) so the
  // cards don't shift down when the real toolbar appears.
  app.append(skeletonSortToolbar(), skeletonGrid());
  load
    .then((videos): void => {
      app.innerHTML = "";
      let currentSort = defaultSort;

      const toolbar = document.createElement("div");
      toolbar.className = "feed-toolbar";
      const label = document.createElement("label");
      label.className = "feed-toggle";
      const select = document.createElement("select");
      select.className = "sort-select";
      for (const option of SORT_OPTIONS) {
        const element = document.createElement("option");
        element.value = option.key;
        element.textContent = option.label;
        if (option.key === currentSort) element.selected = true;
        select.appendChild(element);
      }
      label.append(document.createTextNode("Sort "), select);
      toolbar.appendChild(label);

      const listHost = document.createElement("div");

      function renderList(): void {
        listHost.innerHTML = "";
        listHost.appendChild(VideoListView(sortVideos(videos, currentSort), optionsFor()));
      }

      select.addEventListener("change", (): void => {
        currentSort = select.value as SortKey;
        renderList();
      });

      app.append(toolbar, listHost);
      renderList();
    })
    .catch((error: Error): void => {
      app.textContent = `Could not load this list: ${error.message}`;
    });
}

// --- Player ----------------------------------------------------------------

// The currently mounted player, so back/forward and prev/next can switch the
// video in place (loadVideoById) instead of reloading the iframe.
let activePlayer: { controller: PlayerController; key: string } | null = null;

function playFromList(queue: Video[], index: number, context: PlayerContext): void {
  const video = queue[index];
  if (!video) return;
  go({ view: "player", videoId: video.videoId, label: labelForContext(context), context, queue, index });
}

function renderPlayer(screen: PlayerScreen): void {
  if (screen.queue && screen.queue.length > 0) {
    showPlayer(screen, screen.queue);
    return;
  }
  // No in-memory queue (shared link or forward navigation): rebuild it.
  const app = appContainer();
  if (app) app.replaceChildren(skeletonPlayerView());
  rebuildQueue(screen.context, screen.videoId)
    .then((queue): void => showPlayer(screen, queue))
    .catch((): void => showPlayer(screen, [minimalVideo(screen.videoId)]));
}

// Shows the player for a screen. If a player for the same queue is already
// mounted (prev/next or back/forward within the same session), it just switches
// the video in place; otherwise it mounts a fresh player.
function showPlayer(screen: PlayerScreen, queue: Video[]): void {
  const key = playerQueueKey(screen.context, queue);
  if (activePlayer && activePlayer.key === key && activePlayer.controller.hasVideo(screen.videoId)) {
    activePlayer.controller.goToVideo(screen.videoId);
    return;
  }
  const app = appContainer();
  if (!app) return;
  clearActivePlayer();
  app.innerHTML = "";
  const controller = PlayerView({
    queue,
    startIndex: Math.max(0, queue.findIndex((video) => video.videoId === screen.videoId)),
    contextLabel: screen.label,
    onBack: (): void => go(screenForContext(screen.context)),
    // prev/next/autoplay request navigation; go() pushes one history entry per
    // video, then drives this same player via goToVideo above.
    onNavigate: (videoId, navIndex): void => go({ ...screen, videoId, index: navIndex, queue }),
  });
  activePlayer = { controller, key };
  app.appendChild(controller.element);
}

// Identifies a player session: same source and same ordered queue. Back/forward
// to a video in this same queue updates the live player rather than remounting.
function playerQueueKey(context: PlayerContext, queue: Video[]): string {
  const base = context.source === "playlist" ? "playlist:" + context.playlistId : context.source;
  return base + "|" + queue.map((video) => video.videoId).join(",");
}

function clearActivePlayer(): void {
  if (activePlayer) {
    activePlayer.controller.destroy();
    activePlayer = null;
  }
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

// --- Routing ---------------------------------------------------------------

function go(screen: Screen): void {
  // Push BEFORE render. The player calls onVideoChange during render, which
  // replaceUrlState()s the current history entry. If we rendered first, that
  // replace would overwrite the PREVIOUS screen's entry (e.g. the feed) instead
  // of the player's own, leaving two player entries and breaking browser Back.
  pushUrlState(screen, paramsFor(screen));
  render(screen);
  // Start every freshly-navigated screen at the top. Swapping #app's content
  // does not reset the document scroll, so on mobile, tapping a card near the
  // bottom of a long list would otherwise land you scrolled past the video.
  // Back/forward goes through render() directly, keeping native scroll restore.
  window.scrollTo(0, 0);
}

function render(screen: Screen): void {
  setActiveNav(sectionOf(screen));
  // Any screen but the feed warms feed page 1 in the background (the feed's own
  // loader is the fetch there). Fire-and-forget: it runs as its own parallel
  // server call, so it never delays the screen being rendered. A fresh warm for
  // the same filters is a no-op, and the server only refetches the channels
  // whose RSS cache expired — never a forced refresh.
  if (screen.view !== "feed") warmFeedPage(feedPageOptions(0, DEFAULT_PAGE_SIZE, false));
  // Leaving the player: tear down the YouTube iframe so it stops playing.
  if (screen.view !== "player") clearActivePlayer();
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
    case "feed":
      return { view: "feed" };
    case "playlist":
      return params.pl
        ? { view: "playlist", playlistId: params.pl, title: params.title ?? "" }
        : DEFAULT_SCREEN;
    case "player": {
      if (!params.v) return DEFAULT_SCREEN;
      const context = playerContextFromParams(params);
      return { view: "player", videoId: params.v, label: labelForContext(context), context };
    }
    default:
      return DEFAULT_SCREEN;
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

// Run only after the page (and the google.script bridge) is fully loaded. The
// bundle itself executes earlier (inline at the end of <body>), so fill the app
// with placeholder cards right away — boot shows a skeleton, never a blank
// screen or a bare "Loading…" line — until the first routed screen replaces it.
if (document.readyState === "complete") {
  start();
} else {
  appContainer()?.appendChild(skeletonGrid());
  window.addEventListener("load", (): void => start());
}
