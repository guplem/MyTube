// Browser entry point. App state (which tab, which video) lives in the browser
// URL via urlState, so back/forward and shareable links work. Navigation flows
// through go()/render(): go() renders a screen AND pushes it to history; render()
// only draws it (used by the back/forward handler and the first load). Every list
// screen is the shared VideoListView; every video plays through PlayerView.

import type { Video } from "../shared/video";
import type { FeedPageOptions } from "../shared/feed";
import { defaultFeedBeforeDate } from "../shared/feed";
import { shouldSuggestWatched } from "../shared/videoProgress";
import { watchLaterAfterSeenToggle } from "../shared/watchLaterAfterSeen";
import { pickDisplayTitle } from "../shared/dearrow";
import { countLabel } from "../shared/countLabel";
import { shuffled } from "../shared/shuffle";
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
  loadFeedPage,
  forceReloadFeedPage,
  setFeedMutationScreen,
  isKeptFeedPage,
  dropFeedPage,
} from "./feedPageCache";
import {
  trackFeedLoad,
  recordLoadedFeedTotal,
  applyFeedNavState,
} from "./feedNavButton";
import {
  HIDE_SHORTS_PREF,
  HIDE_SAVED_PREF,
  BEFORE_DATE_PREF,
  HIDE_SHORTS_DEFAULT,
  HIDE_SAVED_DEFAULT,
  feedFlagFilters,
} from "./feedFilters";
import { feedFilterControls } from "./feedFilterControls";
import { SettingsView } from "./settingsView";
import { PlaylistsView } from "./playlistsView";
import type { PlaylistSummary } from "../shared/playlist";
import { renderBuildStamp } from "./buildStamp";
import { renderSponsorBlockCredit } from "./sponsorBlockCredit";
import {
  skeletonPlaylistList,
  skeletonPlayerView,
  skeletonSortToolbar,
} from "./skeleton";
import { PlayerView, type PlayerController } from "./playerView";
import { optimistic } from "./optimistic";
import { keepListSnapshot, readListSnapshot } from "./listSnapshots";
import { createListUpdatePill } from "./listUpdatePill";
import {
  feedSnapshotKey,
  freshListMovesNothing,
  newVideoCount,
  watchLaterSnapshotVideos,
} from "../shared/listSnapshot";
import { showToast } from "./toast";
import { installLongPressHints } from "./longPressHint";
import { communityTitlesOn } from "./titlePreferences";
import { getBoolPreference, getStringPreference } from "./preferences";
import {
  pushUrlState,
  replaceUrlState,
  onUrlStateChange,
  readInitialParams,
  type UrlParams,
} from "./urlState";

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
  | { view: "settings" }
  | PlayerScreen;

// Which nav tab a screen belongs to (for highlighting the active button). A
// screen can belong to none: Settings opens from the footer, so no tab owns it
// and none must light up while it shows.
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
//
// `set` is told which phase it runs in, instead of comparing its value with the
// target. The seen toggle mirrors a SECOND flag (Watch Later membership) whose
// revert value is not the opposite of the seen target, so it must know a
// rollback from a first application without re-deriving the target itself.
function optimisticToggle(
  button: HTMLButtonElement,
  get: () => boolean,
  set: (value: boolean, isRevert: boolean) => void,
  send: (next: boolean) => Promise<void>,
  failMessage: (next: boolean) => string,
): void {
  const target = !get();
  optimistic({
    key: button,
    apply: (): void => set(target, false),
    revert: (): void => set(!target, true),
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
      if (!video.inWatchLater && !video.dismissed) {
        offerDismissAfterWatchLaterRemoval(video, button);
      }
    },
  };
}

// The toast a Watch Later removal shows, from a card or from the player. It
// offers the dismiss and never applies it.
function offerDismissAfterWatchLaterRemoval(
  video: Video,
  button: HTMLButtonElement,
): void {
  showToast("Removed from Watch Later", {
    label: "Dismiss from feed",
    onAction: (): void => dismissAfterWatchLaterRemoval(video, button),
  });
}

