// The player screen. Embeds the YouTube IFrame player with basic controls and
// no recommendation rabbit hole: when a video ends it shows a "next / back" card
// (or auto-advances if the toggle is on), so the YouTube end-screen never takes
// over. Reused by every screen that plays a list. Input is an ordered Video[]
// queue plus a start index. See PLAN.md section 13.
//
// The player is URL-driven: prev/next, autoplay, and the end card do NOT change
// the video directly. They call onNavigate, which the router turns into a history
// push; the router then drives playback via the returned controller's goToVideo.
// So every video is its own history entry, and back/forward update this same
// player in place (loadVideoById) instead of reloading the iframe.

import type { Video } from "../shared/video";
import type { VideoComment, CommentOrder } from "../shared/comment";
import type { Chapter } from "../shared/chapters";
import { parseChapters } from "../shared/chapters";
import type { SponsorSegment } from "../shared/sponsorBlock";
import type {
  CommunityTitleReason,
  DeArrowSubmissionsResult,
} from "../shared/dearrow";
import {
  sponsorCategoryLabel,
  sponsorSkipDecision,
} from "../shared/sponsorBlock";
import {
  getVideoDescription,
  getComments,
  getDeArrowSubmissions,
  getSponsorSegments,
  markVideoSeen,
  removeVideoSeen,
  saveVideoProgress,
} from "./serverBridge";
import {
  PROGRESS_FINISHED,
  progressToStore,
  shouldSuggestWatched,
} from "../shared/videoProgress";
import { watchLaterAfterSeenToggle } from "../shared/watchLaterAfterSeen";
import { dropStaleFeedPage } from "./feedPageCache";
import { getBoolPreference, setBoolPreference } from "./preferences";
import {
  THEATER_PREF,
  THEATER_DEFAULT,
  SPONSOR_SKIP_PREF,
  SPONSOR_SKIP_DEFAULT,
  readStoredPlaybackRate,
  storePlaybackRate,
} from "./playerPreferences";
import { optimistic } from "./optimistic";
import { showToast } from "./toast";
import { communityTitlesOn, displayTitle } from "./titlePreferences";
import { explainCommunityTitle, originalTitleHint } from "../shared/dearrow";
import {
  skeletonComments,
  skeletonDescription,
  skeletonInfoRows,
} from "./skeleton";
import { formatDate, formatDuration } from "./videoListView";

// How often the live position is checked against the segment list. The check
// is local getCurrentTime polling with no request, so it can be brisk; it has
// to be, because every polled millisecond is sponsor content the viewer still
// hears before the jump.
const SPONSOR_POLL_MS = 250;

// Sponsor-skip toggle icon: the classic "skip forward" (two arrows into a
// bar). One icon for both states — the button dims while the skip is off (see
// .player-sponsor in src/ui/index.html).
const ICON_SPONSOR_SKIP =
  '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5l8 7-8 7V5z"/><path d="M13 5l7 7-7 7V5z"/></svg>';

// Minimal typing for the YouTube IFrame Player API (loaded from youtube.com).
interface YouTubePlayerEvent {
  data: number;
}
interface YouTubePlayerReadyEvent {
  target: YouTubePlayer;
}
interface YouTubePlayerOptions {
  videoId: string;
  playerVars?: Record<string, number | string>;
  events?: {
    onReady?: (event: YouTubePlayerReadyEvent) => void;
    onStateChange?: (event: YouTubePlayerEvent) => void;
    /** Fires when the viewer picks a speed from YouTube's own controls; data is the new rate. */
    onPlaybackRateChange?: (event: YouTubePlayerEvent) => void;
  };
}
interface YouTubePlayer {
  loadVideoById(videoId: string, startSeconds?: number): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  /** Current playback position in seconds; polled to track the active chapter. */
  getCurrentTime(): number;
  /** Video length in seconds; 0 until the video's metadata loads. */
  getDuration(): number;
  /** Suggests a playback speed (1 = normal); clamped to the video's allowed rates. */
  setPlaybackRate(suggestedRate: number): void;
  destroy(): void;
}
interface YouTubeNamespace {
  Player: new (
    element: HTMLElement,
    options: YouTubePlayerOptions,
  ) => YouTubePlayer;
}
type PlayerTab = "description" | "comments" | "info";

// The Info tab's words for each outcome of the title policy.
const TITLE_REASON_TEXT: Record<CommunityTitleReason, string> = {
  locked: "a DeArrow moderator locked this title",
  "top-voted": "it has the most votes",
  "no-submissions": "nobody submitted a title",
  "locked-original": "a DeArrow moderator locked the YouTube title",
  "only-original": "every submission keeps the YouTube title",
  "all-downvoted": "every other title has negative votes",
};

const PLAYER_STATE_ENDED = 0;
const PLAYER_STATE_PAUSED = 2;

// Minimal typing for screen.orientation lock/unlock: lock() is implemented
// only by Chromium (and TypeScript's DOM lib no longer declares it), so type
// just the two members used and treat both as optional.
interface OrientationLocker {
  lock?: (mode: string) => Promise<void>;
  unlock?: () => void;
}

// How often the playing position is persisted for resume. Each save is an Apps
// Script round-trip against a daily PropertiesService quota, so it must not be
// too eager; but closing the tab can never be caught reliably from inside the
// Apps Script iframe, so the periodic save is what bounds how much progress a
// hard close loses.
const PROGRESS_SAVE_INTERVAL_MS = 20000;

// How often the live position is checked for the mark-watched nudge (the dot
// on the watched toggle once the video is effectively finished). Purely local
// getCurrentTime polling — no request — so it can be much brisker than the
// progress save; same pattern as the chapter tracking.
const NUDGE_POLL_MS = 1000;

// Theater-toggle icons. Enabling theater mode shows a monitor/TV ("big screen,
// not fullscreen"); exiting shows arrows pointing inward (shrink back to the
// centered column). Inline SVG so they stay crisp and unambiguous.
const ICON_ENTER_THEATER =
  '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/></svg>';
const ICON_EXIT_THEATER =
  '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 14h6v6"/><path d="M20 10h-6V4"/><path d="M14 10 21 3"/><path d="M3 21l7-7"/></svg>';

// Fullscreen icons: classic expand corners to enter; inward corners on the
// in-video exit overlay.
const ICON_ENTER_FULLSCREEN =
  '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/><path d="M8 21H5a2 2 0 0 1-2-2v-3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>';
const ICON_EXIT_FULLSCREEN =
  '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M16 3v3a2 2 0 0 0 2 2h3"/><path d="M8 21v-3a2 2 0 0 0-2-2H3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/></svg>';

export interface PlayerViewProps {
  queue: Video[];
  startIndex: number;
  contextLabel: string;
  onBack: () => void;
  /** Request navigation to another video in the queue (the router pushes history). */
  onNavigate: (videoId: string, index: number) => void;
}

