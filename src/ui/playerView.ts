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
import { getVideoDescription, getComments, markVideoSeen } from "./serverBridge";
import { getBoolPreference, setBoolPreference } from "./preferences";
import { optimistic } from "./optimistic";

// Theater mode (desktop): the player breaks out of the centered column and
// fills the window. Persisted so it stays on across videos and visits.
const THEATER_PREF = "mytube.player.theater";

// Minimal typing for the YouTube IFrame Player API (loaded from youtube.com).
interface YouTubePlayerEvent {
  data: number;
}
interface YouTubePlayerOptions {
  videoId: string;
  playerVars?: Record<string, number | string>;
  events?: { onStateChange?: (event: YouTubePlayerEvent) => void };
}
interface YouTubePlayer {
  loadVideoById(videoId: string): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  /** Current playback position in seconds; polled to track the active chapter. */
  getCurrentTime(): number;
  destroy(): void;
}
interface YouTubeNamespace {
  Player: new (element: HTMLElement, options: YouTubePlayerOptions) => YouTubePlayer;
}
const PLAYER_STATE_ENDED = 0;

// Theater-toggle icons. Enabling theater mode shows a monitor/TV ("big screen,
// not fullscreen"); exiting shows arrows pointing inward (shrink back to the
// centered column). Inline SVG so they stay crisp and unambiguous.
const ICON_ENTER_THEATER =
  '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/></svg>';
