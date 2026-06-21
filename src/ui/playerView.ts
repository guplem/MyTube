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
import { getVideoDescription, getComments, markVideoSeen } from "./serverBridge";

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
  destroy(): void;
}
interface YouTubeNamespace {
  Player: new (element: HTMLElement, options: YouTubePlayerOptions) => YouTubePlayer;
}
const PLAYER_STATE_ENDED = 0;

// Matches "M:SS" and "H:MM:SS" timestamps in comment/description text.
const TIMESTAMP_PATTERN = /(\d{1,2}):([0-5]\d)(?::([0-5]\d))?/g;

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

  const bar = document.createElement("div");
  bar.className = "player-bar";

  const position = document.createElement("span");
  position.className = "player-position";

  const seenButton = document.createElement("button");
  seenButton.type = "button";
  seenButton.addEventListener("click", (): void => {
    const video = queue[currentIndex];
    if (!video || video.seen) return;
    void markVideoSeen(video)
      .then((): void => {
        video.seen = true;
        updateSeenButton();
      })
      .catch((): void => {
        // Leave the button as-is so the user can retry.
      });
  });

  const autoplayLabel = document.createElement("label");
  autoplayLabel.className = "player-autoplay";
  const autoplayCheckbox = document.createElement("input");
  autoplayCheckbox.type = "checkbox";
  autoplayCheckbox.addEventListener("change", (): void => {
    autoplayNext = autoplayCheckbox.checked;
  });
  autoplayLabel.append(autoplayCheckbox, document.createTextNode(" Autoplay next"));

  bar.append(position, seenButton, autoplayLabel);

  const frame = document.createElement("div");
  frame.className = "player-frame";
  const mount = document.createElement("div");
  frame.appendChild(mount);

  const title = document.createElement("h2");
  title.className = "player-title";

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
  nav.append(prevButton, nextButton);

  const description = document.createElement("p");
  description.className = "player-desc";

  // Collapsible comments: a toggle header plus a body that is only loaded when
  // first expanded, so playing a video does not fetch comments unless wanted.
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
    { value: "relevance", label: "Top comments" },
    { value: "time", label: "Newest first" },
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

  commentsBody.append(commentsSort, comments, showMoreButton);
  updateCommentsUi();

  const endCard = document.createElement("div");
  endCard.className = "player-end-card";
  endCard.hidden = true;

  root.append(bar, frame, title, nav, description, commentsToggle, commentsBody, endCard);

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

  async function loadDescription(videoId: string): Promise<void> {
    description.textContent = "Loading description…";
    try {
      const text = await getVideoDescription(videoId);
      if (queue[currentIndex]?.videoId !== videoId) return; // video changed mid-load
      if (text) appendTextWithTimestamps(description, text);
      else description.textContent = "(no description)";
    } catch {
      description.textContent = "(could not load description)";
    }
  }

  function updateCommentsUi(): void {
    commentsToggle.textContent = commentsExpanded ? "▾ Comments" : "▸ Comments";
    commentsBody.hidden = !commentsExpanded;
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

  // Fills an element with text, turning timestamps into buttons that seek.
  function appendTextWithTimestamps(container: HTMLElement, text: string): void {
    container.textContent = "";
    TIMESTAMP_PATTERN.lastIndex = 0;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = TIMESTAMP_PATTERN.exec(text)) !== null) {
      const [whole, hoursOrMinutes, middle, maybeSeconds] = match;
      if (match.index > lastIndex) {
        container.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
      }
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

  void playAt(currentIndex);

  return {
    element: root,
    hasVideo: (videoId: string): boolean => queue.some((video) => video.videoId === videoId),
    goToVideo: (videoId: string): void => {
      const index = queue.findIndex((video) => video.videoId === videoId);
      if (index >= 0) void playAt(index);
    },
    destroy: (): void => {
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
