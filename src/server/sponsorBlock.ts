// Sponsor segments from SponsorBlock, the public crowd database of "skip this
// part" time ranges inside a YouTube video. No key and no account: the app just
// asks over HTTPS, which UrlFetchApp already covers with the
// script.external_request scope it holds.
//
// Two rules shape this file:
//
// 1. PRIVACY. The request carries only the first 4 hex characters of
//    sha256(videoId), so the service sees a bucket of thousands of videos and
//    never learns which one plays here. It answers with every video in that
//    bucket, and this file picks ours out.
// 2. COST. The segments of a video are the same for every viewer, so they go in
//    the SHARED script cache, exactly like the durations in
//    src/server/youtube.ts. The empty answer is cached too, including the 404
//    the service sends for a bucket with nothing in it: a video with no
//    segments is by far the common case and must not be asked twice. A failed
//    lookup is never cached.
//
// Every failure returns an empty list. A missing answer means "skip nothing",
// which is the pre-feature behaviour, and playback must never depend on a
// third-party service that is slow or down.
//
// Data is CC BY-NC-SA 4.0; the app footer credits SponsorBlock.

import {
  boundSponsorSegments,
  normalizeSponsorSegments,
  type SponsorSegment,
} from "../shared/sponsorBlock";

const SPONSOR_API_BASE = "https://sponsor.ajay.app/api/skipSegments/";
const SPONSOR_API_CATEGORIES = "?category=sponsor&category=selfpromo";

const SPONSOR_CACHE_PREFIX = "sb:";
const SPONSOR_CACHE_TTL_SECONDS = 21600; // 6h, the CacheService maximum

// How much of the hash the request carries. SponsorBlock accepts 4 to 32
// characters; 4 is the shortest and therefore the largest crowd to hide in.
const HASH_PREFIX_LENGTH = 4;

/**
 * One video's segments to jump past, cleaned and merged. Empty on any failure.
 * `durationSeconds` is the video length when the caller knows it; it drops an
 * entry that ends past the end of the video. The cache holds the UNBOUNDED
 * list, and the bound applies after the read: the cache is shared by every
 * viewer, but one caller can know the length and the next one cannot, so a
 * bound written into the cache entry would reach viewers that never asked for
 * it.
 */
export function getSponsorSegments(
  videoId: string,
  durationSeconds?: number,
): SponsorSegment[] {
  if (!videoId) return [];

  const cache = CacheService.getScriptCache();
  const key = SPONSOR_CACHE_PREFIX + videoId;
  const cached = cache.get(key);
  if (cached) {
    try {
      return boundSponsorSegments(
        JSON.parse(cached) as SponsorSegment[],
        durationSeconds,
      );
    } catch {
      // Unreadable cache entry; fetch a fresh answer below.
    }
  }

  const fetched = fetchSponsorSegments(videoId);
  if (fetched === null) return []; // failed lookup: retry on the next request
  try {
    cache.put(key, JSON.stringify(fetched), SPONSOR_CACHE_TTL_SECONDS);
  } catch {
    // A cache write failure must not throw away an answer already fetched.
  }
  return boundSponsorSegments(fetched, durationSeconds);
}

// One entry of the bucket answer: the segments of one video in it.
interface SponsorBucketEntry {
  videoID?: string;
  segments?: unknown;
}

// Asks SponsorBlock for the video's hash bucket and picks this video out of
// the answer. Returns null when the lookup failed, which the caller must not
// cache, and a (possibly empty) list when the service answered.
function fetchSponsorSegments(videoId: string): SponsorSegment[] | null {
  const url =
    SPONSOR_API_BASE + videoIdHashPrefix(videoId) + SPONSOR_API_CATEGORIES;
  let response: GoogleAppsScript.URL_Fetch.HTTPResponse;
  try {
    response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  } catch {
    return null;
  }
  const code = response.getResponseCode();
  // SponsorBlock answers 404 when the prefix holds no segment in the requested
  // categories. That is a definitive "nothing here", not a failure, so it is an
  // empty answer the caller caches. Every other non-200 is a failure.
  if (code === 404) return [];
  if (code !== 200) return null;
  try {
    const bucket: unknown = JSON.parse(response.getContentText());
    // A body that parses but is not the bucket array is the same class of
    // failure as one that does not parse at all, so it must not be cached.
    if (!Array.isArray(bucket)) return null;
    const mine = (bucket as SponsorBucketEntry[]).filter(
      (entry: SponsorBucketEntry): boolean =>
        Boolean(entry) && entry.videoID === videoId,
    );
    // The bucket can hold the video more than once. normalizeSponsorSegments
    // sorts and merges, so every match goes in.
    let raw: unknown[] = [];
    for (const entry of mine) {
      if (Array.isArray(entry.segments)) raw = raw.concat(entry.segments);
    }
    return normalizeSponsorSegments(raw);
  } catch {
    return null;
  }
}

// The first HASH_PREFIX_LENGTH hex characters of sha256(videoId).
// Utilities.computeDigest returns SIGNED bytes (-128..127), so each byte is
// brought back into 0..255 before it becomes hex; without that step the hex
// is wrong for every byte above 127 and the service answers about a different
// bucket. Exported because src/server/dearrow.ts asks the same service by the
// same prefix.
export function videoIdHashPrefix(videoId: string): string {
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    videoId,
  );
  let hex = "";
  const bytesNeeded = Math.ceil(HASH_PREFIX_LENGTH / 2);
  for (let index = 0; index < bytesNeeded; index++) {
    const byte = (digest[index] + 256) % 256;
    hex += (byte + 0x100).toString(16).slice(1);
  }
  return hex.slice(0, HASH_PREFIX_LENGTH);
}