// The rollback key of a dismiss made from the toast, one token per video. The
// player's seen toggle already keys on the video itself, and only the latest
// tap on a key owns its rollback, so sharing the video would let a dismiss
// take a failed seen tap's rollback away (and the reverse).
const dismissKeys: WeakMap<Video, object> = new WeakMap();
function dismissKeyFor(video: Video): object {
  let key: object | undefined = dismissKeys.get(video);
  if (!key) {
    key = {};
    dismissKeys.set(video, key);
  }
  return key;
}

// The action of the toast that a Watch Later removal shows: a video the user
// is done with often should not come back in the feed either. The toast
// outlives its card (or the player). Once that button is gone, the user is on
// another screen, and the router would judge this write by that screen, not by
// the one that owns this Video object, so drop the kept feed page outright.
function dismissAfterWatchLaterRemoval(
  video: Video,
  button: HTMLButtonElement,
): void {
  if (video.dismissed) return;
  if (!button.isConnected) dropFeedPage();
  // On the feed the card has a dismiss corner: go through it, so the corner
  // reflects the new state and shares its rollback key with a tap on it.
  const corner: HTMLButtonElement | null =
    button
      .closest(".video-card")
      ?.querySelector<HTMLButtonElement>(".video-card-corner") ?? null;
  if (corner) {
    toggleDismiss(video, corner);
    return;
  }
  optimistic({
    key: dismissKeyFor(video),
    apply: (): void => {
      video.dismissed = true;
    },
    revert: (): void => {
      if (video.dismissed) video.dismissed = false;
    },
    send: (): Promise<void> => markVideoDismissed(video.videoId),
    failMessage: "Couldn't dismiss video",
  });
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

// The un-toggle half of the watched button, which differs by screen. The default
// just removes the view; the Watch Later screen passes undoMarkVideoSeen, which
// also restores the playlist entry. Everywhere else un-marking never re-adds the
// video.
interface SeenUndo {
  /** The server call that un-marks the video. */
  unmark: (videoId: string) => Promise<void>;
  /** True when `unmark` also restores the Watch Later entry. */
  restoresWatchLater: boolean;
}

const DEFAULT_SEEN_UNDO: SeenUndo = {
  unmark: removeVideoSeen,
  restoresWatchLater: false,
};

// Repaints the Watch Later toggle sitting in the same action row as the watched
// button, after toggleSeen has mirrored membership on the Video. The button is
// found by its data-action tag (set from VideoAction.name), never by label text,
// so relabeling can't silently break this sync. `vanishesWhen` is the caller
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

// Toggles a video in/out of the watch history. The card stays in place and only
// its seen styling changes; flips the state immediately and rolls back if the
// request fails.
//
// Marking watched also drops the video from Watch Later server-side, so the
// membership flag moves in the SAME `set` callback as the seen flag. That is
// what makes the rollback whole: optimisticToggle calls `set` again with
// isRevert, so a failed call puts the seen flag back, and membership too while
// the value this tap wrote still stands (see the guard below). `wasSaved` is
// membership as of this tap, so the revert restores that instead of assuming the
// opposite of the seen target; an earlier tap that has not settled yet makes it
// that tap's assumed value. The Video object is shared with the kept feed page
// (ADR 0008), so a stale flag here leaks to every other screen holding the same
// instance.
function toggleSeen(
  video: Video,
  button: HTMLButtonElement,
  vanishesWhen: boolean | null,
  undo: SeenUndo,
): void {
  // optimisticToggle derives the same target from video.seen through `get`.
  // The two agree because both run in the same tick, before any await.
  const target = !video.seen;
  const wasSaved = Boolean(video.inWatchLater);
  const savedAtTarget = watchLaterAfterSeenToggle({
    seenTarget: target,
    wasSaved,
    restoresWatchLater: undo.restoresWatchLater,
  });
  optimisticToggle(
    button,
    (): boolean => video.seen,
    (value, isRevert): void => {
      video.seen = value;
      reflectSeen(video, button);
      if (!isRevert) {
        video.inWatchLater = savedAtTarget;
      } else if (Boolean(video.inWatchLater) === savedAtTarget) {
        // The Watch Later toggle is a different button with its own dedup key,
        // so the user can have changed membership after this tap applied. Roll
        // back only while the value this tap wrote still stands: a newer,
        // successful decision must survive this failure.
        //
        // The guard compares the VALUE, not who wrote it. A newer decision that
        // lands back on the same value reads as "my write still stands", so this
        // revert overwrites it and the last write wins. Example: an add and a
        // remove, both while the mark is in flight, return membership to the
        // value apply wrote. A revision counter would fix it, and costs more
        // than the rare triple tap it saves.
        video.inWatchLater = wasSaved;
      }
      syncWatchLaterButtons(video, button, vanishesWhen);
    },
    (next): Promise<void> =>
      next ? markVideoSeen(video) : undo.unmark(video.videoId),
    (next): string =>
      next ? "Couldn't mark as watched" : "Couldn't mark as not watched",
  );
}

// The watched toggle, shared by every list. It is a factory because marking
// watched also un-saves the video, so the membership button next to it has to
// be re-reflected with THIS screen's `vanishesWhen` — the same value its
// Watch Later toggle uses. `undo` is the screen's un-toggle half: the server
// call that un-marks the video, and whether that call restores Watch Later.
function makeSeenAction(
  vanishesWhen: boolean | null,
  undo: SeenUndo = DEFAULT_SEEN_UNDO,
): VideoAction {
  return {
    name: "seen",
    reflect: reflectSeen,
    onClick: (video, button): void =>
      toggleSeen(video, button, vanishesWhen, undo),
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
const watchLaterSeenAction: VideoAction = makeSeenAction(false, {
  unmark: undoMarkVideoSeen,
  restoresWatchLater: true,
});

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

// Bumped by every render(). A screen that paints after an `await` captures it
// first and paints nothing once it changed, because the user has navigated on.
// Two things break otherwise. The obvious one: a slow list paints over the
// screen the user actually asked for (an Apps Script call takes seconds, so
// leaving Watch Later mid-load is normal). The quiet one: render() already told
// feedPageCache which screen a mutation belongs to, so a toggle on that
// painted-over list would be judged as a toggle on the NEW screen — a kept feed
// page spared for a mutation made on another list's Video copies (ADR 0008).
let navigationGeneration = 0;

/** Captured before an async screen starts loading; true once render() has moved
 *  on to another screen and this one must not paint. */
function navigationMovedOn(): () => boolean {
  const generation = navigationGeneration;
  return (): boolean => generation !== navigationGeneration;
}

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
    hideShorts: getBoolPreference(HIDE_SHORTS_PREF, HIDE_SHORTS_DEFAULT),
    // The same three filters the Feed nav button recounts with, read from one
    // place so the request and the recount can never disagree.
    ...feedFlagFilters(),
    beforeDate: getStringPreference(
      BEFORE_DATE_PREF,
      defaultFeedBeforeDate(new Date()),
    ),
  };
}

// The page and page size the feed last showed. Module state, not URL state: it
// is a scroll-like position, so it should survive leaving the feed and coming
// back within a session but not be part of a shared link. Anything that changes
// what the feed contains resets it: feedFilterChanged on every filter change,
// and reloadFeedFromStart on Force refresh.
let feedPage = 0;
let feedPageSize = DEFAULT_PAGE_SIZE;

// Re-renders the feed from its first page. Used by Force refresh, which changes
// what the feed holds, so the remembered page number belongs to the old contents
// and would land the user in the wrong place.
function reloadFeedFromStart(forceRefresh: boolean): void {
  feedPage = 0;
  showFeed(forceRefresh, false);
}

// The one path for "a feed filter changed", used by the feed toolbar AND by the
// Settings screen, which writes the very same preference keys. Two writers with
// two update paths is how the kept feed page (ADR 0008) and the Feed nav button
// go stale, so both come through here.
//
// Off the feed there is nothing to re-render: the warm-up fetches the page under
// the new filters, which replaces the kept page and corrects the nav button.
function feedFilterChanged(): void {
  // Page 0 either way: the remembered page number belongs to the old filters.
  feedPage = 0;
  if (currentView === "feed") {
    // No saved copy: it shows the list under the old filters.
    showFeed(false, false);
    return;
  }
  warmFeedPageSoon();
}

// The off-feed warm-up, delayed. On Settings the user often flips several
// toggles in a row, and every flip changes the cache key, so each one would
// start its own getFeedPage and the earlier answers would be thrown away
// (start() in src/shared/pageCache.ts hands the single slot to the newest call).
// One timer collapses the run into a single request. The feed branch is NOT
// delayed: there the user watches the list reload and must see it start at once.
let warmFeedTimer: number | null = null;
const WARM_FEED_DELAY_MS = 400;

function warmFeedPageSoon(): void {
  if (warmFeedTimer !== null) clearTimeout(warmFeedTimer);
  warmFeedTimer = window.setTimeout((): void => {
    warmFeedTimer = null;
    warmFeedPage();
  }, WARM_FEED_DELAY_MS);
}

// allowPreview shows the saved copy of the first page while the page loads
// (ADR 0011). Off for a changed filter and for Force refresh: the copy shows
// the list the user just asked to change.
function showFeed(
  forceFirstLoad: boolean = false,
  allowPreview: boolean = true,
): void {
  const app = appContainer();
  if (!app) return;
  app.innerHTML = "";
  const preview =
    allowPreview && feedPage === 0
      ? readListSnapshot(
          "feed",
          feedSnapshotKey(feedPageOptions(0, feedPageSize, false)),
        )
      : null;

  const toolbar = document.createElement("div");
  toolbar.className = "feed-toolbar";

  // Filters on the left; a change to any of them calls feedFilterChanged, which
  // goes back to page 0 and, on the feed branch, re-renders the feed with the
  // new state. A changed filter also changes the feed page cache's key, so the
  // new state always comes from the server. The loader reads each preference
  // fresh on every page request.
  const filters = document.createElement("div");
  filters.className = "feed-filters";
  filters.append(...feedFilterControls(feedFilterChanged));

  toolbar.append(filters);
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
    HIDE_SAVED_DEFAULT,
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
        return trackFeedLoad(
          forceRefresh ? forceReloadFeedPage(options) : loadFeedPage(options),
        );
      },
      {
        onPlay: (index, queue): void =>
          playFromList(queue, index, { source: "feed" }),
        actions: [feedWatchLaterAction, feedSeenAction],
        cornerAction: dismissAction,
        preview: preview ?? undefined,
        onPageLoaded: (result): void => {
          updateFeedNotice(notice, result);
          recordLoadedFeedTotal(result.total);
        },
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

  // Force refresh sits at the very end, after the pager: it is the last
  // resort when the feed looks stale, not a filter. It fetches fresh RSS for
  // every channel (skipping the 30-minute cache). The label keeps
  // implementation words out; the title, also shown on a long press
  // (src/ui/longPressHint.ts), explains the cache part.
  const refresh: HTMLButtonElement = document.createElement("button");
  refresh.type = "button";
  refresh.className = "refresh-button";
  refresh.textContent = "↻ Force refresh";
  refresh.title =
    "Fetch every channel from YouTube again now. Without this, the feed " +
    "reuses what it fetched in the last 30 minutes. Goes back to page 1.";
  refresh.addEventListener("click", (): void => reloadFeedFromStart(true));
  const footer: HTMLElement = document.createElement("div");
  footer.className = "feed-footer";
  footer.appendChild(refresh);
  app.appendChild(footer);
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
// The app lands on Watch Later, so an empty list on the first screen means
// nothing to watch there: open the feed instead. Only the landing redirects. A
// tap on the Watch Later tab still shows the empty list, or the tab would seem
// broken. The URL is replaced, not pushed, so Back never returns to the empty
// list.
function showWatchLater(redirectIfEmpty: boolean): void {
  const movedOn = navigationMovedOn();
  const preview = readListSnapshot("watchlater", WATCH_LATER_SNAPSHOT_KEY);
  const load: Promise<Video[]> = getWatchLaterVideos().then(
    (videos): Video[] => {
      // The fresh list is the truth, so save it whatever is on screen. The
      // copy then follows every tap on these same objects.
      keepListSnapshot("watchlater", WATCH_LATER_SNAPSHOT_KEY, () => {
        const kept: Video[] = watchLaterSnapshotVideos(videos);
        return { videos: kept, total: kept.length };
      });
      if (redirectIfEmpty && videos.length === 0 && !movedOn()) {
        const feed: Screen = { view: "feed" };
        replaceUrlState(feed, paramsFor(feed));
        // render() moves the navigation on, so the Watch Later paint below
        // returns early.
        render(feed);
      }
      return videos;
    },
  );
  renderPlaylistScreen(
    load,
    "oldest",
    () => ({
      onPlay: (index, queue): void =>
        playFromList(queue, index, { source: "watchlater" }),
      actions: [watchLaterRemoveAction, watchLaterSeenAction],
    }),
    preview
      ? { videos: preview.videos, retry: (): void => showWatchLater(false) }
      : null,
  );
}

const WATCH_LATER_SNAPSHOT_KEY = "watchlater";

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
  const movedOn = navigationMovedOn();
  app.innerHTML = "";
  app.appendChild(skeletonPlaylistList());
  getPlaylists()
    .then((playlists): void => {
      if (movedOn()) return;
      app.innerHTML = "";
      if (playlists.length === 0) {
        app.textContent = "You have no playlists.";
        return;
      }
      app.appendChild(
        PlaylistsView(playlists, (playlist: PlaylistSummary): void =>
          go({
            view: "playlist",
            playlistId: playlist.playlistId,
            title: playlist.title,
          }),
        ),
      );
    })
    .catch((error: Error): void => {
      if (movedOn()) return;
      app.textContent = `Could not load your playlists: ${error.message}`;
    });
}

// Every preference in one place (src/ui/settingsView.ts). It reads only
// the local preference copy, which answers at once, so it paints synchronously: there is no
// load to await and so no navigationMovedOn() guard to keep.
function showSettings(): void {
  const app = appContainer();
  if (!app) return;
  app.innerHTML = "";
  app.appendChild(SettingsView(feedFilterChanged));
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
  const movedOn = navigationMovedOn();
  app.innerHTML = "";
  app.appendChild(skeletonGrid());
  load
    .then((videos): void => {
      if (movedOn()) return;
      app.innerHTML = "";
      app.appendChild(VideoListView(videos, optionsFor()));
    })
    .catch((error: Error): void => {
      if (movedOn()) return;
      app.textContent = `Could not load this list: ${error.message}`;
    });
}

// Icons of the Play all and Shuffle buttons on playlist screens.
const ICON_PLAY_ALL: string =
  '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true"><path d="M7 4l13 8-13 8z"/></svg>';
const ICON_SHUFFLE: string =
  '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg>';

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
  // Sort by the title on show, so "A–Z" matches what the cards read. Read the
  // preference once: a comparator runs thousands of times on a long playlist.
  else {
    const useCommunity: boolean = communityTitlesOn();
    sorted.sort((a: Video, b: Video): number =>
      pickDisplayTitle(a, useCommunity).localeCompare(
        pickDisplayTitle(b, useCommunity),
      ),
    );
  }
  return sorted;
}

