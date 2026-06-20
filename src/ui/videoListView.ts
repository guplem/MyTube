// Renders a Video[] as a grid of cards. Reused by every screen that shows a
// list of videos: the feed, playlists, Watch Later, history. See PLAN.md
// section 13. onPlay is called with the clicked video's index so the caller can
// open the player with the whole list as the queue (player arrives milestone 3).

import type { Video } from "../shared/video";

export function VideoListView(videos: Video[], onPlay: (index: number) => void): HTMLElement {
  const list = document.createElement("div");
  list.className = "video-list";

  if (videos.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No recent uploads from your subscriptions.";
    list.appendChild(empty);
    return list;
  }

  videos.forEach((video, index) => {
    list.appendChild(videoCard(video, () => onPlay(index)));
  });
  return list;
}

function videoCard(video: Video, onClick: () => void): HTMLElement {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "video-card";
  if (video.seen) card.classList.add("video-card--seen");
  card.addEventListener("click", onClick);

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
  card.append(thumbnail, meta);
  return card;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString();
}
