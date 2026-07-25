// Browser entry point. App state (which tab, which video) lives in the browser
// URL via urlState, so back/forward and shareable links work. Navigation flows
// through go()/render(): go() renders a screen AND pushes it to history; render()
// only draws it (used by the back/forward handler and the first load). Every list
// screen is the shared VideoListView; every video plays through PlayerView.

import type { Video } from "../shared/video";
import type { FeedPageOptions } from "../shared/feed";
import { defaultFeedBeforeDate } from "../shared/feed";
import { shouldSuggestWatched } from "../shared/videoProgress";
import {
  getHistory,
  getPlaylists,
  getPlaylistVideos,
  getWatchLaterVideos,
  addToWatchLater,
  removeFromWatchLater,
  markVideoSeen,
  removeVideoSeen,
  undoMarkVideoSeen,
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
import {
  warmFeedPage,
  loadFeedPage,
  forceReloadFeedPage,
} from "./feedPageCache";
import { renderBuildStamp } from "./buildStamp";
import {
  skeletonPlaylistList,
  skeletonPlayerView,
  skeletonSortToolbar,
} from "./skeleton";
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
const HIDE_SAVED_PREF = "mytube.hideSaved";
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
//
// Every action is also a TOGGLE: cards never leave the list (or lock a button)
// mid-session, they only flip state in place — dimmed when they will disappear
// on the next load — so any mis-tap is undone with a second tap. All list
// screens share the same two buttons per card (Watch Later + seen), so cards
// look identical everywhere; only the corner dismiss stays feed-only.

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

// Reflects Watch Later membership on the toggle button. The ON state keeps the
// list's name in the label ("✓ Watch Later", never a bare "Added ✓") and fills
// the button (video-action--on) so membership reads at a glance; the tooltip
// names what a click would do NOW. `vanishesWhen` is the membership value that
// drops the card from this list on the next load, so the card dims once the
// toggle reaches it; null means the card always stays and never dims.
function reflectWatchLater(
  video: Video,
  button: HTMLButtonElement,
  vanishesWhen: boolean | null,
): void {
  const saved = Boolean(video.inWatchLater);
  button.textContent = saved ? "✓ Watch Later" : "+ Watch Later";
  button.classList.toggle("video-action--on", saved);
  button.title = saved ? "Remove from Watch Later" : "Save to Watch Later";
  button.setAttribute("aria-pressed", String(saved));
  if (vanishesWhen !== null) {
    button
      .closest(".video-card")
      ?.classList.toggle("video-card--removed", saved === vanishesWhen);
  }
}

// Toggles a video in/out of Watch Later — the same button on every list. The
// two screens that shed cards do it on opposite states, which is why
// `vanishesWhen` is a value and not a flag: false on the Watch Later screen
// (where this toggle IS the remove button), true on the feed while "Hide
// saved" is on, null on playlists and history. Either way the card stays in
// place, only dimmed, until the next load. Flips immediately and rolls back on
// failure.
function makeWatchLaterToggle(vanishesWhen: boolean | null): VideoAction {
  return {
    name: "watchlater",
    reflect: (video, button): void =>
      reflectWatchLater(video, button, vanishesWhen),
    onClick: (video, button): void => {
      optimisticToggle(
        button,
        (): boolean => Boolean(video.inWatchLater),
        (value): void => {
          video.inWatchLater = value;
          reflectWatchLater(video, button, vanishesWhen);
        },
        (next): Promise<void> =>
          next
            ? addToWatchLater(video.videoId)
            : removeFromWatchLater(video.videoId),
        (next): string =>
          next
            ? "Couldn't add to Watch Later"
            : "Couldn't remove from Watch Later",
      );
    },
  };
}

// Playlists and history: the card stays whatever the toggle says, so no dim.
const watchLaterToggleAction = makeWatchLaterToggle(null);
// The Watch Later screen's copy of the toggle: toggling off dims the card.
const watchLaterRemoveAction = makeWatchLaterToggle(false);

// Reflects the current seen state on the card and its toggle button. Same
// pressed-toggle treatment as the Watch Later button; the UI copy says
// "watched" (matching the History tab) while the code keeps "seen". When the
// progress store says the video is effectively finished but it is not in the
// history yet, the button carries a notification dot (toggle-nudge): "you
// should probably tap this".
function reflectSeen(video: Video, button: HTMLButtonElement): void {
  const nudge =
    !video.seen &&
    shouldSuggestWatched(video.progressSeconds, video.durationSeconds);
  button.textContent = video.seen ? "✓ Watched" : "Mark watched";
  button.classList.toggle("video-action--on", video.seen);
  button.classList.toggle("toggle-nudge", nudge);
  button.title = video.seen
    ? "Mark as not watched"
    : nudge
      ? "Mark as watched — you finished this video"
      : "Mark as watched";
  button.setAttribute("aria-pressed", String(video.seen));
  button
    .closest(".video-card")
    ?.classList.toggle("video-card--seen", video.seen);
}

// Toggles a video in/out of the watch history. The card stays in place and only
// its seen styling changes; flips the state immediately and rolls back if the
// request fails. `unmark` is the un-toggle server call — the default just
// removes the view; Watch Later passes undoMarkVideoSeen, which also restores
// the video to the playlist.
function toggleSeen(
  video: Video,
  button: HTMLButtonElement,
  unmark: (videoId: string) => Promise<void> = removeVideoSeen,
): void {
  optimisticToggle(
    button,
    (): boolean => video.seen,
    (value): void => {
      video.seen = value;
      reflectSeen(video, button);
    },
    (next): Promise<void> =>
      next ? markVideoSeen(video) : unmark(video.videoId),
    (next): string =>
      next ? "Couldn't mark as watched" : "Couldn't mark as not watched",
  );
}

// Marking watched also drops the video from Watch Later server-side (and the
// Watch Later screen's watched undo restores it), so mirror a membership change
// on the Watch Later toggle sitting in the same action row. The button is found
// by its data-action tag (set from VideoAction.name), never by label text, so
// relabeling can't silently break this sync. `vanishesWhen` is the caller
// screen's own value (see makeWatchLaterToggle) — passing the wrong one here
// dims a card that is staying, or leaves a stale dim on one that is not.
function syncWatchLaterButtons(
  video: Video,
  seenButton: HTMLButtonElement,
  vanishesWhen: boolean | null,
): void {
  const row = seenButton.closest(".video-actions");
  row
    ?.querySelectorAll<HTMLButtonElement>(
      '.video-action[data-action="watchlater"]',
    )
    .forEach((button): void => reflectWatchLater(video, button, vanishesWhen));
}

// The watched toggle, shared by every list. It is a factory because marking
// watched also un-saves the video, so the membership button next to it has to
// be re-reflected with THIS screen's `vanishesWhen` — the same value its
// Watch Later toggle uses.
function makeSeenAction(vanishesWhen: boolean | null): VideoAction {
  return {
    name: "seen",
    reflect: reflectSeen,
    onClick: (video, button): void => {
      const wasSeen = video.seen;
      toggleSeen(video, button);
      // Only the unseen→seen direction drops it from Watch Later; un-marking
      // seen never re-adds it.
      if (!wasSeen && video.inWatchLater) {
        video.inWatchLater = false;
        syncWatchLaterButtons(video, button, vanishesWhen);
      }
    },
  };
}

// Playlists and history: pairs with watchLaterToggleAction's null.
const markSeenAction: VideoAction = makeSeenAction(null);

// Watch Later: same watched toggle, but its un-toggle goes through
// undoMarkVideoSeen, which restores the playlist entry that marking seen
// dropped server-side — otherwise the toggle would look undone here but the
// video would be gone from Watch Later after a refresh. The membership toggle
// next to it mirrors both directions, and the removal dim follows via
// reflectWatchLater with the Watch Later screen's own vanishesWhen (false, the
// same value watchLaterRemoveAction uses).
const watchLaterSeenAction: VideoAction = {
  name: "seen",
  reflect: reflectSeen,
  onClick: (video, button): void => {
    toggleSeen(video, button, undoMarkVideoSeen);
    // toggleSeen applied optimistically, so video.seen is already the new state.
    video.inWatchLater = !video.seen;
    syncWatchLaterButtons(video, button, false);
  },
};

// Reflects the current dismissed state on the corner button and dims the card.
// The button is a top-right cross (✕ to dismiss, ↩ to undo); feed only. Runs at
// first render too (via VideoAction.reflect), so a card that arrives already
// dismissed gets the ↩ tooltip/label right away.
function reflectDismissed(video: Video, button: HTMLButtonElement): void {
  const dismissed = Boolean(video.dismissed);
  button.textContent = dismissed ? "↩" : "✕";
  button.title = dismissed ? "Undo dismiss" : "Dismiss from feed";
  button.setAttribute(
    "aria-label",
    dismissed ? "Undo dismiss" : "Dismiss from feed",
  );
  button.setAttribute("aria-pressed", String(dismissed));
  button
    .closest(".video-card")
    ?.classList.toggle("video-card--dismissed", dismissed);
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
      next
        ? markVideoDismissed(video.videoId)
        : removeVideoDismissed(video.videoId),
    (next): string =>
      next ? "Couldn't dismiss video" : "Couldn't undo dismiss",
  );
}

