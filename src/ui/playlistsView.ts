// The Playlists screen (design P2, issue #103). It owns no data: main.ts loads
// the playlists and routes a tap through onOpen, so this module never imports
// the router.

import { filterPlaylists, type PlaylistSummary } from "../shared/playlist";
import { compactNumber, countLabel, groupedNumber } from "../shared/countLabel";

const ICON_FILTER: string =
  '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4"/></svg>';
const ICON_PLAYLIST: string =
  '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M4 6h12M4 12h12M4 18h8"/><path d="M18 14v6l4-3z" fill="currentColor"/></svg>';
const ICON_CHEVRON: string =
  '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>';

// The Playlists screen: a heading with the count, a filter field, and one row
// per playlist (cover with a compact count, title, exact count, chevron).
// The filter runs in the browser on the list already loaded.
export function PlaylistsView(
  playlists: PlaylistSummary[],
  onOpen: (playlist: PlaylistSummary) => void,
): HTMLElement {
  const root: HTMLElement = document.createElement("div");
  root.className = "playlists";

  const head: HTMLElement = document.createElement("div");
  head.className = "playlists-head";
  const heading: HTMLElement = document.createElement("h2");
  heading.className = "playlists-title";
  heading.textContent = "Playlists";
  const count: HTMLElement = document.createElement("span");
  count.className = "playlists-count";

  const filter: HTMLLabelElement = document.createElement("label");
  filter.className = "playlists-filter";
  filter.innerHTML = ICON_FILTER;
  const input: HTMLInputElement = document.createElement("input");
  input.type = "search";
  input.placeholder = "Filter playlists";
  input.setAttribute("aria-label", "Filter playlists");
  input.setAttribute("enterkeyhint", "search");
  filter.appendChild(input);
  head.append(heading, count, filter);

  const list: HTMLElement = document.createElement("div");
  list.className = "playlist-list";
  const empty: HTMLElement = document.createElement("p");
  empty.className = "muted playlists-empty";
  empty.hidden = true;

  function paint(): void {
    const shown: PlaylistSummary[] = filterPlaylists(playlists, input.value);
    count.textContent =
      shown.length === playlists.length
        ? countLabel(playlists.length, "playlist", "playlists")
        : groupedNumber(shown.length) +
          " of " +
          countLabel(playlists.length, "playlist", "playlists");
    list.replaceChildren(
      ...shown.map((playlist: PlaylistSummary): HTMLElement =>
        playlistRow(playlist, onOpen),
      ),
    );
    empty.hidden = shown.length > 0;
    empty.textContent = "No playlist matches “" + input.value.trim() + "”.";
  }
  input.addEventListener("input", paint);
  paint();

  root.append(head, list, empty);
  return root;
}

function playlistRow(
  playlist: PlaylistSummary,
  onOpen: (playlist: PlaylistSummary) => void,
): HTMLElement {
  const row: HTMLButtonElement = document.createElement("button");
  row.type = "button";
  row.className = "playlist-item";

  const cover: HTMLElement = document.createElement("div");
  cover.className = "playlist-cover";
  if (playlist.thumbnailUrl) {
    const image: HTMLImageElement = document.createElement("img");
    image.src = playlist.thumbnailUrl;
    image.alt = "";
    image.loading = "lazy";
    cover.appendChild(image);
  }
  const badge: HTMLElement = document.createElement("span");
  badge.className = "playlist-cover-count";
  badge.innerHTML = ICON_PLAYLIST;
  badge.append(compactNumber(playlist.itemCount));
  cover.appendChild(badge);

  const text: HTMLElement = document.createElement("div");
  text.className = "playlist-text";
  const title: HTMLElement = document.createElement("span");
  title.className = "playlist-title";
  title.textContent = playlist.title;
  const meta: HTMLElement = document.createElement("span");
  meta.className = "playlist-meta";
  meta.textContent = countLabel(playlist.itemCount, "video", "videos");
  text.append(title, meta);

  const chevron: HTMLElement = document.createElement("span");
  chevron.className = "playlist-chevron";
  chevron.innerHTML = ICON_CHEVRON;

  row.append(cover, text, chevron);
  row.addEventListener("click", (): void => onOpen(playlist));
  return row;
}