// Handle the router holds onto a mounted player so it can drive it (back/forward,
// prev/next) without remounting the iframe.
export interface PlayerController {
  element: HTMLElement;
  hasVideo(videoId: string): boolean;
  /** Play a video already in the queue, without pushing history. */
  goToVideo(videoId: string): void;
  destroy(): void;
}

// The IFrame API script is loaded once for the whole app and shared by players.
let youTubeApiPromise: Promise<YouTubeNamespace> | null = null;

function loadYouTubeApi(): Promise<YouTubeNamespace> {
  if (youTubeApiPromise) return youTubeApiPromise;
  youTubeApiPromise = new Promise<YouTubeNamespace>((resolve) => {
    const win = window as unknown as {
      YT?: YouTubeNamespace;
      onYouTubeIframeAPIReady?: () => void;
    };
    if (win.YT && win.YT.Player) {
      resolve(win.YT);
      return;
    }
    win.onYouTubeIframeAPIReady = (): void =>
      resolve(win.YT as YouTubeNamespace);
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(script);
  });
  return youTubeApiPromise;
}

export function PlayerView(props: PlayerViewProps): PlayerController {
  const { queue, contextLabel, onBack, onNavigate } = props;
  let currentIndex = Math.max(0, Math.min(props.startIndex, queue.length - 1));
  let autoplayNext = false;
  let player: YouTubePlayer | null = null;

  // The remembered playback speed (see src/ui/playerPreferences.ts), applied to
  // every video when it loads, and updated whenever the viewer changes it from
  // YouTube's controls.
  let playbackRate = readStoredPlaybackRate();

  // Chapters parsed from the description (see src/shared/chapters.ts). The strip
  // between the video and description highlights the chapter playing now, dims the
  // ones already passed, and auto-scrolls to keep the current one at the left. The
  // YouTube API fires no time events, so we poll getCurrentTime on an interval.
  let chapters: Chapter[] = [];
  let chapterCards: HTMLButtonElement[] = [];
  let currentChapterIndex = -1;
  let chapterTimer: number | null = null;

  // Resume progress: the playing position is persisted server-side (per user,
  // so it syncs across devices) on an interval, on pause, on prev/next, and
  // when the player unmounts; a finished video stores the PROGRESS_FINISHED
  // marker (full bar on cards, restart on replay). What qualifies as a
  // resumable position is decided by progressToStore
  // (src/shared/videoProgress.ts). lastSavedProgress dedupes the periodic
  // saves so a paused player stops writing. nudgeTimer drives the
  // mark-watched dot from the live position (see watchedNudge).
  let progressTimer: number | null = null;
  let lastSavedProgress = 0;
  let nudgeTimer: number | null = null;

  // Sponsor skip: the current video's segments (empty until the lookup answers,
  // and empty forever for a video nobody submitted), the starts of the segments
  // the viewer undid with the toast, and the poll timer that watches the
  // position. sponsorSegmentsVideoId says which video the list belongs to, so a
  // late answer for the previous video can never skip inside this one.
  let sponsorSegments: SponsorSegment[] = [];
  let ignoredSponsorStarts: number[] = [];
  let sponsorTimer: number | null = null;
  let sponsorSegmentsVideoId = "";
  // The segment the last jump left behind. The player reports the old position
  // for a poll or two after a seek, so without this the same segment fires a
  // second jump and a second toast. Cleared as soon as a poll finds the
  // position outside every segment.
  let lastSkippedSponsorStart: number | null = null;
  // Set by destroy(). A sponsor lookup in flight when the viewer leaves the
  // player answers into a gone controller, and must not install a poll timer
  // that nothing can clear.
  let destroyed = false;

  // Comment paging/sorting state. The description and comments live in two tabs;
  // the comments tab is unloaded until it is selected. activeTab persists across
  // videos in this session so, once opened, later videos load their comments
  // automatically. commentsLoaded tracks whether the current video's first page
  // has been fetched.
  let commentsOrder: CommentOrder = "relevance";
  let commentsToken = "";
  let commentsVideoId = "";
  let commentsLoading = false;
  let activeTab: PlayerTab = "description";
  let commentsLoaded = false;

  // Info tab state. The tab asks the server only when it opens, so a player
  // that never opens it sends no extra request. null means "on the wire".
  // infoSegments is "failed" when the bridge call itself failed.
  let infoVideoId = "";
  let infoLoaded = false;
  let infoSubmissions: DeArrowSubmissionsResult | null = null;
  let infoSegments: SponsorSegment[] | "failed" | null = null;

  const root = document.createElement("div");
  root.className = "player-view";

  const position = document.createElement("span");
  position.className = "player-position";

  const seenButton = document.createElement("button");
  seenButton.type = "button";
  // Toggles seen, like the card buttons: flip immediately and roll back +
  // toast if the request fails. See src/ui/optimistic.ts.
  seenButton.addEventListener("click", (): void => {
    const video = queue[currentIndex];
    if (!video) return;
    const target = !video.seen;
    // Marking watched drops the video from Watch Later server-side; mirror it
    // on the in-memory queue like the card toggle does. The player un-marks
    // with removeVideoSeen, which never re-adds, so it passes
    // restoresWatchLater: false — only the Watch Later screen's card toggle
    // restores the entry (see toggleSeen in src/ui/main.ts). The mirror lives
    // INSIDE apply/revert: the player has no Watch Later button, but the Video
    // object is shared with the kept feed page (ADR 0008), so a failed call
    // must put membership back or the cards show a stale flag. `wasSaved` is
    // membership as of this tap, so the revert restores that; an earlier tap
    // that has not settled yet makes it that tap's assumed value.
    const wasSaved = Boolean(video.inWatchLater);
    const savedAtTarget = watchLaterAfterSeenToggle({
      seenTarget: target,
      wasSaved,
      restoresWatchLater: false,
    });
    optimistic({
      // Keyed on the video, not the button: one button serves the whole queue,
      // so a tap on the next video would otherwise supersede the previous
      // video's rollback and strand a stale flag on a shared Video (ADR 0008).
      key: video,
      apply: (): void => {
        video.seen = target;
        video.inWatchLater = savedAtTarget;
        updateSeenButton();
      },
      revert: (): void => {
        video.seen = !target;
        // A card one screen away can have changed membership since this tap
        // applied. Roll back only while the value this tap wrote still stands.
        // The same guard sits in toggleSeen in src/ui/main.ts, which states what
        // a value comparison cannot tell apart.
        if (Boolean(video.inWatchLater) === savedAtTarget) {
          video.inWatchLater = wasSaved;
        }
        updateSeenButton();
      },
      send: (): Promise<void> =>
        target ? markVideoSeen(video) : removeVideoSeen(video.videoId),
      failMessage: target
        ? "Couldn't mark as watched"
        : "Couldn't mark as not watched",
    });
  });

  // Sponsor-skip toggle. Turning it on mid-video loads the segments for the
  // video already playing, so the next sponsor part is skipped without a
  // reload.
  let sponsorSkip = getBoolPreference(SPONSOR_SKIP_PREF, SPONSOR_SKIP_DEFAULT);
  const sponsorButton = document.createElement("button");
  sponsorButton.type = "button";
  sponsorButton.className = "player-sponsor";
  sponsorButton.innerHTML = ICON_SPONSOR_SKIP;
  sponsorButton.addEventListener("click", (): void => {
    sponsorSkip = !sponsorSkip;
    setBoolPreference(SPONSOR_SKIP_PREF, sponsorSkip);
    updateSponsorButton();
    if (infoLoaded) renderInfo(); // the Info tab shows the auto-skip state
    if (!sponsorSkip) {
      // Forget the last jump too. Otherwise the viewer can turn the skip off
      // inside a segment, rewind, turn it back on, and never get the jump:
      // only a poll clears the memory, and the poll is stopped.
      lastSkippedSponsorStart = null;
      stopSponsorTracking();
      return;
    }
    const video = queue[currentIndex];
    if (video) void loadSponsorSegments(video.videoId);
  });

  // Theater mode toggle. Hidden on mobile (where the player is already
  // full-width) via CSS; the class on the root drives the layout change.
  let theaterMode = getBoolPreference(THEATER_PREF, THEATER_DEFAULT);
  const theaterButton = document.createElement("button");
  theaterButton.type = "button";
  theaterButton.className = "player-theater";
  theaterButton.addEventListener("click", (): void => {
    theaterMode = !theaterMode;
    setBoolPreference(THEATER_PREF, theaterMode);
    updateTheater();
  });

  const autoplayLabel = document.createElement("label");
  autoplayLabel.className = "player-autoplay";
  const autoplayCheckbox = document.createElement("input");
  autoplayCheckbox.type = "checkbox";
  autoplayCheckbox.addEventListener("change", (): void => {
    autoplayNext = autoplayCheckbox.checked;
  });
  autoplayLabel.append(
    autoplayCheckbox,
    document.createTextNode(" Autoplay next"),
  );

  // Fullscreen on mobile must rotate the video to landscape like the native
  // YouTube app, and the real API for that is unavailable here: the Apps
  // Script wrapper serves this page in a sandboxed iframe without the
  // allow-orientation-lock token, so screen.orientation.lock() rejects with
  // SecurityError for us AND for YouTube's own player code nested inside.
  // The workaround is a fake rotation in CSS: fullscreen a wrapper WE own
  // (frame) and rotate the inner container (rotor) 90deg while the screen is
  // portrait — see ".player-frame:fullscreen .player-rotor" in index.html.
  // The browser's UA stylesheet forces "transform: none !important" on the
  // fullscreen element itself, which is why the rotated element must be a
  // child and why YouTube's own fullscreen button (which fullscreens the
  // iframe directly) can never rotate: where our button is available the
  // YouTube one is hidden via the fs=0 playerVar.
  const frame = document.createElement("div");
  frame.className = "player-frame";
  const rotor = document.createElement("div");
  rotor.className = "player-rotor";
  const mount = document.createElement("div");
  rotor.appendChild(mount);
  frame.appendChild(rotor);

  // iPhone Safari has no element fullscreen at all; there the YouTube button
  // stays (fs=1) and plays fullscreen in the native iOS presentation, and the
  // custom controls are hidden — the same behavior as before this feature.
  const supportsElementFullscreen =
    typeof frame.requestFullscreen === "function";

  function toggleFullscreen(): void {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      frame.requestFullscreen().catch((): void => {});
    }
  }

  // Exit overlay inside the rotor, so it rotates with the video and sits at
  // the bottom-right of the landscape view (away from the embedded player's
  // top controls); the only always-visible way out on touch devices without a
  // hardware Esc key. Shown only while fullscreen (CSS).
  const fsExitButton = document.createElement("button");
  fsExitButton.type = "button";
  fsExitButton.className = "player-fs-exit";
  fsExitButton.innerHTML = ICON_EXIT_FULLSCREEN;
  fsExitButton.title = "Exit fullscreen";
  fsExitButton.setAttribute("aria-label", "Exit fullscreen");
  fsExitButton.addEventListener("click", toggleFullscreen);
  rotor.appendChild(fsExitButton);

  const fullscreenButton = document.createElement("button");
  fullscreenButton.type = "button";
  fullscreenButton.className = "player-fullscreen";
  fullscreenButton.innerHTML = ICON_ENTER_FULLSCREEN;
  fullscreenButton.title = "Fullscreen";
  fullscreenButton.setAttribute("aria-label", "Fullscreen");
  fullscreenButton.hidden = !supportsElementFullscreen;
  fullscreenButton.addEventListener("click", toggleFullscreen);

  // Also try the real thing on every fullscreen change: if Google ever adds
  // allow-orientation-lock to the wrapper's sandbox, the screen physically
  // rotates, the (orientation: portrait) media query stops matching, and the
  // CSS fake rotation steps aside on its own. Until then the lock call
  // rejects (SecurityError here; NotSupportedError on desktop; missing on
  // iOS) and is swallowed. Unlocking on exit hands rotation back to the
  // device setting.
  const onFullscreenChange = (): void => {
    const orientation = window.screen.orientation as unknown as
      OrientationLocker | undefined;
    if (!orientation) return;
    if (document.fullscreenElement) {
      if (typeof orientation.lock === "function") {
        orientation.lock("landscape").catch((): void => {});
      }
    } else if (typeof orientation.unlock === "function") {
      try {
        orientation.unlock();
      } catch {
        // never locked (or unsupported) — nothing to restore
      }
    }
  };
  document.addEventListener("fullscreenchange", onFullscreenChange);

  const title = document.createElement("h2");
  title.className = "player-title";

  // Title row: the video title on the left, with the watched toggle and the
  // theater toggle right-aligned beside it.
  const titleRow = document.createElement("div");
  titleRow.className = "player-title-row";
  const titleActions = document.createElement("div");
  titleActions.className = "player-title-actions";
  titleActions.append(
    seenButton,
    sponsorButton,
    fullscreenButton,
    theaterButton,
  );
  titleRow.append(title, titleActions);

  // Nav row: the context label / position sit next to the prev/next buttons,
  // with "Autoplay next" pushed to the right.
  const nav = document.createElement("div");
  nav.className = "player-nav";
  const prevButton = document.createElement("button");
  prevButton.type = "button";
  prevButton.textContent = "← Previous";
  prevButton.addEventListener("click", (): void =>
    requestNavigate(currentIndex - 1),
  );
  const nextButton = document.createElement("button");
  nextButton.type = "button";
  nextButton.textContent = "Next →";
  nextButton.addEventListener("click", (): void =>
    requestNavigate(currentIndex + 1),
  );
  // Keep prev/next together so they wrap as a single unit — either both stay on
  // the row or both move to the next line, never one above the other.
  const navButtons = document.createElement("div");
  navButtons.className = "player-nav-buttons";
  navButtons.append(prevButton, nextButton);
  nav.append(position, navButtons, autoplayLabel);

  // Chapter strip: a horizontally scrollable row of the description's chapters,
  // sitting above the tabs so it stays visible on both the Description and
  // Comments tabs — the chapter list is always highly relevant to playback.
  // Hidden unless the description actually has a chapter list.
  const chaptersSection = document.createElement("div");
  chaptersSection.className = "player-chapters";
  chaptersSection.hidden = true;
  const chaptersHeading = document.createElement("div");
  chaptersHeading.className = "player-chapters-heading";
  chaptersHeading.textContent = "Chapters";
  const chaptersTrack = document.createElement("div");
  chaptersTrack.className = "player-chapters-track";
  chaptersSection.append(chaptersHeading, chaptersTrack);

  // The description sits in its own card so it reads as a distinct block.
  const descCard = document.createElement("div");
  descCard.className = "player-card player-desc-card";
  const description = document.createElement("p");
  description.className = "player-desc";
  descCard.appendChild(description);

  // The description and comments live in two tabs so only one shows at a time.
  // The comments tab's body is loaded only when the tab is first selected, so
  // playing a video does not fetch comments unless wanted; activeTab persists
  // across videos in this player, so once Comments is opened later videos load
  // their comments automatically.
  const tabStrip = document.createElement("div");
  tabStrip.className = "player-tab-strip";
  tabStrip.setAttribute("role", "tablist");

  const descTab = document.createElement("button");
  descTab.type = "button";
  descTab.className = "player-tab";
  descTab.setAttribute("role", "tab");
  descTab.textContent = "Description";
  descTab.addEventListener("click", (): void => setActiveTab("description"));

  const commentsTab = document.createElement("button");
  commentsTab.type = "button";
  commentsTab.className = "player-tab";
  commentsTab.setAttribute("role", "tab");
  commentsTab.textContent = "Comments";
  commentsTab.addEventListener("click", (): void => setActiveTab("comments"));

  const infoTab = document.createElement("button");
  infoTab.type = "button";
  infoTab.className = "player-tab";
  infoTab.setAttribute("role", "tab");
  infoTab.textContent = "Info";
  infoTab.addEventListener("click", (): void => setActiveTab("info"));

  tabStrip.append(descTab, commentsTab, infoTab);

  // Description tab panel: holds the description card.
  const descPanel = document.createElement("div");
  descPanel.className = "player-tab-panel";
  descPanel.setAttribute("role", "tabpanel");
  descPanel.appendChild(descCard);

  // Comments tab panel: the sort order is part of this panel's contents (it
  // only applies to comments), sitting above the comment list.
  const commentsPanel = document.createElement("div");
  commentsPanel.className = "player-tab-panel player-card comments-card";
  commentsPanel.setAttribute("role", "tabpanel");

  const commentsControls = document.createElement("div");
  commentsControls.className = "comments-controls";

  const commentsSort = document.createElement("label");
  commentsSort.className = "comments-sort";
  const orderSelect = document.createElement("select");
  orderSelect.className = "sort-select";
  for (const option of [
    { value: "relevance", label: "Top" },
    { value: "time", label: "New" },
  ]) {
    const element = document.createElement("option");
    element.value = option.value;
    element.textContent = option.label;
    orderSelect.appendChild(element);
  }
  orderSelect.addEventListener("change", (): void => {
    commentsOrder = orderSelect.value as CommentOrder;
    if (commentsVideoId) loadComments(commentsVideoId);
  });
  commentsSort.append(document.createTextNode("Sort "), orderSelect);
  commentsControls.appendChild(commentsSort);

  const comments = document.createElement("div");
  comments.className = "player-comments";

  const showMoreButton = document.createElement("button");
  showMoreButton.type = "button";
  showMoreButton.className = "show-more";
  showMoreButton.textContent = "Show more comments";
  showMoreButton.hidden = true;
  showMoreButton.addEventListener("click", (): void => {
    if (commentsVideoId) void fetchCommentsPage(commentsVideoId, false);
  });

  commentsPanel.append(commentsControls, comments, showMoreButton);

  // Info tab panel: the facts, titles, and sponsor segments of the video. It
  // shows why a video keeps its YouTube title, because most videos have no
  // DeArrow title and the switch then seems broken.
  const infoPanel = document.createElement("div");
  infoPanel.className = "player-tab-panel player-card info-card";
  infoPanel.setAttribute("role", "tabpanel");

  const endCard = document.createElement("div");
  endCard.className = "player-end-card";
  endCard.hidden = true;

  root.append(
    frame,
    titleRow,
    nav,
    chaptersSection,
    tabStrip,
    descPanel,
    commentsPanel,
    infoPanel,
    endCard,
  );
  updateTabsUi();

  // Ask the router to navigate; it pushes history and calls goToVideo back.
  function requestNavigate(index: number): void {
    if (index < 0 || index >= queue.length) return;
    onNavigate(queue[index].videoId, index);
  }

  // Moves playback without touching the page. The sponsor skip uses this: the
  // viewer did not ask for the jump, so yanking the page to the top would be
  // wrong. Guarded like applyPlaybackRate because a poll can fire before the
  // player is ready.
  // Returns whether the seek ran, so the sponsor skip only commits its state
  // once the jump really happened.
  function seekSilently(seconds: number): boolean {
    if (!player) return false;
    try {
      player.seekTo(seconds, true);
      return true;
    } catch {
      return false; // player not ready yet
    }
  }

  // Seeks the current video to a timestamp (clicked in a comment or description)
  // and scrolls back up so the player is visible.
  function seek(seconds: number): void {
    seekSilently(seconds);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // Rebuild the chapter strip for a video (or hide it when there are none).
  function renderChapters(list: Chapter[]): void {
    stopChapterTracking();
    chapters = list;
    chapterCards = [];
    currentChapterIndex = -1;
    chaptersTrack.innerHTML = "";
    if (list.length === 0) {
      chaptersSection.hidden = true;
      return;
    }
    for (const chapter of list) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "chapter-card";
      const time = document.createElement("span");
      time.className = "chapter-time";
      time.textContent = chapter.timestampText;
      const label = document.createElement("span");
      label.className = "chapter-label";
      label.textContent = chapter.label;
      label.title = chapter.label;
      card.append(time, label);
      card.addEventListener("click", (): void => seek(chapter.seconds));
      chaptersTrack.appendChild(card);
      chapterCards.push(card);
    }
    chaptersSection.hidden = false;
    startChapterTracking();
  }

  function startChapterTracking(): void {
    stopChapterTracking();
    if (chapters.length === 0) return;
    chapterTimer = window.setInterval(updateCurrentChapter, 500);
    updateCurrentChapter();
  }

  function stopChapterTracking(): void {
    if (chapterTimer !== null) {
      window.clearInterval(chapterTimer);
      chapterTimer = null;
    }
  }

  // Finds the chapter that contains the current playback time (the last one whose
  // start is at or before now) and, when it changes, restyles and auto-scrolls.
  function updateCurrentChapter(): void {
    if (!player || chapters.length === 0) return;
    let now: number;
    try {
      now = player.getCurrentTime();
    } catch {
      return; // player not ready yet
    }
    if (typeof now !== "number" || Number.isNaN(now)) return;
    let index = -1;
    for (let i = 0; i < chapters.length; i++) {
      if (chapters[i].seconds <= now + 0.25) index = i;
      else break;
    }
    if (index === currentChapterIndex) return;
    currentChapterIndex = index;
    for (let i = 0; i < chapterCards.length; i++) {
      chapterCards[i].classList.toggle("current", i === index);
      chapterCards[i].classList.toggle("past", i < index);
    }
    const card = chapterCards[index];
    if (card) {
      // Keep the current chapter at the start of the track. The track scrolls
      // horizontally on narrow screens and vertically on wide ones, so scroll
      // both axes — the off-axis offset is roughly constant and is a no-op.
      chaptersTrack.scrollTo({
        left: Math.max(0, card.offsetLeft - 8),
        top: Math.max(0, card.offsetTop - 8),
        behavior: "smooth",
      });
    }
  }

  function updateChrome(): void {
    const video = queue[currentIndex];
    position.textContent = `${contextLabel} · ${currentIndex + 1} of ${queue.length}`;
    title.textContent = video ? displayTitle(video) : "";
    // Always written: the title element outlives each video in the queue.
    title.title = video ? originalTitleHint(video, title.textContent) : "";
    prevButton.disabled = currentIndex <= 0;
    nextButton.disabled = currentIndex >= queue.length - 1;
    updateSeenButton();
  }

  // "You should probably mark this watched": the stored position says the
  // video is effectively finished (the marker, kept when a finished video is
  // reopened — playback restarts at 0:00 but the store still says finished),
  // or the live playback position has crossed the same finished fraction.
  // The live check is what makes the nudge appear the moment the threshold
  // is crossed mid-watch, including on the end card.
  function watchedNudge(): boolean {
    const video = queue[currentIndex];
    if (!video || video.seen) return false;
    if (shouldSuggestWatched(video.progressSeconds, video.durationSeconds))
      return true;
    if (!player) return false;
    try {
      return shouldSuggestWatched(
        player.getCurrentTime(),
        player.getDuration(),
      );
    } catch {
      return false; // player not ready yet
    }
  }

  // Same copy and pressed-toggle treatment as the card buttons (reflectSeen in
  // src/ui/main.ts), so the one control looks identical everywhere — including
  // the mark-watched nudge dot. Re-run by nudgeTimer so the dot tracks live
  // playback; every write below is idempotent.
  function updateSeenButton(): void {
    const video = queue[currentIndex];
    const seen = Boolean(video && video.seen);
    const nudge = watchedNudge();
    seenButton.textContent = seen ? "✓ Watched" : "Mark watched";
    seenButton.classList.toggle("player-toggle--on", seen);
    seenButton.classList.toggle("toggle-nudge", nudge);
    seenButton.disabled = !video;
    seenButton.title = seen
      ? "Mark as not watched"
      : nudge
        ? "Mark as watched — you finished this video"
        : "Mark as watched";
    seenButton.setAttribute("aria-pressed", String(seen));
  }

  // Same pressed-toggle treatment as the theater button, and the title always
  // names what the next click does.
  function updateSponsorButton(): void {
    sponsorButton.classList.toggle("active", sponsorSkip);
    const label = sponsorSkip
      ? "Stop skipping sponsor segments"
      : "Skip sponsor segments";
    sponsorButton.title = label;
    sponsorButton.setAttribute("aria-label", label);
    sponsorButton.setAttribute("aria-pressed", String(sponsorSkip));
  }

  function updateTheater(): void {
    root.classList.toggle("player-view--theater", theaterMode);
    theaterButton.classList.toggle("active", theaterMode);
    theaterButton.innerHTML = theaterMode
      ? ICON_EXIT_THEATER
      : ICON_ENTER_THEATER;
    const label = theaterMode ? "Exit theater mode" : "Theater mode";
    theaterButton.title = label;
    theaterButton.setAttribute("aria-label", label);
    theaterButton.setAttribute("aria-pressed", String(theaterMode));
  }

  async function loadDescription(videoId: string): Promise<void> {
    description.replaceChildren(skeletonDescription());
    renderChapters([]); // clear any previous video's chapters while loading
    try {
      const text = await getVideoDescription(videoId);
      if (queue[currentIndex]?.videoId !== videoId) return; // video changed mid-load
      if (text) {
        appendTextWithTimestamps(description, text);
        renderChapters(parseChapters(text));
      } else {
        description.textContent = "(no description)";
      }
    } catch {
      description.textContent = "(could not load description)";
    }
  }

  function updateTabsUi(): void {
    const tabs: [PlayerTab, HTMLButtonElement, HTMLElement][] = [
      ["description", descTab, descPanel],
      ["comments", commentsTab, commentsPanel],
      ["info", infoTab, infoPanel],
    ];
    for (const [tab, button, panel] of tabs) {
      button.setAttribute("aria-selected", String(activeTab === tab));
      panel.hidden = activeTab !== tab;
    }
  }

  // Switches the visible tab. The comments and info bodies are fetched the
  // first time their tab is opened for the current video.
  function setActiveTab(tab: PlayerTab): void {
    activeTab = tab;
    updateTabsUi();
    if (tab === "comments" && commentsVideoId && !commentsLoaded)
      loadComments(commentsVideoId);
    if (tab === "info" && infoVideoId && !infoLoaded)
      void loadInfo(infoVideoId);
  }

  // Called on each video change: resets the info state and only fetches if the
  // Info tab is currently selected.
  function prepareInfo(videoId: string): void {
    infoVideoId = videoId;
    infoLoaded = false;
    infoSubmissions = null;
    infoSegments = null;
    infoPanel.replaceChildren();
    if (activeTab === "info") void loadInfo(videoId);
  }

  async function loadInfo(videoId: string): Promise<void> {
    infoLoaded = true;
    renderInfo();
    // Use the segments that the skip already has. Else ask here: with the
    // skip off, loadSponsorSegments asks for nothing, but the tab still shows
    // the segments.
    const segmentsRequest: Promise<SponsorSegment[] | "failed"> =
      sponsorSegmentsVideoId === videoId
        ? Promise.resolve(sponsorSegments)
        : getSponsorSegments(
            videoId,
            queue[currentIndex]?.durationSeconds,
          ).catch((): "failed" => "failed");
    const submissionsRequest: Promise<DeArrowSubmissionsResult> =
      getDeArrowSubmissions(videoId).catch((): DeArrowSubmissionsResult => ({
        status: "failed",
      }));
    const [segments, submissions] = await Promise.all([
      segmentsRequest,
      submissionsRequest,
    ]);
    if (destroyed) return; // the viewer left the player mid-load
    if (queue[currentIndex]?.videoId !== videoId) return; // video changed mid-load
    infoSegments = segments;
    infoSubmissions = submissions;
    renderInfo();
  }

  // Draws the Info tab from the current video and the loaded answers. DeArrow
  // text is crowd-submitted, so every value goes in through textContent.
  function renderInfo(): void {
    const video = queue[currentIndex];
    if (!video) {
      infoPanel.replaceChildren();
      return;
    }

    const progress = video.progressSeconds ?? 0;
    const resume =
      progress === PROGRESS_FINISHED
        ? "finished"
        : progress > 0
          ? formatDuration(progress)
          : "none";
    const videoSection = infoSection("Video", [
      ["Video id", video.videoId],
      [
        "Duration",
        video.durationSeconds
          ? formatDuration(video.durationSeconds)
          : "unknown",
      ],
      ["Published", formatDate(video.publishedAt) || "unknown"],
      ["Resume position", resume],
    ]);

    const titleSection = infoSection("Titles", [
      ["YouTube title", video.title],
      ["DeArrow title", video.communityTitle || "none"],
      ["Title on show", displayTitle(video)],
      ["DeArrow titles switch", communityTitlesOn() ? "on" : "off"],
    ]);
    titleSection.appendChild(infoHeading("DeArrow submissions", "h4"));
    if (infoSubmissions === null) {
      titleSection.appendChild(skeletonInfoRows());
    } else if (infoSubmissions.status === "failed") {
      titleSection.appendChild(infoNote("Could not load DeArrow submissions."));
    } else {
      const submissions = infoSubmissions.submissions;
      const choice = explainCommunityTitle(submissions);
      const blocks: HTMLElement[] = submissions.map(
        (submission, index): HTMLElement => {
          const facts = [
            submission.votes === null
              ? "votes unknown"
              : String(submission.votes) +
                (submission.votes === 1 ? " vote" : " votes"),
          ];
          if (submission.locked) facts.push("locked");
          if (submission.original) facts.push("YouTube title");
          if (index === choice.index) facts.push("chosen");
          return infoSubmission(submission.title, facts.join(" · "));
        },
      );
      if (blocks.length > 0) {
        const list = document.createElement("ul");
        list.className = "info-submissions";
        list.append(...blocks);
        titleSection.appendChild(list);
      }
      const outcome =
        choice.index >= 0
          ? "Chosen because " + TITLE_REASON_TEXT[choice.reason] + "."
          : "No DeArrow title, because " +
            TITLE_REASON_TEXT[choice.reason] +
            ".";
      titleSection.appendChild(infoNote(outcome));
    }

    const sponsorSection = infoSection("Sponsor segments", [
      ["Auto-skip", sponsorSkip ? "on" : "off"],
    ]);
    if (infoSegments === null) {
      sponsorSection.appendChild(skeletonInfoRows());
    } else if (infoSegments === "failed") {
      sponsorSection.appendChild(infoNote("Could not load sponsor segments."));
    } else if (infoSegments.length === 0) {
      sponsorSection.appendChild(infoNote("No sponsor segments."));
    } else {
      sponsorSection.appendChild(
        infoList(
          infoSegments.map((segment): [string, string] => [
            sponsorCategoryLabel(segment.category),
            formatDuration(segment.startSeconds) +
              " – " +
              formatDuration(segment.endSeconds),
          ]),
        ),
      );
    }

    infoPanel.replaceChildren(videoSection, titleSection, sponsorSection);
  }

  // Called on each video change: resets comment state and only fetches if the
  // Comments tab is currently selected.
  function prepareComments(videoId: string): void {
    commentsVideoId = videoId;
    commentsLoaded = false;
    commentsToken = "";
    comments.innerHTML = "";
    showMoreButton.hidden = true;
    if (activeTab === "comments") loadComments(videoId);
  }

  // Resets and loads the first page of comments for a video. Placeholder
  // comments fill the panel meanwhile so it keeps a realistic height —
  // switching to the Comments tab must not collapse the page to one line and
  // jump the scroll position.
  function loadComments(videoId: string): void {
    commentsVideoId = videoId;
    commentsLoaded = true;
    commentsToken = "";
    comments.replaceChildren(...skeletonComments(6));
    showMoreButton.hidden = true;
    void fetchCommentsPage(videoId, true);
  }

  async function fetchCommentsPage(
    videoId: string,
    first: boolean,
  ): Promise<void> {
    if (commentsLoading) return;
    commentsLoading = true;
    showMoreButton.disabled = true;
    // First page: loadComments already filled the panel with placeholders.
    // Paging in more: keep the loaded comments and append placeholders below.
    const placeholders = first ? [] : skeletonComments(3);
    comments.append(...placeholders);
    try {
      const page = await getComments(videoId, commentsOrder, commentsToken);
      if (commentsVideoId !== videoId) return; // a different video loaded meanwhile
      if (first) comments.innerHTML = "";
      if (first && page.comments.length === 0) {
        comments.textContent = "No comments.";
      }
      for (const placeholder of placeholders) placeholder.remove();
      for (const comment of page.comments)
        comments.appendChild(renderComment(comment));
      commentsToken = page.nextPageToken;
      showMoreButton.hidden = commentsToken === "";
    } catch (error) {
      if (commentsVideoId !== videoId) return;
      comments.textContent =
        "Could not load comments: " + (error as Error).message;
      showMoreButton.hidden = true;
    } finally {
      for (const placeholder of placeholders) placeholder.remove();
      commentsLoading = false;
      showMoreButton.disabled = false;
    }
  }

  function renderComment(comment: VideoComment): HTMLElement {
    const item = document.createElement("div");
    item.className = "comment";

    const avatar = document.createElement("img");
    avatar.className = "comment-avatar";
    avatar.src = comment.authorImageUrl;
    avatar.alt = "";
    avatar.loading = "lazy";

    const body = document.createElement("div");
    body.className = "comment-body";

    const head = document.createElement("div");
    head.className = "comment-head";
    const author = document.createElement("span");
    author.className = "comment-author";
    author.textContent = comment.author;
    const time = document.createElement("span");
    time.className = "comment-time";
    time.textContent = formatRelativeTime(comment.publishedAt);
    head.append(author, time);

    const text = document.createElement("div");
    text.className = "comment-text";
    appendTextWithTimestamps(text, comment.text);

    const meta = document.createElement("div");
    meta.className = "comment-meta";
    meta.textContent = "👍 " + formatCount(comment.likeCount);

    body.append(head, text, meta);
    item.append(avatar, body);
    return item;
  }

  // Fills an element with text, turning timestamps into buttons that seek and
  // URLs into links (both styled the same via `.ts-link`). A single pass over a
  // combined pattern keeps the two in document order; URLs match first so a
  // timestamp inside a URL is not double-matched.
  function appendTextWithTimestamps(
    container: HTMLElement,
    text: string,
  ): void {
    container.textContent = "";
    // Group 1: URL. Groups 2-4: an "M:SS" / "H:MM:SS" timestamp.
    const pattern = /(https?:\/\/\S+)|(\d{1,2}):([0-5]\d)(?::([0-5]\d))?/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const [whole, url, hoursOrMinutes, middle, maybeSeconds] = match;
      if (match.index > lastIndex) {
        container.appendChild(
          document.createTextNode(text.slice(lastIndex, match.index)),
        );
      }
      if (url !== undefined) {
        // Trailing punctuation is almost never part of the URL (e.g. a link at
        // the end of a sentence); split it back off as plain text.
        const trailing = url.match(/[.,;:!?)\]}'"]+$/);
        const href = trailing
          ? url.slice(0, url.length - trailing[0].length)
          : url;
        const link = document.createElement("a");
        link.className = "ts-link";
        link.href = href;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = href;
        container.appendChild(link);
        if (trailing)
          container.appendChild(document.createTextNode(trailing[0]));
      } else {
        const seconds =
          maybeSeconds !== undefined
            ? Number(hoursOrMinutes) * 3600 +
              Number(middle) * 60 +
              Number(maybeSeconds)
            : Number(hoursOrMinutes) * 60 + Number(middle);
        const link = document.createElement("button");
        link.type = "button";
        link.className = "ts-link";
        link.textContent = whole;
        link.addEventListener("click", (): void => seek(seconds));
        container.appendChild(link);
      }
      lastIndex = match.index + whole.length;
    }
    if (lastIndex < text.length) {
      container.appendChild(document.createTextNode(text.slice(lastIndex)));
    }
  }

  function showEndCard(): void {
    endCard.innerHTML = "";
    const hasNext = currentIndex < queue.length - 1;

    const message = document.createElement("span");
    message.textContent = hasNext ? "Video finished." : "End of the list.";
    endCard.appendChild(message);

    if (hasNext) {
      const playNext = document.createElement("button");
      playNext.type = "button";
      playNext.textContent = "Play next";
      playNext.addEventListener("click", (): void =>
        requestNavigate(currentIndex + 1),
      );
      endCard.appendChild(playNext);
    }

    const back = document.createElement("button");
    back.type = "button";
    back.textContent = "Back to list";
    back.addEventListener("click", (): void => onBack());
    endCard.appendChild(back);

    endCard.hidden = false;
  }

  // Persists the current video's playback position if it changed since the
  // last save. Fire-and-forget on purpose: this is background bookkeeping with
  // no UI state to flip, so a failed save is dropped silently (the position
  // simply stays where the last successful save left it) rather than routed
  // through optimistic() — there is nothing to apply or roll back.
  function saveProgress(): void {
    const video = queue[currentIndex];
    if (!video || !player) return;
    let seconds: number;
    try {
      seconds = progressToStore(player.getCurrentTime(), player.getDuration());
    } catch {
      return; // player not ready yet
    }
    if (seconds === lastSavedProgress) return;
    lastSavedProgress = seconds;
    // Keep the in-memory queue in sync so revisiting this video in-session
    // (back/forward, prev) resumes at the newest position, not the flagged
    // one. The finished marker is kept — it drives the card's full bar.
    video.progressSeconds = seconds !== 0 ? seconds : undefined;
    // The kept feed page holds progressSeconds like the other flags, so this
    // save goes through the same drop rule as an optimistic() write.
    dropStaleFeedPage();
    saveVideoProgress(video.videoId, seconds).catch((): void => {});
  }

  function startProgressSaving(): void {
    if (progressTimer !== null) return;
    progressTimer = window.setInterval(saveProgress, PROGRESS_SAVE_INTERVAL_MS);
  }

  function stopProgressSaving(): void {
    if (progressTimer !== null) {
      window.clearInterval(progressTimer);
      progressTimer = null;
    }
  }

  // Fetches the video's sponsor segments and starts the watch. Fire-and-forget
  // on purpose: playback already runs, and a slow or failed lookup must only
  // mean "skip nothing" (the server returns an empty list for every failure).
  async function loadSponsorSegments(videoId: string): Promise<void> {
    if (!sponsorSkip || destroyed) return;
    if (sponsorSegmentsVideoId === videoId) {
      startSponsorTracking(); // already looked up, empty list included
      return;
    }
    let segments: SponsorSegment[];
    try {
      segments = await getSponsorSegments(
        videoId,
        queue[currentIndex]?.durationSeconds,
      );
    } catch {
      return; // no segments: the video plays in full, as before this feature
    }
    if (destroyed) return; // the viewer left the player mid-load
    if (queue[currentIndex]?.videoId !== videoId) return; // video changed mid-load
    sponsorSegments = segments;
    sponsorSegmentsVideoId = videoId;
    startSponsorTracking();
  }

  // Jumps past the segment the position sits in, and offers one tap to take
  // the jump back: the data is community-submitted and sometimes wrong. Undo
  // returns to the segment start and drops that segment for the rest of this
  // video, so the same jump cannot happen twice.
  function checkSponsorSkip(): void {
    if (!sponsorSkip || !player || sponsorSegments.length === 0) return;
    let now: number;
    try {
      now = player.getCurrentTime();
    } catch {
      return; // player not ready yet
    }
    // A position the player cannot report is not a position outside every
    // segment, so return instead of clearing the last-jump guard below.
    if (typeof now !== "number" || Number.isNaN(now)) return;
    const decision = sponsorSkipDecision(
      sponsorSegments,
      now,
      ignoredSponsorStarts,
      lastSkippedSponsorStart,
    );
    const segment = decision.segment;
    if (!segment) {
      lastSkippedSponsorStart = decision.lastSkippedStartSeconds;
      return;
    }
    // Commit the memory and the toast only once the jump ran: a failed seek
    // leaves the viewer inside the sponsor, so the next poll must try again.
    if (!seekSilently(segment.endSeconds)) return;
    lastSkippedSponsorStart = decision.lastSkippedStartSeconds;
    const skipped = Math.round(segment.endSeconds - segment.startSeconds);
    const label = sponsorCategoryLabel(segment.category);
    showToast("Skipped " + label + " (" + String(skipped) + "s)", {
      label: "Undo",
      onAction: (): void => {
        ignoredSponsorStarts.push(segment.startSeconds);
        seekSilently(segment.startSeconds);
      },
    });
  }

  function startSponsorTracking(): void {
    if (sponsorTimer !== null || destroyed) return;
    if (!sponsorSkip || sponsorSegments.length === 0) return;
    sponsorTimer = window.setInterval(checkSponsorSkip, SPONSOR_POLL_MS);
    checkSponsorSkip();
  }

  function stopSponsorTracking(): void {
    if (sponsorTimer !== null) {
      window.clearInterval(sponsorTimer);
      sponsorTimer = null;
    }
  }

  function startNudgeTracking(): void {
    if (nudgeTimer !== null) return;
    nudgeTimer = window.setInterval(updateSeenButton, NUDGE_POLL_MS);
  }

  function stopNudgeTracking(): void {
    if (nudgeTimer !== null) {
      window.clearInterval(nudgeTimer);
      nudgeTimer = null;
    }
  }

  // Applies the remembered speed to the current video. Guarded because the
  // player throws if it is not ready yet; the rate persists across
  // loadVideoById on the same player, so this is belt-and-suspenders there.
  function applyPlaybackRate(): void {
    if (!player) return;
    try {
      player.setPlaybackRate(playbackRate);
    } catch {
      // player not ready yet
    }
  }

  // The viewer changed speed from YouTube's own controls: remember it (per
  // device) so the next video — and the next visit — starts at this rate.
  // event.data is the new rate; ignore anything nonsensical.
  function handlePlaybackRateChange(event: YouTubePlayerEvent): void {
    const rate = event.data;
    if (!Number.isFinite(rate) || rate <= 0) return;
    playbackRate = rate;
    storePlaybackRate(rate);
  }

  function handleStateChange(event: YouTubePlayerEvent): void {
    // Pausing is the best "the user may be leaving" signal available inside
    // the Apps Script iframe, so capture the position right away. Ending
    // saves too: progressToStore maps the final position to 0, clearing the
    // stored progress so a finished video restarts from the top.
    if (
      event.data === PLAYER_STATE_PAUSED ||
      event.data === PLAYER_STATE_ENDED
    ) {
      saveProgress();
    }
    if (event.data !== PLAYER_STATE_ENDED) return;
    if (autoplayNext && currentIndex < queue.length - 1) {
      requestNavigate(currentIndex + 1);
    } else {
      showEndCard();
    }
  }

  // Pure playback: load and show the video at index. Does not touch history.
  async function playAt(index: number): Promise<void> {
    if (index < 0 || index >= queue.length) return;
    saveProgress(); // capture the outgoing video's position before switching
    currentIndex = index;
    const video = queue[currentIndex];
    // Resume where a previous session (any device) left off. Only a real
    // position resumes: nothing stored or the finished marker (a full bar on
    // the card, but not a place to pick up from) start from the top.
    const stored = video.progressSeconds ?? 0;
    const resumeAt = stored > 0 ? stored : 0;
    lastSavedProgress = stored;
    endCard.hidden = true;
    updateChrome();
    void loadDescription(video.videoId);
    prepareComments(video.videoId);
    prepareInfo(video.videoId);
    // Each video starts from a clean sponsor state: the previous video's
    // segments and its undone jumps must never apply here.
    stopSponsorTracking();
    sponsorSegments = [];
    sponsorSegmentsVideoId = "";
    ignoredSponsorStarts = [];
    lastSkippedSponsorStart = null;
    void loadSponsorSegments(video.videoId);

    const api = await loadYouTubeApi();
    // The viewer left the player mid-load. destroy() already cleared every
    // timer, so a player built here would restart them with nothing left to
    // clear them, and the leaked interval keeps saving progress forever.
    if (destroyed) return;
    if (!player) {
      player = new api.Player(mount, {
        videoId: video.videoId,
        // fs: hide YouTube's fullscreen button when the custom one is shown —
        // it fullscreens the iframe directly, which can never fake-rotate
        // (see the frame/rotor comment above); keep it where element
        // fullscreen is unavailable (iPhone) so fullscreen stays possible.
        playerVars: {
          rel: 0,
          controls: 1,
          autoplay: 1,
          start: resumeAt,
          fs: supportsElementFullscreen ? 0 : 1,
        },
        events: {
          // Apply the remembered speed once the fresh player is ready.
          onReady: applyPlaybackRate,
          onStateChange: handleStateChange,
          onPlaybackRateChange: handlePlaybackRateChange,
        },
      });
    } else {
      player.loadVideoById(video.videoId, resumeAt);
      applyPlaybackRate();
    }
    startProgressSaving();
    startNudgeTracking();
  }

  updateSponsorButton();
  updateTheater();
  void playAt(currentIndex);

  return {
    element: root,
    hasVideo: (videoId: string): boolean =>
      queue.some((video) => video.videoId === videoId),
    goToVideo: (videoId: string): void => {
      const index = queue.findIndex((video) => video.videoId === videoId);
      if (index >= 0) void playAt(index);
    },
    destroy: (): void => {
      destroyed = true;
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      stopChapterTracking();
      stopProgressSaving();
      stopNudgeTracking();
      stopSponsorTracking();
      saveProgress(); // leaving the player is the last chance to capture it
      if (player) {
        player.destroy();
        player = null;
      }
    },
  };
}