const ICON_EXIT_THEATER =
  '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 14h6v6"/><path d="M20 10h-6V4"/><path d="M14 10 21 3"/><path d="M3 21l7-7"/></svg>';

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
    win.onYouTubeIframeAPIReady = (): void => resolve(win.YT as YouTubeNamespace);
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

  // Chapters parsed from the description (see src/shared/chapters.ts). The strip
  // between the video and description highlights the chapter playing now, dims the
  // ones already passed, and auto-scrolls to keep the current one at the left. The
  // YouTube API fires no time events, so we poll getCurrentTime on an interval.
  let chapters: Chapter[] = [];
  let chapterCards: HTMLButtonElement[] = [];
  let currentChapterIndex = -1;
  let chapterTimer: number | null = null;

  // Comment paging/sorting state. Comments are collapsed and unloaded until the
  // user expands the section; commentsExpanded persists across videos in this
  // session so, once opened, later videos load their comments automatically.
  let commentsOrder: CommentOrder = "relevance";
  let commentsToken = "";
  let commentsVideoId = "";
  let commentsLoading = false;
  let commentsExpanded = false;
  let commentsLoaded = false;

  const root = document.createElement("div");
  root.className = "player-view";

  const position = document.createElement("span");
  position.className = "player-position";

  const seenButton = document.createElement("button");
  seenButton.type = "button";
  // Optimistic, like the card buttons: flip to "Seen ✓" immediately and roll
  // back + toast if the request fails. See src/ui/optimistic.ts.
  seenButton.addEventListener("click", (): void => {
    const video = queue[currentIndex];
    if (!video || video.seen) return;
    optimistic({
      key: seenButton,
      apply: (): void => {
        video.seen = true;
        updateSeenButton();
      },
      revert: (): void => {
        video.seen = false;
        updateSeenButton();
      },
      send: (): Promise<void> => markVideoSeen(video),
      failMessage: "Couldn't mark as seen",
    });
  });

  // Theater mode toggle. Hidden on mobile (where the player is already
  // full-width) via CSS; the class on the root drives the layout change.
  let theaterMode = getBoolPreference(THEATER_PREF, false);
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
  autoplayLabel.append(autoplayCheckbox, document.createTextNode(" Autoplay next"));

  const frame = document.createElement("div");
  frame.className = "player-frame";
  const mount = document.createElement("div");
  frame.appendChild(mount);

  const title = document.createElement("h2");
  title.className = "player-title";

  // Title row: the video title on the left, with "Mark as seen" and the
  // theater toggle right-aligned beside it.
  const titleRow = document.createElement("div");
  titleRow.className = "player-title-row";
  const titleActions = document.createElement("div");
  titleActions.className = "player-title-actions";
  titleActions.append(seenButton, theaterButton);
  titleRow.append(title, titleActions);

  // Nav row: the context label / position sit next to the prev/next buttons,
  // with "Autoplay next" pushed to the right.
  const nav = document.createElement("div");
  nav.className = "player-nav";
  const prevButton = document.createElement("button");
  prevButton.type = "button";
  prevButton.textContent = "← Previous";
  prevButton.addEventListener("click", (): void => requestNavigate(currentIndex - 1));
  const nextButton = document.createElement("button");
  nextButton.type = "button";
  nextButton.textContent = "Next →";
  nextButton.addEventListener("click", (): void => requestNavigate(currentIndex + 1));
  // Keep prev/next together so they wrap as a single unit — either both stay on
  // the row or both move to the next line, never one above the other.
  const navButtons = document.createElement("div");
  navButtons.className = "player-nav-buttons";
  navButtons.append(prevButton, nextButton);
  nav.append(position, navButtons, autoplayLabel);

  // Chapter strip: a horizontally scrollable row of the description's chapters,
  // sitting between the video and the description. Hidden unless the description
  // actually has a chapter list.
  const chaptersSection = document.createElement("div");
  chaptersSection.className = "player-chapters";
  chaptersSection.hidden = true;
  const chaptersHeading = document.createElement("div");
  chaptersHeading.className = "player-chapters-heading";
  chaptersHeading.textContent = "Chapters";
  const chaptersTrack = document.createElement("div");
  chaptersTrack.className = "player-chapters-track";
  chaptersSection.append(chaptersHeading, chaptersTrack);

  // The description sits in its own card so it reads as a distinct block from
  // the comments below it.
  const descCard = document.createElement("div");
  descCard.className = "player-card player-desc-card";
  const description = document.createElement("p");
  description.className = "player-desc";
  descCard.appendChild(description);

  // Collapsible comments, wrapped in a matching card. The header row holds the
  // toggle on the left and the sort control right-aligned beside the title; the
  // body is only loaded when first expanded, so playing a video does not fetch
  // comments unless wanted.
  const commentsCard = document.createElement("div");
  commentsCard.className = "player-card comments-card";

  const commentsHeader = document.createElement("div");
  commentsHeader.className = "comments-header";

  const commentsToggle = document.createElement("button");
  commentsToggle.type = "button";
  commentsToggle.className = "comments-toggle";
  commentsToggle.addEventListener("click", (): void => {
    commentsExpanded = !commentsExpanded;
    updateCommentsUi();
    if (commentsExpanded && commentsVideoId && !commentsLoaded) loadComments(commentsVideoId);
  });

  const commentsBody = document.createElement("div");
  commentsBody.className = "comments-body";

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
  commentsHeader.append(commentsToggle, commentsSort);

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

  commentsBody.append(comments, showMoreButton);
  commentsCard.append(commentsHeader, commentsBody);
  updateCommentsUi();

  const endCard = document.createElement("div");
  endCard.className = "player-end-card";
  endCard.hidden = true;

  // Description and chapters share a row on wide screens (description left,
  // chapters right); they stack on narrow screens. See `.player-info` in the
  // stylesheet.
  const info = document.createElement("div");
  info.className = "player-info";
  info.append(descCard, chaptersSection);

  root.append(frame, titleRow, nav, info, commentsCard, endCard);

  // Ask the router to navigate; it pushes history and calls goToVideo back.
  function requestNavigate(index: number): void {
    if (index < 0 || index >= queue.length) return;
    onNavigate(queue[index].videoId, index);
  }

  // Seeks the current video to a timestamp (clicked in a comment or description)
  // and scrolls back up so the player is visible.
  function seek(seconds: number): void {
    if (player) player.seekTo(seconds, true);
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
      // Without chapters there is no right-hand column, so let the description
      // reclaim the full width (see `.player-info--has-chapters`).
      info.classList.remove("player-info--has-chapters");
      return;
    }
    info.classList.add("player-info--has-chapters");
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
    title.textContent = video ? video.title : "";
    prevButton.disabled = currentIndex <= 0;
    nextButton.disabled = currentIndex >= queue.length - 1;
    updateSeenButton();
  }

  function updateSeenButton(): void {
    const video = queue[currentIndex];
    const seen = Boolean(video && video.seen);
    seenButton.textContent = seen ? "Seen ✓" : "Mark as seen";
    seenButton.disabled = seen;
  }

  function updateTheater(): void {
    root.classList.toggle("player-view--theater", theaterMode);
    theaterButton.classList.toggle("active", theaterMode);
    theaterButton.innerHTML = theaterMode ? ICON_EXIT_THEATER : ICON_ENTER_THEATER;
    const label = theaterMode ? "Exit theater mode" : "Theater mode";
    theaterButton.title = label;
    theaterButton.setAttribute("aria-label", label);
    theaterButton.setAttribute("aria-pressed", String(theaterMode));
  }

  async function loadDescription(videoId: string): Promise<void> {
    description.textContent = "Loading description…";
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

  function updateCommentsUi(): void {
    commentsToggle.textContent = commentsExpanded ? "▾ Comments" : "▸ Comments";
    commentsBody.hidden = !commentsExpanded;
    // The sort control only makes sense once the comments are showing.
    commentsSort.hidden = !commentsExpanded;
  }

  // Called on each video change: resets comment state and only fetches if the
  // section is currently expanded.
  function prepareComments(videoId: string): void {
    commentsVideoId = videoId;
    commentsLoaded = false;
    commentsToken = "";
    comments.innerHTML = "";
    showMoreButton.hidden = true;
    if (commentsExpanded) loadComments(videoId);
  }

  // Resets and loads the first page of comments for a video.
  function loadComments(videoId: string): void {
    commentsVideoId = videoId;
    commentsLoaded = true;
    commentsToken = "";
    comments.innerHTML = "";
    comments.textContent = "Loading comments…";
    showMoreButton.hidden = true;
    void fetchCommentsPage(videoId, true);
  }

  async function fetchCommentsPage(videoId: string, first: boolean): Promise<void> {
    if (commentsLoading) return;
    commentsLoading = true;
    showMoreButton.disabled = true;
    try {
      const page = await getComments(videoId, commentsOrder, commentsToken);
      if (commentsVideoId !== videoId) return; // a different video loaded meanwhile
      if (first) comments.innerHTML = "";
      if (first && page.comments.length === 0) {
        comments.textContent = "No comments.";
      }
      for (const comment of page.comments) comments.appendChild(renderComment(comment));
      commentsToken = page.nextPageToken;
      showMoreButton.hidden = commentsToken === "";
    } catch (error) {
      if (commentsVideoId !== videoId) return;
      comments.textContent = "Could not load comments: " + (error as Error).message;
      showMoreButton.hidden = true;
    } finally {
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
  function appendTextWithTimestamps(container: HTMLElement, text: string): void {
    container.textContent = "";
    // Group 1: URL. Groups 2-4: an "M:SS" / "H:MM:SS" timestamp.
    const pattern = /(https?:\/\/\S+)|(\d{1,2}):([0-5]\d)(?::([0-5]\d))?/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const [whole, url, hoursOrMinutes, middle, maybeSeconds] = match;
      if (match.index > lastIndex) {
        container.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
      }
      if (url !== undefined) {
        // Trailing punctuation is almost never part of the URL (e.g. a link at
        // the end of a sentence); split it back off as plain text.
        const trailing = url.match(/[.,;:!?)\]}'"]+$/);
        const href = trailing ? url.slice(0, url.length - trailing[0].length) : url;
        const link = document.createElement("a");
        link.className = "ts-link";
        link.href = href;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = href;
        container.appendChild(link);
        if (trailing) container.appendChild(document.createTextNode(trailing[0]));
      } else {
        const seconds =
          maybeSeconds !== undefined
            ? Number(hoursOrMinutes) * 3600 + Number(middle) * 60 + Number(maybeSeconds)
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
      playNext.addEventListener("click", (): void => requestNavigate(currentIndex + 1));
      endCard.appendChild(playNext);
    }

    const back = document.createElement("button");
    back.type = "button";
    back.textContent = "Back to list";
    back.addEventListener("click", (): void => onBack());
    endCard.appendChild(back);

    endCard.hidden = false;
  }

  function handleStateChange(event: YouTubePlayerEvent): void {
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
    currentIndex = index;
    const video = queue[currentIndex];
    endCard.hidden = true;
    updateChrome();
    void loadDescription(video.videoId);
    prepareComments(video.videoId);

    const api = await loadYouTubeApi();
    if (!player) {
      player = new api.Player(mount, {
        videoId: video.videoId,
        playerVars: { rel: 0, controls: 1, autoplay: 1 },
        events: { onStateChange: handleStateChange },
      });
    } else {
      player.loadVideoById(video.videoId);
    }
  }

  updateTheater();
  void playAt(currentIndex);

  return {
    element: root,
    hasVideo: (videoId: string): boolean => queue.some((video) => video.videoId === videoId),
    goToVideo: (videoId: string): void => {
      const index = queue.findIndex((video) => video.videoId === videoId);
      if (index >= 0) void playAt(index);
    },
    destroy: (): void => {
      stopChapterTracking();
      if (player) {
        player.destroy();
        player = null;
      }
    },
  };
}

// Seconds-of-day relative time like "3 days ago". Falls back to a date string.
function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  try {
    const diffSeconds = Math.round((then - Date.now()) / 1000);
    const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
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
  if (count >= 1000000) return (count / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
  if (count >= 1000) return (count / 1000).toFixed(1).replace(/\.0$/, "") + "K";
  return String(count);
}
