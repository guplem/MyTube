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
  /** The scheduled start (ISO 8601) of a premiere or live stream that is
   *  announced but not out yet. Set by the same lookup as durationSeconds;
   *  absent for every video that can play now. See shared/upcoming.ts. */
  scheduledStartAt?: string;
  /** Whether the user marked this video seen (history, milestone 4). */
  seen: boolean;
  /** Whether the user dismissed this video from the feed. Set on feed videos only. */
  dismissed?: boolean;
  /** Whether this video is in the Watch Later playlist. Set on every list
   *  (feed, playlists, Watch Later, history) so the card's Watch Later toggle
   *  can render its state. */
  inWatchLater?: boolean;
  /** Stored playback position in seconds, so the player resumes where the user
   *  left off (on any device — the store is server-side per user), and cards
   *  show a progress bar. PROGRESS_FINISHED (-1, see shared/videoProgress.ts)
   *  means watched to the end: a full bar, but playback restarts from the top.
   *  Absent when the video has no saved position. */
  progressSeconds?: number;
  /** The community-written title from DeArrow (see shared/dearrow.ts), shown
   *  instead of `title` while the Settings switch is on. Absent when DeArrow
   *  has no title for the video or the lookup failed. */
  communityTitle?: string;
}