// One Info tab section: a heading above label and value rows.
function infoSection(heading: string, rows: [string, string][]): HTMLElement {
  const section = document.createElement("section");
  section.className = "info-section";
  section.append(infoHeading(heading, "h3"), infoList(rows));
  return section;
}

function infoHeading(text: string, tag: "h3" | "h4"): HTMLElement {
  const heading = document.createElement(tag);
  heading.className = "info-heading";
  heading.textContent = text;
  return heading;
}

function infoList(rows: [string, string][]): HTMLElement {
  const list = document.createElement("dl");
  list.className = "info-list";
  for (const [label, value] of rows) {
    const term = document.createElement("dt");
    term.textContent = label;
    const detail = document.createElement("dd");
    detail.textContent = value;
    list.append(term, detail);
  }
  return list;
}

// One DeArrow submission: the title on its own line, the facts below it.
function infoSubmission(title: string, facts: string): HTMLElement {
  const item = document.createElement("li");
  const titleLine = document.createElement("div");
  titleLine.className = "info-submission-title";
  titleLine.textContent = title;
  const factsLine = document.createElement("div");
  factsLine.className = "info-submission-facts";
  factsLine.textContent = facts;
  item.append(titleLine, factsLine);
  return item;
}

function infoNote(text: string): HTMLElement {
  const note = document.createElement("p");
  note.className = "info-note";
  note.textContent = text;
  return note;
}

// Seconds-of-day relative time like "3 days ago". Falls back to a date string.
function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  try {
    const diffSeconds = Math.round((then - Date.now()) / 1000);
    const formatter = new Intl.RelativeTimeFormat(undefined, {
      numeric: "auto",
    });
    const units: [number, Intl.RelativeTimeFormatUnit][] = [
      [31557600, "year"],
      [2629800, "month"],
      [604800, "week"],
      [86400, "day"],
      [3600, "hour"],
      [60, "minute"],
      [1, "second"],
    ];
    for (const [secondsPerUnit, unit] of units) {
      if (Math.abs(diffSeconds) >= secondsPerUnit || unit === "second") {
        return formatter.format(Math.round(diffSeconds / secondsPerUnit), unit);
      }
    }
    return "";
  } catch {
    return new Date(iso).toLocaleDateString();
  }
}

// Compact like count: 1234 -> "1.2K", 1200000 -> "1.2M".
function formatCount(count: number): string {
  if (count >= 1000000)
    return (count / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
  if (count >= 1000) return (count / 1000).toFixed(1).replace(/\.0$/, "") + "K";
  return String(count);
}
