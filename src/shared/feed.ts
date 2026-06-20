// Pagination contract for the subscriptions feed. The feed can be 1000+ videos,
// so the server returns one page at a time instead of shipping the whole list
// across the Apps Script bridge. See PLAN.md section 5.

import type { Video } from "./video";

export interface FeedPageOptions {
  /** 0-based page index. */
  page: number;
  pageSize: number;
  /** Bypass the per-channel RSS cache (the Refresh button). */
  forceRefresh: boolean;
}

export interface FeedPage {
  videos: Video[];
  /** Total videos in the feed, for the page-count display. */
  total: number;
}