const dismissAction: VideoAction = {
  reflect: reflectDismissed,
  onClick: toggleDismiss,
};

// --- Screens ---------------------------------------------------------------

// The feed page options for the current filter preferences. Used by the feed
// screen's loader AND the background warm-up, so a warmed page matches the
// exact request the feed screen would make.
function feedPageOptions(
  page: number,
  pageSize: number,
  forceRefresh: boolean,
): FeedPageOptions {
  return {
    page,
    pageSize,
    forceRefresh,
    hideShorts: getBoolPreference(HIDE_SHORTS_PREF, true),
    hideViewed: getBoolPreference(HIDE_VIEWED_PREF, false),
    hideDismissed: getBoolPreference(HIDE_DISMISSED_PREF, true),
    hideSaved: getBoolPreference(HIDE_SAVED_PREF, true),
    beforeDate: getStringPreference(
      BEFORE_DATE_PREF,
      defaultFeedBeforeDate(new Date()),
    ),
  };
}

// The page and page size the feed last showed. Module state, not URL state: it
// is a scroll-like position, so it should survive leaving the feed and coming
// back within a session but not be part of a shared link. Anything that changes
// what the feed contains resets it (see reloadFeedFromStart).
let feedPage = 0;
let feedPageSize = DEFAULT_PAGE_SIZE;

