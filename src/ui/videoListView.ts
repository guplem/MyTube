// Renders a paginated grid of video cards. Reused by every screen that shows a
// list of videos: feed, playlists, Watch Later, history. See PLAN.md section 13.
//
// Two entry points share one renderer:
//   - VideoListView(videos, options): pages over an in-memory array (small
//     lists already fully loaded: playlists, Watch Later, history).
//   - PagedVideoListView(load, options): pages by calling an async loader (the
//     feed, which pages on the server so the browser never holds the whole list).
//
// onPlay reports the queue the player should use and the index within it. For
// in-memory lists that queue is the full array (play continues across the whole
// list); for the server-paged feed it is just the current page.

import type { Video } from "../shared/video";

export interface VideoAction {
  /** Static text, or a function of the video (e.g. "Seen ✓" vs "Mark seen"). */
  label: string | ((video: Video) => string);
  onClick: (video: Video, button: HTMLButtonElement) => void;
}

export interface VideoListOptions {
  onPlay: (index: number, queue: Video[]) => void;
  actions?: VideoAction[];
  /** Optional button overlaid on the top-right corner of the card (e.g. dismiss). */
  cornerAction?: VideoAction;
}

interface VideoPage {
  videos: Video[];
  total: number;
}

/** Loads one page of videos. Returns the page slice and the total count. */
type PageLoader = (page: number, pageSize: number) => Promise<VideoPage>;

const PAGE_SIZE_OPTIONS = [24, 48, 96];
const DEFAULT_PAGE_SIZE = 24;
const SKELETON_COUNT = 12; // placeholder cards shown while a page loads

function skeletonCard(): HTMLElement {
  const card = document.createElement("div");
  card.className = "video-card video-card--skeleton";
  const thumb = document.createElement("div");
  thumb.className = "skeleton-thumb";
  const meta = document.createElement("div");
  meta.className = "video-meta";
  const line = document.createElement("div");
  line.className = "skeleton-line";
  const lineShort = document.createElement("div");
  lineShort.className = "skeleton-line skeleton-line--short";
  meta.append(line, lineShort);
  card.append(thumb, meta);
  return card;
}

function fillWithSkeletons(grid: HTMLElement, count: number): void {
  grid.innerHTML = "";
  for (let index = 0; index < count; index += 1) grid.appendChild(skeletonCard());
}

/** A standalone placeholder grid, for a screen loading its first batch. */
export function skeletonGrid(count: number = SKELETON_COUNT): HTMLElement {
  const grid = document.createElement("div");
  grid.className = "video-list";
  fillWithSkeletons(grid, count);
  return grid;
}

/** Paged list backed by an async loader (the feed pages on the server). */
export function PagedVideoListView(load: PageLoader, options: VideoListOptions): HTMLElement {
  return renderList(load, options, null);
}

/** In-memory list over a full array (playlists, Watch Later, history). */
export function VideoListView(videos: Video[], options: VideoListOptions): HTMLElement {
  const load: PageLoader = (page, pageSize) =>
    Promise.resolve({
      videos: videos.slice(page * pageSize, page * pageSize + pageSize),
      total: videos.length,
    });
  return renderList(load, options, videos);
}

