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
import type { VideoComment } from "../shared/comment";
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
  destroy(): void;
}
interface YouTubeNamespace {
  Player: new (element: HTMLElement, options: YouTubePlayerOptions) => YouTubePlayer;
}
const PLAYER_STATE_ENDED = 0;

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

  const root = document.createElement("div");
  root.className = "player-view";

  const bar = document.createElement("div");
  bar.className = "player-bar";

  const backButton = document.createElement("button");
  backButton.type = "button";
  backButton.textContent = "← Back";
  backButton.addEventListener("click", (): void => onBack());

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

  bar.append(backButton, position, seenButton, autoplayLabel);

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

  const commentsHeading = document.createElement("h3");
  commentsHeading.className = "player-comments-heading";
  commentsHeading.textContent = "Comments";
  const comments = document.createElement("div");
  comments.className = "player-comments";

  const endCard = document.createElement("div");
  endCard.className = "player-end-card";
  endCard.hidden = true;

  root.append(bar, frame, title, nav, description, commentsHeading, comments, endCard);

  // Ask the router to navigate; it pushes history and calls goToVideo back.
  function requestNavigate(index: number): void {
    if (index < 0 || index >= queue.length) return;
    onNavigate(queue[index].videoId, index);
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
      description.textContent = text || "(no description)";
    } catch {
      description.textContent = "(could not load description)";
    }
  }

  async function loadComments(videoId: string): Promise<void> {
    comments.textContent = "Loading comments…";
    try {
      renderComments(await getComments(videoId));
    } catch {
      comments.textContent = "(could not load comments)";
    }
  }

  function renderComments(list: VideoComment[]): void {
    comments.innerHTML = "";
    if (list.length === 0) {
      comments.textContent = "No comments.";
      return;
    }
    for (const comment of list) {
      const item = document.createElement("div");
      item.className = "comment";
      const author = document.createElement("span");
      author.className = "comment-author";
      author.textContent = comment.author;
      const text = document.createElement("span");
      text.className = "comment-text";
      text.textContent = comment.text;
      item.append(author, text);
      comments.appendChild(item);
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
    void loadComments(video.videoId);

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
