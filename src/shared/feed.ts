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
  /** Hide videos that are announced but not out yet (src/shared/upcoming.ts). */
  hideUpcoming: boolean;
  /** Hide every video already in the watch history (seen). */
  hideViewed: boolean;
  /** Hide every video the user dismissed from the feed. */
  hideDismissed: boolean;
  /** Hide every video already saved to the Watch Later playlist. */
  hideSaved: boolean;
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
 * How old a video can be and still show in the feed. The user picks an age,
 * not a date, so the cutoff moves forward every day: "3 months" on April 1 and
 * on April 2 means two different dates. A fixed date would let the feed grow
 * without end, and old watched videos would come back once the 500-entry
 * history cap drops them. There is no "show everything" option, which keeps the
 * feed bounded to recent uploads and the Shorts-duration lookups small.
 */
export interface FeedMaxAgeOption {
  /** The stored preference value. */
  id: string;
  label: string;
  days?: number;
  months?: number;
}

export const FEED_MAX_AGE_OPTIONS: readonly FeedMaxAgeOption[] = [
  { id: "1w", label: "1 week", days: 7 },
  { id: "2w", label: "2 weeks", days: 14 },
  { id: "1m", label: "1 month", months: 1 },
  { id: "2m", label: "2 months", months: 2 },
  { id: "3m", label: "3 months", months: 3 },
  { id: "6m", label: "6 months", months: 6 },
  { id: "1y", label: "1 year", months: 12 },
];

export const DEFAULT_FEED_MAX_AGE = "3m";

/** The feed cutoff (YYYY-MM-DD) for a stored max age, counted back from `now`.
 *  An unknown value reads as the default, so the feed is never unbounded. */
export function feedCutoffDate(now: Date, maxAge: string): string {
  const option: FeedMaxAgeOption =
    FEED_MAX_AGE_OPTIONS.find((candidate) => candidate.id === maxAge) ??
    FEED_MAX_AGE_OPTIONS.find(
      (candidate) => candidate.id === DEFAULT_FEED_MAX_AGE,
    )!;
  if (option.days !== undefined) {
    const target = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() - option.days,
    );
    return isoLocalDate(target);
  }
  return monthsAgoIso(now, option.months ?? 0);
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
  return isoLocalDate(target);
}

function isoLocalDate(target: Date): string {
  const year = String(target.getFullYear()).padStart(4, "0");
  const month = String(target.getMonth() + 1).padStart(2, "0");
  const day = String(target.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