// Re-renders the feed from its first page. Used by the filters and by Force
// refresh: both change what the feed holds, so the remembered page number
// belongs to the old contents and would land the user in the wrong place.
function reloadFeedFromStart(forceRefresh: boolean): void {
  feedPage = 0;
  showFeed(forceRefresh);
}

function showFeed(forceFirstLoad: boolean = false): void {
  const app = appContainer();
  if (!app) return;
  app.innerHTML = "";

  const toolbar = document.createElement("div");
  toolbar.className = "feed-toolbar";

  // Filters on the left; changing any of them re-renders the feed
  // (reloadFeedFromStart), which goes back to page 0 and loads with the new
  // state. A changed filter also changes the feed page cache's key, so the new
  // state always comes from the server. The loader reads each preference fresh
  // on every page request.
  const filters = document.createElement("div");
  filters.className = "feed-filters";
  filters.append(
    feedToggle("Hide Shorts", HIDE_SHORTS_PREF, true),
    // "watched" is the UI word for the seen flag (matching the History tab);
    // the preference key keeps its old name so stored settings survive.
    feedToggle("Hide watched", HIDE_VIEWED_PREF, false),
    feedToggle("Hide dismissed", HIDE_DISMISSED_PREF, true),
    // On by default: a saved video is already dealt with, so keeping it out
    // makes the feed an inbox of videos still waiting for a decision.
    feedToggle("Hide saved", HIDE_SAVED_PREF, true),
    beforeDateControl(),
  );

  // The cache refresh sits apart on the right: it force-fetches fresh RSS for
  // every channel (bypassing the 30-minute cache), unlike the filters. The
  // label keeps implementation words out; the tooltip explains the cache part.
  const refresh = document.createElement("button");
  refresh.type = "button";
  refresh.className = "refresh-button refresh-button--right";
  refresh.textContent = "↻ Force refresh";
  refresh.title =
    "Re-fetch every channel now instead of waiting out the 30-minute cache";
  refresh.addEventListener("click", (): void => reloadFeedFromStart(true));

  toolbar.append(filters, refresh);
  app.appendChild(toolbar);

  // Warns when some channels' RSS could not be fetched this load, so a partial
  // feed is never silently mistaken for "no new videos". Hidden until needed.
  const notice = document.createElement("div");
  notice.className = "feed-notice";
  notice.style.display = "none";
  app.appendChild(notice);

  // Built per render, not shared like the other screens': with "Hide saved" on,
  // saving a video is what drops it from the feed, so that is when the card
  // must dim. Flipping the toggle re-runs showFeed, which rebuilds these. One
  // shared local, so the two actions can never disagree on the value.
  const feedVanishesWhen: boolean | null = getBoolPreference(
    HIDE_SAVED_PREF,
    true,
  )
    ? true
    : null;
  const feedWatchLaterAction: VideoAction =
    makeWatchLaterToggle(feedVanishesWhen);
  const feedSeenAction: VideoAction = makeSeenAction(feedVanishesWhen);

  let pendingForce = forceFirstLoad;
  app.appendChild(
    PagedVideoListView(
      (page, pageSize) => {
        const forceRefresh = pendingForce;
        pendingForce = false;
        const options = feedPageOptions(page, pageSize, forceRefresh);
        // Normally reuse the page kept in memory: warmed in the background
        // while the user was on another screen, or shown earlier this session
        // (see feedPageCache.ts). Force refresh throws every kept page away
        // and fetches this one from the server.
        return forceRefresh
          ? forceReloadFeedPage(options)
          : loadFeedPage(options);
      },
      {
        onPlay: (index, queue): void =>
          playFromList(queue, index, { source: "feed" }),
        actions: [feedWatchLaterAction, feedSeenAction],
        cornerAction: dismissAction,
        onPageLoaded: (result): void => updateFeedNotice(notice, result),
        paging: {
          page: feedPage,
          pageSize: feedPageSize,
          onChange: (page, pageSize): void => {
            feedPage = page;
            feedPageSize = pageSize;
          },
        },
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
function feedToggle(
  labelText: string,
  prefKey: string,
  defaultValue: boolean,
): HTMLElement {
  const label = document.createElement("label");
  label.className = "feed-toggle";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = getBoolPreference(prefKey, defaultValue);
  checkbox.addEventListener("change", (): void => {
    setBoolPreference(prefKey, checkbox.checked);
    reloadFeedFromStart(false);
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
  input.value = getStringPreference(
    BEFORE_DATE_PREF,
    defaultFeedBeforeDate(new Date()),
  );
  input.addEventListener("change", (): void => {
    setStringPreference(BEFORE_DATE_PREF, input.value);
    reloadFeedFromStart(false);
  });
  label.append(document.createTextNode("Hide older than "), input);
  return label;
}

// "Hide watched" is intentionally absent here: the history list is entirely
// watched videos, so hiding them would empty it. The watched toggle un-marks the
// view (the card stays, un-dimmed, until the next load) and a second tap
// re-marks it.
function showHistory(): void {
  renderVideoScreen(getHistory(), () => ({
    onPlay: (index, queue): void =>
      playFromList(queue, index, { source: "history" }),
    actions: [watchLaterToggleAction, markSeenAction],
  }));
}

// Watch Later defaults to oldest upload first (the natural "watch the backlog"
// order); other playlists default to their YouTube order.
function showWatchLater(): void {
  renderPlaylistScreen(getWatchLaterVideos(), "oldest", () => ({
    onPlay: (index, queue): void =>
      playFromList(queue, index, { source: "watchlater" }),
    actions: [watchLaterRemoveAction, watchLaterSeenAction],
  }));
}

function showPlaylist(playlistId: string, title: string): void {
  renderPlaylistScreen(getPlaylistVideos(playlistId), "playlist", () => ({
    onPlay: (index, queue): void =>
      playFromList(queue, index, { source: "playlist", playlistId, title }),
    actions: [watchLaterToggleAction, markSeenAction],
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
          go({
            view: "playlist",
            playlistId: playlist.playlistId,
            title: playlist.title,
          }),
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
  optionsFor: () => {
    onPlay: (index: number, queue: Video[]) => void;
    actions: VideoAction[];
  },
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
  if (key === "newest")
    sorted.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  else if (key === "oldest")
    sorted.sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
  else sorted.sort((a, b) => a.title.localeCompare(b.title));
  return sorted;
}

// Like renderVideoScreen, but with a sort-order selector at the top. Re-sorting
// re-renders only the list. The player queue follows the displayed order.
function renderPlaylistScreen(
  load: Promise<Video[]>,
  defaultSort: SortKey,
  optionsFor: () => {
    onPlay: (index: number, queue: Video[]) => void;
    actions: VideoAction[];
  },
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
        listHost.appendChild(
          VideoListView(sortVideos(videos, currentSort), optionsFor()),
        );
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

function playFromList(
  queue: Video[],
  index: number,
  context: PlayerContext,
): void {
  const video = queue[index];
  if (!video) return;
  go({
    view: "player",
    videoId: video.videoId,
    label: labelForContext(context),
    context,
    queue,
    index,
  });
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
  if (
    activePlayer &&
    activePlayer.key === key &&
    activePlayer.controller.hasVideo(screen.videoId)
  ) {
    activePlayer.controller.goToVideo(screen.videoId);
    return;
  }
  const app = appContainer();
  if (!app) return;
  clearActivePlayer();
  app.innerHTML = "";
  const controller = PlayerView({
    queue,
    startIndex: Math.max(
      0,
      queue.findIndex((video) => video.videoId === screen.videoId),
    ),
    contextLabel: screen.label,
    onBack: (): void => go(screenForContext(screen.context)),
    // prev/next/autoplay request navigation; go() pushes one history entry per
    // video, then drives this same player via goToVideo above.
    onNavigate: (videoId, navIndex): void =>
      go({ ...screen, videoId, index: navIndex, queue }),
  });
  activePlayer = { controller, key };
  app.appendChild(controller.element);
}

// Identifies a player session: same source and same ordered queue. Back/forward
// to a video in this same queue updates the live player rather than remounting.
function playerQueueKey(context: PlayerContext, queue: Video[]): string {
  const base =
    context.source === "playlist"
      ? "playlist:" + context.playlistId
      : context.source;
  return base + "|" + queue.map((video) => video.videoId).join(",");
}

function clearActivePlayer(): void {
  if (activePlayer) {
    activePlayer.controller.destroy();
    activePlayer = null;
  }
}

function rebuildQueue(
  context: PlayerContext,
  videoId: string,
): Promise<Video[]> {
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
  return {
    videoId,
    title: "",
    channelId: "",
    channelTitle: "",
    thumbnailUrl: "",
    publishedAt: "",
    seen: false,
  };
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
  // Any screen but the feed warms the page the feed would open on — the one it
  // last showed, not always the first (the feed's own loader is the fetch
  // there). Fire-and-forget: it runs as its own parallel server call, so it
  // never delays the screen being rendered. It is a no-op when that page is
  // already held, and the server only refetches the channels whose RSS cache
  // expired — never a forced refresh.
  if (screen.view !== "feed")
    warmFeedPage(feedPageOptions(feedPage, feedPageSize, false));
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
      const params: UrlParams = {
        view: "player",
        v: screen.videoId,
        src: screen.context.source,
      };
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
      return {
        view: "player",
        videoId: params.v,
        label: labelForContext(context),
        context,
      };
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
        ? {
            source: "playlist",
            playlistId: params.pl,
            title: params.title ?? "",
          }
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
      return {
        view: "playlist",
        playlistId: context.playlistId,
        title: context.title,
      };
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
  document
    .querySelectorAll<HTMLButtonElement>(".app-nav button")
    .forEach((button): void => {
      button.classList.toggle("active", button.dataset.view === section);
    });
}

function setupNav(): void {
  document
    .querySelectorAll<HTMLButtonElement>(".app-nav button")
    .forEach((button): void => {
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
    const searchUrl =
      "https://www.youtube.com/results?search_query=" +
      encodeURIComponent(term);
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
// The footer's deploy stamp is static chrome — no bridge needed, and render()
// never touches it — so fill it once, the moment the bundle runs.
renderBuildStamp();

if (document.readyState === "complete") {
  start();
} else {
  appContainer()?.appendChild(skeletonGrid());
  window.addEventListener("load", (): void => start());
}
