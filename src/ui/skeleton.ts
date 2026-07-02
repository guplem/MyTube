// Skeleton loading placeholders: grey pulsing blocks shaped and sized like the
// content they stand in for. Every async load renders one of these so the page
// keeps its layout — and its scroll position — while data is on the wire,
// instead of collapsing to a one-line "Loading…" message (which made switching
// to the Comments tab jump the scroll when the panel shrank to a single line).
// Each builder mirrors the real component's DOM structure and reuses its layout
// classes, so the placeholder occupies the same space the loaded content will.
// Styles live in index.html (`.skeleton` and friends).

/** A single grey block sized to mimic one line of text. */
export function skeletonLine(width: string, height: string): HTMLElement {
  const line = document.createElement("div");
  line.className = "skeleton";
  line.style.width = width;
  line.style.height = height;
  return line;
}

/** Text lines with paragraph spacing (0.9rem line + 0.55rem gap ≈ the 1.45
 *  line-height the description and comment text render at). */
export function skeletonParagraph(widths: string[]): HTMLElement {
  const paragraph = document.createElement("div");
  paragraph.className = "skeleton-paragraph";
  for (const width of widths) paragraph.appendChild(skeletonLine(width, "0.9rem"));
  return paragraph;
}

/** Placeholder video card: thumbnail, title (two lines), channel, date, and
 *  the action-button row, matching the loaded card's proportions. */
export function skeletonVideoCard(): HTMLElement {
  const card = document.createElement("div");
  card.className = "video-card video-card--skeleton";

  const thumb = document.createElement("div");
  thumb.className = "skeleton skeleton-thumb";

  const meta = document.createElement("div");
  meta.className = "video-meta";
  meta.append(
    skeletonLine("100%", "0.95rem"), // title, first line
    skeletonLine("65%", "0.95rem"), // title, second line
    skeletonLine("50%", "0.85rem"), // channel
    skeletonLine("35%", "0.8rem"), // date
  );

  const actionRow = document.createElement("div");
  actionRow.className = "video-actions";
  for (let index = 0; index < 2; index += 1) {
    const action = document.createElement("div");
    action.className = "skeleton skeleton-action";
    actionRow.appendChild(action);
  }

  card.append(thumb, meta, actionRow);
  return card;
}

// Comment text widths cycled by row so a column of placeholders reads as
// varied comments rather than identical stamped rows.
const COMMENT_TEXT_WIDTHS: string[][] = [
  ["100%", "80%"],
  ["90%", "35%"],
  ["100%", "95%", "60%"],
  ["75%"],
];

/** Placeholder comment: avatar, author/time head, text lines, like count. */
export function skeletonComment(index: number = 0): HTMLElement {
  const item = document.createElement("div");
  item.className = "comment comment--skeleton";

  const avatar = document.createElement("div");
  avatar.className = "skeleton comment-avatar";

  const body = document.createElement("div");
  body.className = "comment-body";

  const head = document.createElement("div");
  head.className = "comment-head";
  head.append(skeletonLine("7rem", "0.85rem"), skeletonLine("3.5rem", "0.75rem"));

  const text = skeletonParagraph(COMMENT_TEXT_WIDTHS[index % COMMENT_TEXT_WIDTHS.length]);
  const meta = skeletonLine("2.5rem", "0.8rem");

  body.append(head, text, meta);
  item.append(avatar, body);
  return item;
}

/** A run of placeholder comments (first page, or appended below "show more"). */
export function skeletonComments(count: number): HTMLElement[] {
  return Array.from({ length: count }, (_, index) => skeletonComment(index));
}

/** Placeholder for the description card's text block. */
export function skeletonDescription(): HTMLElement {
  return skeletonParagraph(["100%", "92%", "97%", "88%", "55%"]);
}

/** Placeholder for the sort toolbar above a playlist-type list, so the grid
 *  below doesn't shift down when the real control appears. One block sized
 *  like the "Sort" label plus its select. */
export function skeletonSortToolbar(): HTMLElement {
  const toolbar = document.createElement("div");
  toolbar.className = "feed-toolbar";
  toolbar.appendChild(skeletonLine("15rem", "1.9rem"));
  return toolbar;
}

// Row widths cycled so the playlist placeholders look like titles of varied length.
const PLAYLIST_ROW_WIDTHS = ["55%", "40%", "65%", "35%", "50%", "45%"];

/** Placeholder rows shown while the playlists index loads. Each row is a real
 *  `.playlist-item` box (same padding/border) holding one title-sized line. */
export function skeletonPlaylistList(count: number = 6): HTMLElement {
  const list = document.createElement("div");
  list.className = "playlist-list";
  for (let index = 0; index < count; index += 1) {
    const item = document.createElement("div");
    item.className = "playlist-item playlist-item--skeleton";
    item.appendChild(skeletonLine(PLAYLIST_ROW_WIDTHS[index % PLAYLIST_ROW_WIDTHS.length], "1.2rem"));
    list.appendChild(item);
  }
  return list;
}

/** Placeholder for the whole player screen, shown while a shared link rebuilds
 *  its queue: the 16:9 frame, title row, nav line, and description card. */
export function skeletonPlayerView(): HTMLElement {
  const root = document.createElement("div");
  root.className = "player-view";

  const frame = document.createElement("div");
  frame.className = "skeleton skeleton-player-frame";

  const titleRow = document.createElement("div");
  titleRow.className = "player-title-row";
  titleRow.appendChild(skeletonLine("55%", "1.15rem"));

  const nav = document.createElement("div");
  nav.className = "player-nav";
  nav.appendChild(skeletonLine("30%", "0.9rem"));

  const descCard = document.createElement("div");
  descCard.className = "player-card";
  descCard.appendChild(skeletonDescription());

  root.append(frame, titleRow, nav, descCard);
  return root;
}
