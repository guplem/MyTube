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
  /** Hide videos at or under the Shorts length threshold (detected by duration). */
  hideShorts: boolean;
  /** Hide every video already in the watch history (seen). */
  hideViewed: boolean;
  /** Hide every video the user dismissed from the feed. */
  hideDismissed: boolean;
  /** Hide videos published before this date (YYYY-MM-DD); "" means no cutoff. */
  beforeDate: string;
}

export interface FeedPage {
  videos: Video[];
  /** Total videos in the feed, for the page-count display. */
  total: number;
  /** Subscription channels that could not be fetched fresh this load (after
   *  retries); some may still be shown from cache. Lets the UI warn that the
   *  feed may be incomplete. */
  failedChannels: number;
  /** Total subscription channels considered, for the "N of M" warning. */
  totalChannels: number;
}

/** The full subscriptions feed before paging, with load-health counts. */
export interface UploadsFeed {
  videos: Video[];
  /** Channels whose RSS could not be fetched fresh this load (after retries). */
  failedChannels: number;
  /** Total subscription channels considered. */
  totalChannels: number;
}