// Like renderVideoScreen, but with a sort-order selector at the top. Re-sorting
// re-renders only the list. The player queue follows the displayed order.
//
// With a preview (a saved copy, ADR 0011) the screen shows the copy at once,
// its toggles off, and loads the fresh list behind it. The fresh list replaces
// the copy when that moves no card; otherwise the pill offers it.
function renderPlaylistScreen(
  load: Promise<Video[]>,
  defaultSort: SortKey,
  optionsFor: () => {
    onPlay: (index: number, queue: Video[]) => void;
    actions: VideoAction[];
  },
  preview: { videos: Video[]; retry: () => void } | null = null,
): void {
  const host = appContainer();
  if (!host) return;
  const app: HTMLElement = host;
  const movedOn = navigationMovedOn();
  app.innerHTML = "";
  let currentSort = defaultSort;
  let videos: Video[] = [];
  let inert = false;
  let built = false;

  const pill = createListUpdatePill();
  const toolbar = document.createElement("div");
  toolbar.className = "feed-toolbar";
  const label = document.createElement("label");
  label.className = "toggle-label";
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

  // Play all and Shuffle, to the right of Sort. Play all follows the order on
  // show; Shuffle plays the whole list in a random order. The shuffled queue
  // is not in the URL, so a reload of the player goes back to list order.
  const playAll: HTMLButtonElement = document.createElement("button");
  playAll.type = "button";
  playAll.className = "list-play list-play--primary";
  playAll.innerHTML = ICON_PLAY_ALL + "<span>Play all</span>";
  playAll.title = "Play every video, in the order on show";
  playAll.addEventListener("click", (): void => {
    optionsFor().onPlay(0, sortVideos(videos, currentSort));
  });
  const shuffle: HTMLButtonElement = document.createElement("button");
  shuffle.type = "button";
  shuffle.className = "list-play";
  shuffle.innerHTML = ICON_SHUFFLE + "<span>Shuffle</span>";
  shuffle.title = "Play every video, in a random order";
  shuffle.addEventListener("click", (): void => {
    optionsFor().onPlay(0, shuffled(videos));
  });
  const playGroup: HTMLElement = document.createElement("div");
  playGroup.className = "list-play-group";
  playGroup.append(playAll, shuffle);
  toolbar.append(label, playGroup);
  const listHost = document.createElement("div");

  function renderList(): void {
    listHost.innerHTML = "";
    listHost.appendChild(
      VideoListView(sortVideos(videos, currentSort), {
        ...optionsFor(),
        inert,
      }),
    );
  }

  select.addEventListener("change", (): void => {
    currentSort = select.value as SortKey;
    renderList();
  });

  function paint(list: Video[], asPreview: boolean): void {
    videos = list;
    inert = asPreview;
    // A saved copy keeps its toggles off (ADR 0011), and so do these: its
    // order can change when the fresh list lands.
    playAll.disabled = inert || list.length === 0;
    shuffle.disabled = inert || list.length === 0;
    if (!built) {
      app.innerHTML = "";
      app.append(toolbar, pill.element, listHost);
      built = true;
    }
    renderList();
  }

  // See the same flag in src/ui/videoListView.ts: a load that answers before
  // the preview paints replaces it without asking.
  let previewPainted = false;
  if (preview && preview.videos.length > 0) {
    paint(preview.videos, true);
    pill.showUpdating();
    window.requestAnimationFrame((): void => {
      previewPainted = true;
    });
  } else {
    // The placeholder mirrors the loaded layout (sort toolbar + grid) so the
    // cards don't shift down when the real toolbar appears.
    app.append(skeletonSortToolbar(), skeletonGrid());
  }
  load
    .then((fresh): void => {
      if (movedOn()) return;
      if (preview && previewPainted) {
        const shownIds: string[] = sortVideos(preview.videos, currentSort).map(
          (video: Video): string => video.videoId,
        );
        const freshIds: string[] = sortVideos(fresh, currentSort).map(
          (video: Video): string => video.videoId,
        );
        // The copy keeps its paging off, so only its first page is on show.
        if (!freshListMovesNothing(shownIds, freshIds, DEFAULT_PAGE_SIZE)) {
          const added: number = newVideoCount(shownIds, freshIds);
          pill.showReady(
            added > 0
              ? countLabel(added, "new video", "new videos")
              : "This list changed",
            (): void => {
              if (!movedOn()) paint(fresh, false);
            },
          );
          return;
        }
      }
      pill.hide();
      paint(fresh, false);
    })
    .catch((error: Error): void => {
      if (movedOn()) return;
      if (preview && built) {
        // Keep the saved copy on screen: it beats an error in its place.
        pill.showFailed((): void => {
          if (!movedOn()) preview.retry();
        });
        return;
      }
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
  // No in-memory queue (shared link or forward navigation): rebuild it. Tear the
  // old player down BEFORE its DOM is replaced below, for the same reason
  // render() does it first: destroy() saves the playback position, and that
  // write belongs to the player going away. Leaving it mounted would also keep
  // its 20-second save interval running until showPlayer finally lands.
  clearActivePlayer();
  const movedOn = navigationMovedOn();
  const app = appContainer();
  if (app) app.replaceChildren(skeletonPlayerView());
  rebuildQueue(screen.context, screen.videoId)
    .then((queue): void => {
      if (movedOn()) return;
      showPlayer(screen, queue);
    })
    .catch((): void => {
      if (movedOn()) return;
      showPlayer(screen, [minimalVideo(screen.videoId)]);
    });
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
    recordPlayerScreen(screen, queue);
    activePlayer.controller.goToVideo(screen.videoId);
    return;
  }
  const app = appContainer();
  if (!app) return;
  clearActivePlayer();
  recordPlayerScreen(screen, queue);
  app.innerHTML = "";
  const controller = PlayerView({
    queue,
    startIndex: Math.max(
      0,
      queue.findIndex((video) => video.videoId === screen.videoId),
    ),
    contextLabel: screen.label,
    onBack: (): void => go(screenForContext(screen.context)),
    onWatchLaterRemoved: offerDismissAfterWatchLaterRemoval,
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

// Tells the feed page cache which screen a mutation would be made on. Always
// called AFTER clearActivePlayer(): tearing a player down saves its playback
// position, and that write belongs to the player going away, not to the screen
// coming in.
//
// The cache answers the identity question (isKeptFeedPage), never a flag we set
// when the feed handed the queue over: the kept page can be replaced while this
// player is still holding the old array, and a remembered flag would then spare
// a page the mutation no longer touches.
function recordPlayerScreen(screen: PlayerScreen, queue: Video[]): void {
  setFeedMutationScreen({
    inFeedSection: sectionOf(screen) === "feed",
    isPlayer: true,
    playerQueueIsFeedPage: isKeptFeedPage(queue),
  });
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

// The screen on show right now. Read by feedFilterChanged, which must know
// whether the feed is the screen to re-render or the screen to warm up.
let currentView: Screen["view"] = DEFAULT_SCREEN.view;

// False until the first render(), so a screen can tell the app's landing from
// a later visit.
let hasRendered = false;

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
  // Retires every screen still loading: from here on their paint is dropped.
  navigationGeneration += 1;
  currentView = screen.view;
  const isLanding: boolean = !hasRendered;
  hasRendered = true;
  // Leaving the player: tear down the YouTube iframe so it stops playing. This
  // runs FIRST, before the incoming screen is recorded below and before the
  // warm-up, because destroy() saves the playback position: that mutation
  // belongs to the player going away, and it may drop the kept feed page.
  if (screen.view !== "player") clearActivePlayer();
  const section = sectionOf(screen);
  setActiveNav(section);
  // The Feed button's dimmed/badge look is painted next to its active look, in
  // one place. The first render is what puts the dim on screen; later renders
  // repaint the same state.
  applyFeedNavState();
  // A player records its own screen in showPlayer(), which knows whether its
  // queue is the kept feed page's own array.
  if (screen.view !== "player")
    setFeedMutationScreen({
      inFeedSection: section === "feed",
      isPlayer: false,
      playerQueueIsFeedPage: false,
    });
  // Any screen but the feed warms the page the feed would open on.
  if (screen.view !== "feed") warmFeedPage();
  switch (screen.view) {
    case "watchlater":
      showWatchLater(isLanding);
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
    case "settings":
      showSettings();
      break;
    case "player":
      renderPlayer(screen);
      break;
    default:
      showFeed();
  }
}

// Warms the page the feed would open on — the one it last showed, not always
// the first (the feed's own loader is the fetch there). Fire-and-forget: it runs
// as its own parallel server call, so it never delays the screen being rendered.
// It costs no server call when that page is already held, and the server only
// refetches the channels whose RSS cache expired — never a forced refresh. Its
// result is what clears the Feed button's dim before the user ever opens the
// feed. Every non-feed render() calls it, and so does a feed filter changed from
// the Settings screen, whose new filters make a new page the one to hold.
function warmFeedPage(): void {
  trackFeedLoad(loadFeedPage(feedPageOptions(feedPage, feedPageSize, false)))
    .then((page): void => recordLoadedFeedTotal(page.total))
    // A failed load leaves the button not-loaded: trackFeedLoad ends the pulse,
    // and the still dim is the truth. Catching after the then, not as its
    // second argument, so a throw from the repaint is caught too.
    .catch((): void => undefined);
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
    case "settings":
      return { view: "settings" };
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

// Null for a screen that no nav tab owns, so no tab lights up while it shows.
function sectionOf(screen: Screen): Section | null {
  switch (screen.view) {
    case "settings":
      return null;
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

function setActiveNav(section: Section | null): void {
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

// Settings opens from the footer, which is static chrome outside #app. The app
// is one page, so a plain link would never reach the router. Route the click the
// way a nav button routes its own.
function setupSettingsLink(): void {
  document
    .getElementById("settings-link")
    ?.addEventListener("click", (): void => go({ view: "settings" }));
}

// The search box redirects to YouTube's results page (PLAN.md section 4); we do
// not run in-app search, which would cost 100 quota units per query.
function setupSearch(): void {
  const form = document.querySelector<HTMLFormElement>(".app-search");
  const input = form?.querySelector<HTMLInputElement>("input");
  // Phone only (CSS shows the toggle there): the header keeps the field
  // behind an icon, and opening it moves the focus straight into the field.
  const header: HTMLElement | null =
    document.querySelector<HTMLElement>(".app-header");
  const toggle: HTMLButtonElement | null =
    document.querySelector<HTMLButtonElement>(".app-search-toggle");
  toggle?.addEventListener("click", (): void => {
    const open: boolean = !header?.classList.contains(
      "app-header--search-open",
    );
    header?.classList.toggle("app-header--search-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    if (open) input?.focus();
  });
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
  setupSettingsLink();
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
renderSponsorBlockCredit();

// iOS Safari applies :active on touch only while some touchstart listener
// exists. The stylesheet's press feedback lives in :active, so this empty
// listener switches it on. Passive, so it never delays scrolling.
document.addEventListener("touchstart", (): void => {}, { passive: true });
installLongPressHints();

if (document.readyState === "complete") {
  start();
} else {
  appContainer()?.appendChild(skeletonGrid());
  window.addEventListener("load", (): void => start());
}
