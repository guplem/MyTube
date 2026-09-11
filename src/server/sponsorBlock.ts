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
//    src/server/youtube.ts. The empty answer is cached too: a video with no
//    segments is by far the common case and must not be asked twice.
//
// Every failure returns an empty list. A missing answer means "skip nothing",
// which is the pre-feature behaviour, and playback must never depend on a
// third-party service that is slow or down.
//
// Data is CC BY-NC-SA 4.0; the app footer credits SponsorBlock.

import {
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

/** One video's segments to jump past, cleaned and merged. Empty on any failure. */
export function getSponsorSegments(videoId: string): SponsorSegment[] {
  if (!videoId) return [];

  const cache = CacheService.getScriptCache();
  const key = SPONSOR_CACHE_PREFIX + videoId;
  const cached = cache.get(key);
  if (cached) {
    try {
      return JSON.parse(cached) as SponsorSegment[];
    } catch {
      // Unreadable cache entry; fetch a fresh answer below.
    }
  }

  const fetched = fetchSponsorSegments(videoId);
  if (fetched === null) return []; // failed lookup: retry on the next request
  cache.put(key, JSON.stringify(fetched), SPONSOR_CACHE_TTL_SECONDS);
  return fetched;
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
  if (response.getResponseCode() !== 200) return null;
  try {
    const bucket = JSON.parse(response.getContentText()) as {
      videoID?: string;
      segments?: unknown;
    }[];
    if (!Array.isArray(bucket)) return [];
    const mine = bucket.filter((entry) => entry && entry.videoID === videoId);
    if (mine.length === 0) return [];
    return normalizeSponsorSegments(mine[0].segments);
  } catch {
    return null;
  }
}

// The first HASH_PREFIX_LENGTH hex characters of sha256(videoId).
// Utilities.computeDigest returns SIGNED bytes (-128..127), so each byte is
// brought back into 0..255 before it becomes hex; without that step the hex
// is wrong for every byte above 127 and the service answers about a different
// bucket.
function videoIdHashPrefix(videoId: string): string {
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
