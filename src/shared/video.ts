// The one normalized shape every data source maps to. RSS feeds, playlists,
// Watch Later, and history all produce Video[], so a single VideoListView and
// PlayerView can render any of them. See PLAN.md sections 5 and 13.

export interface Video {
  videoId: string;
  title: string;
  channelId: string;
  channelTitle: string;
  thumbnailUrl: string;
  /** ISO 8601 timestamp, e.g. "2026-06-20T10:30:00+00:00". */
  publishedAt: string;
  /** Not available from RSS; filled in for sources that know it. */
  durationSeconds?: number;
  /** Whether the user marked this video seen (history, milestone 4). */
  seen: boolean;
}