// fullQueue is the array to use as the player queue in in-memory mode, or null
// for server-paged mode (where the queue is just the current page).
function renderList(load: PageLoader, options: VideoListOptions, fullQueue: Video[] | null): HTMLElement {
  const actions = options.actions ?? [];
  const root = document.createElement("div");
  root.className = "list-view";

  let pageSize = DEFAULT_PAGE_SIZE;
  let page = 0;

  const controls = document.createElement("div");
  controls.className = "list-controls";

  const prevButton = document.createElement("button");
  prevButton.type = "button";
  prevButton.textContent = "← Previous";
  prevButton.addEventListener("click", (): void => goToPage(page - 1));

  const nextButton = document.createElement("button");
  nextButton.type = "button";
  nextButton.textContent = "Next →";
  nextButton.addEventListener("click", (): void => goToPage(page + 1));

  const info = document.createElement("span");
  info.className = "list-info";

  const sizeLabel = document.createElement("label");
  sizeLabel.className = "list-size";
  const sizeSelect = document.createElement("select");
  for (const size of PAGE_SIZE_OPTIONS) {
    const option = document.createElement("option");
    option.value = String(size);
    option.textContent = String(size);
    if (size === DEFAULT_PAGE_SIZE) option.selected = true;
    sizeSelect.appendChild(option);
  }
  sizeSelect.addEventListener("change", (): void => {
    pageSize = Number(sizeSelect.value);
    page = 0;
    void render();
  });
  sizeLabel.append(document.createTextNode("Per page "), sizeSelect);

  controls.append(prevButton, nextButton, info, sizeLabel);

  const grid = document.createElement("div");
  grid.className = "video-list";

  function goToPage(target: number): void {
    page = target;
    void render();
    window.scrollTo({ top: 0 });
  }

  async function render(): Promise<void> {
    prevButton.disabled = true;
    nextButton.disabled = true;
    // Replace the old page with placeholders right away so stale cards never
    // linger during the load. An in-memory load resolves on the same task, so
    // its skeletons never paint; only a real server fetch shows them.
    fillWithSkeletons(grid, Math.min(pageSize, SKELETON_COUNT));
    let result: VideoPage;
    try {
      result = await load(page, pageSize);
    } catch (error) {
      grid.innerHTML = "";
      const failure = document.createElement("p");
      failure.className = "muted";
      failure.textContent = `Could not load videos: ${(error as Error).message}`;
      grid.appendChild(failure);
      return;
    }

    const { videos, total } = result;
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    if (page > pageCount - 1) {
      // The page no longer exists (e.g. a filter shrank the list); clamp and reload.
      page = pageCount - 1;
      void render();
      return;
    }

    grid.innerHTML = "";
    if (total === 0) {
      controls.style.display = "none";
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = "No videos here yet.";
      grid.appendChild(empty);
      return;
    }
    controls.style.display = "";

    videos.forEach((video, indexInPage): void => {
      const queue = fullQueue ?? videos;
      const index = fullQueue ? page * pageSize + indexInPage : indexInPage;
      grid.appendChild(
        videoCard(video, (): void => options.onPlay(index, queue), actions, options.cornerAction),
      );
    });

    info.textContent = `Page ${page + 1} of ${pageCount} · ${total} videos`;
    prevButton.disabled = page <= 0;
    nextButton.disabled = page >= pageCount - 1;
  }

  // Controls go below the grid so paging lives at the bottom of the list.
  root.append(grid, controls);
  void render();
  return root;
}

function videoCard(
  video: Video,
  onPlay: () => void,
  actions: VideoAction[],
  cornerAction?: VideoAction,
): HTMLElement {
  const card = document.createElement("div");
  card.className = "video-card";
  if (video.seen) card.classList.add("video-card--seen");
  // dismissed is set on feed videos only, so this dims dismissed cards in the feed.
  if (video.dismissed) card.classList.add("video-card--dismissed");

  const play = document.createElement("button");
  play.type = "button";
  play.className = "video-play";
  play.addEventListener("click", onPlay);

  const thumbWrap = document.createElement("div");
  thumbWrap.className = "video-thumb-wrap";

  const thumbnail = document.createElement("img");
  thumbnail.className = "video-thumb";
  thumbnail.src = video.thumbnailUrl;
  thumbnail.alt = "";
  thumbnail.loading = "lazy";
  thumbWrap.appendChild(thumbnail);

  if (video.durationSeconds !== undefined && video.durationSeconds > 0) {
    const duration = document.createElement("span");
    duration.className = "video-duration";
    duration.textContent = formatDuration(video.durationSeconds);
    thumbWrap.appendChild(duration);
  }

  const meta = document.createElement("div");
  meta.className = "video-meta";

  const title = document.createElement("span");
  title.className = "video-title";
  title.textContent = video.title;

  const channel = document.createElement("span");
  channel.className = "video-channel";
  channel.textContent = video.channelTitle;

  const date = document.createElement("span");
  date.className = "video-date";
  date.textContent = formatDate(video.publishedAt);

  meta.append(title, channel, date);
  play.append(thumbWrap, meta);
  card.appendChild(play);

  if (cornerAction) {
    const corner = document.createElement("button");
    corner.type = "button";
    corner.className = "video-card-corner";
    corner.setAttribute("aria-label", "Dismiss video from feed");
    corner.textContent =
      typeof cornerAction.label === "function" ? cornerAction.label(video) : cornerAction.label;
    corner.addEventListener("click", (): void => cornerAction.onClick(video, corner));
    card.appendChild(corner);
  }

  if (actions.length > 0) {
    const actionRow = document.createElement("div");
    actionRow.className = "video-actions";
    for (const action of actions) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "video-action";
      button.textContent = typeof action.label === "function" ? action.label(video) : action.label;
      button.addEventListener("click", (): void => action.onClick(video, button));
      actionRow.appendChild(button);
    }
    card.appendChild(actionRow);
  }

  return card;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString();
}

// Seconds to "M:SS" (or "H:MM:SS" for an hour or more).
function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}
