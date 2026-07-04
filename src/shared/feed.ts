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

/**
 * How far back the feed date filter reaches by default. The feed always applies
 * a cutoff (see defaultFeedBeforeDate); the user can pick an older date to widen
 * it, but there is no "show everything" state, which keeps the feed bounded to
 * recent uploads and the Shorts-duration lookups small (see CLAUDE.md).
 */
export const DEFAULT_FEED_BEFORE_MONTHS = 3;

/** The default feed cutoff (YYYY-MM-DD): DEFAULT_FEED_BEFORE_MONTHS before now. */
export function defaultFeedBeforeDate(now: Date): string {
  return monthsAgoIso(now, DEFAULT_FEED_BEFORE_MONTHS);
}

/**
 * The date `months` before `now`, as a local YYYY-MM-DD string. The day is
 * clamped to the target month's length so e.g. 3 months before May 31 is the
 * last day of February, not an overflow into March.
 */
export function monthsAgoIso(now: Date, months: number): string {
  const target = new Date(now.getFullYear(), now.getMonth() - months, 1);
  const lastDayOfTargetMonth = new Date(
    target.getFullYear(),
    target.getMonth() + 1,
    0,
  ).getDate();
  target.setDate(Math.min(now.getDate(), lastDayOfTargetMonth));
  const year = String(target.getFullYear()).padStart(4, "0");
  const month = String(target.getMonth() + 1).padStart(2, "0");
  const day = String(target.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
