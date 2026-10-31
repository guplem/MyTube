// A video can be listed before it is out: a scheduled premiere or live stream.
// RSS lists it like any upload, with the date it was announced, and nothing
// plays yet. The Data API marks it in liveStreamingDetails: a scheduled start
// with no actual start. The same videos.list call that gives the duration
// carries it, so the lookup costs no extra quota.
//
// The answer changes when the video comes out, so the shared cache must not
// keep it for the usual 6 hours: an upcoming video is kept until its scheduled
// start, and a live one only a few minutes, until it has a real duration.

import { formatUploadTime } from "./uploadTime";

/** The part of the Data API's `liveStreamingDetails` that we read. */
export interface LiveStreamingDetails {
  scheduledStartTime?: string;
  actualStartTime?: string;
  actualEndTime?: string;
}

const FULL_CACHE_SECONDS: number = 21600; // 6h, the CacheService maximum
const RECHECK_SECONDS: number = 300;
// Under this, the start is "now": a premiere often starts a little late.
const STARTING_SOON_MS: number = 5 * 60 * 1000;

/** The scheduled start (ISO 8601) while the video is announced but has not
 *  started; undefined for a normal upload, a live video, or a finished one. */
export function scheduledStartOf(
  details: LiveStreamingDetails | undefined,
): string | undefined {
  if (!details || details.actualStartTime) return undefined;
  return details.scheduledStartTime || undefined;
}

/** How long the shared cache may keep one video's length lookup. */
export function videoLengthCacheSeconds(
  details: LiveStreamingDetails | undefined,
  nowMs: number,
): number {
  if (!details || details.actualEndTime) return FULL_CACHE_SECONDS;
  const scheduled: string | undefined = scheduledStartOf(details);
  if (scheduled === undefined) {
    // Live now (or a broadcast with no times): no duration until it ends.
    return details.actualStartTime ? RECHECK_SECONDS : FULL_CACHE_SECONDS;
  }
  const untilStart: number = Math.ceil((Date.parse(scheduled) - nowMs) / 1000);
  if (Number.isNaN(untilStart)) return RECHECK_SECONDS;
  return Math.min(FULL_CACHE_SECONDS, Math.max(RECHECK_SECONDS, untilStart));
}

/** The card and player label for an upcoming video. `locale` is for tests. */
export function upcomingLabel(
  scheduledStartAt: string,
  now: Date = new Date(),
  locale?: string,
): string {
  const startMs: number = Date.parse(scheduledStartAt);
  if (Number.isNaN(startMs)) return "Upcoming";
  if (startMs - now.getTime() <= STARTING_SOON_MS) return "Starting soon";
  return "Upcoming · " + formatUploadTime(scheduledStartAt, now, locale);
}
