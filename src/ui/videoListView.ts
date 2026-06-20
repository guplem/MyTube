// Renders a Video[] as a paginated grid of cards. Reused by every screen that
// shows a list of videos: feed, playlists, Watch Later, history. See PLAN.md
// section 13. onPlay reports the index in the FULL list (not the page) so the
// caller opens the player with the whole list as its queue. Optional per-card
// actions (e.g. add/remove Watch Later) render as buttons under each card.

import type { Video } from "../shared/video";

export interface VideoAction {
  label: string;
  onClick: (video: Video, button: HTMLButtonElement) => void;
}

export interface VideoListOptions {
  onPlay: (index: number) => void;
  actions?: VideoAction[];
}

const PAGE_SIZE_OPTIONS = [24, 48, 96];
const DEFAULT_PAGE_SIZE = 24;

export function VideoListView(videos: Video[], options: VideoListOptions): HTMLElement {
  const actions = options.actions ?? [];
  const root = document.createElement("div");
  root.className = "list-view";

  if (videos.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No videos here yet.";
    root.appendChild(empty);
    return root;
  }

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
    render();
  });
  sizeLabel.append(document.createTextNode("Per page "), sizeSelect);

  controls.append(prevButton, nextButton, info, sizeLabel);

  const grid = document.createElement("div");
  grid.className = "video-list";

  function goToPage(target: number): void {
    page = target;
    render();
    window.scrollTo({ top: 0 });
  }

  function render(): void {
    const pageCount = Math.max(1, Math.ceil(videos.length / pageSize));
    page = Math.min(Math.max(page, 0), pageCount - 1);
    const start = page * pageSize;
    const pageVideos = videos.slice(start, start + pageSize);

    grid.innerHTML = "";
    pageVideos.forEach((video, indexInPage): void => {
      grid.appendChild(videoCard(video, (): void => options.onPlay(start + indexInPage), actions));
    });

    info.textContent = `Page ${page + 1} of ${pageCount} · ${videos.length} videos`;
    prevButton.disabled = page <= 0;
    nextButton.disabled = page >= pageCount - 1;
  }

  root.append(controls, grid);
  render();
  return root;
}

function videoCard(video: Video, onPlay: () => void, actions: VideoAction[]): HTMLElement {
  const card = document.createElement("div");
  card.className = "video-card";
  if (video.seen) card.classList.add("video-card--seen");

  const play = document.createElement("button");
  play.type = "button";
  play.className = "video-play";
  play.addEventListener("click", onPlay);

  const thumbnail = document.createElement("img");
  thumbnail.className = "video-thumb";
  thumbnail.src = video.thumbnailUrl;
  thumbnail.alt = "";
  thumbnail.loading = "lazy";

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
  play.append(thumbnail, meta);
  card.appendChild(play);

  if (actions.length > 0) {
    const actionRow = document.createElement("div");
    actionRow.className = "video-actions";
    for (const action of actions) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "video-action";
      button.textContent = action.label;
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
