// Reads the user's subscriptions through the YouTube advanced service.
//
// We call the API only to learn which channels the user is subscribed to, and we
// cache that list per user. The actual videos come from each channel's RSS feed
// (see feed.ts), which costs no API quota. See PLAN.md section 5.

import type { Video } from "../shared/video";
import type { PlaylistSummary } from "../shared/playlist";
import type {
  VideoComment,
  CommentOrder,
  CommentPage,
} from "../shared/comment";
import {
  scheduledStartOf,
  videoLengthCacheSeconds,
  type LiveStreamingDetails,
} from "../shared/upcoming";

export interface SubscriptionChannel {
  channelId: string;
  title: string;
}

const WATCH_LATER_ID_KEY = "watchLaterPlaylistId";
const WATCH_LATER_TITLE = "MyTube — Watch Later";
const WATCH_LATER_IDS_CACHE_KEY = "watchLaterVideoIds";
const WATCH_LATER_IDS_TTL_SECONDS = 600; // 10 min; kept fresh by add/remove below

const CACHE_KEY = "subscriptionChannels";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // refresh the channel list at most daily

interface CachedChannels {
  fetchedAt: number;
  channels: SubscriptionChannel[];
}

/** Returns the user's subscription channels, cached for a day. Pass true to refetch. */
export function getSubscriptionChannels(
  forceRefresh: boolean,
): SubscriptionChannel[] {
  const properties = PropertiesService.getUserProperties();
  if (!forceRefresh) {
    const cached = properties.getProperty(CACHE_KEY);
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as CachedChannels;
        if (Date.now() - parsed.fetchedAt < CACHE_TTL_MS)
          return parsed.channels;
      } catch {
        // Corrupt cache entry; fall through and refetch (which overwrites it).
      }
    }
  }
  const channels = fetchAllSubscriptionChannels();
  const toStore: CachedChannels = { fetchedAt: Date.now(), channels };
  properties.setProperty(CACHE_KEY, JSON.stringify(toStore));
  return channels;
}

function fetchAllSubscriptionChannels(): SubscriptionChannel[] {
  const channels: SubscriptionChannel[] = [];
  let pageToken: string | undefined = undefined;
  do {
    const response: GoogleAppsScript.YouTube.Schema.SubscriptionListResponse =
      YouTube.Subscriptions!.list("snippet", {
        mine: true,
        maxResults: 50,
        order: "alphabetical",
        pageToken,
      });
    for (const item of response.items ?? []) {
      const channelId = item.snippet?.resourceId?.channelId;
      if (channelId) {
        channels.push({ channelId, title: item.snippet?.title ?? "" });
      }
    }
    pageToken = response.nextPageToken ?? undefined;
  } while (pageToken);
  return channels;
}

/** Returns the description text of a single video. Costs 1 quota unit. */
export function getVideoDescription(videoId: string): string {
  const response: GoogleAppsScript.YouTube.Schema.VideoListResponse =
    YouTube.Videos!.list("snippet", { id: videoId });
  const items = response.items ?? [];
  if (items.length === 0) return "";
  return items[0].snippet?.description ?? "";
}

/** The user's own playlists (not YouTube's special Watch Later/History, which the API hides). */
export function getPlaylists(): PlaylistSummary[] {
  const playlists: PlaylistSummary[] = [];
  let pageToken: string | undefined = undefined;
  do {
    const response: GoogleAppsScript.YouTube.Schema.PlaylistListResponse =
      YouTube.Playlists!.list("snippet,contentDetails", {
        mine: true,
        maxResults: 50,
        pageToken,
      });
    for (const item of response.items ?? []) {
      if (!item.id) continue;
      playlists.push({
        playlistId: item.id,
        title: item.snippet?.title ?? "",
        itemCount: item.contentDetails?.itemCount ?? 0,
        thumbnailUrl: bestThumbnailUrl(item.snippet?.thumbnails),
      });
    }
    pageToken = response.nextPageToken ?? undefined;
  } while (pageToken);
  return playlists;
}

/** All videos in a playlist, in playlist order. */
export function getPlaylistVideos(playlistId: string): Video[] {
  const videos: Video[] = [];
  let pageToken: string | undefined = undefined;
  do {
    const response: GoogleAppsScript.YouTube.Schema.PlaylistItemListResponse =
      YouTube.PlaylistItems!.list("snippet,contentDetails", {
        playlistId,
        maxResults: 50,
        pageToken,
      });
    for (const item of response.items ?? []) {
      // videoOwnerChannel* are the actual uploader; they exist in the API
      // response but are missing from this @types version, so widen the type.
      const snippet = item.snippet as
        | (GoogleAppsScript.YouTube.Schema.PlaylistItemSnippet & {
            videoOwnerChannelId?: string;
            videoOwnerChannelTitle?: string;
          })
        | undefined;
      const videoId =
        snippet?.resourceId?.videoId ?? item.contentDetails?.videoId;
      if (!videoId || !snippet) continue;
      videos.push({
        videoId,
        title: snippet.title ?? "",
        channelId: snippet.videoOwnerChannelId ?? snippet.channelId ?? "",
        channelTitle:
          snippet.videoOwnerChannelTitle ?? snippet.channelTitle ?? "",
        thumbnailUrl: bestThumbnailUrl(snippet.thumbnails),
        // Use the video's real upload date (contentDetails.videoPublishedAt),
        // not snippet.publishedAt, which is the date it was added to the playlist.
        publishedAt:
          item.contentDetails?.videoPublishedAt ?? snippet.publishedAt ?? "",
        seen: false,
      });
    }
    pageToken = response.nextPageToken ?? undefined;
  } while (pageToken);
  return videos;
}

/** Id of the app-managed Watch Later playlist, created on first use and remembered per user. */
export function getWatchLaterPlaylistId(): string {
  const properties = PropertiesService.getUserProperties();
  const existing = properties.getProperty(WATCH_LATER_ID_KEY);
  if (existing) return existing;
  // First-ever use. Serialize creation per user: two concurrent "Add to Watch
  // Later" taps would otherwise both see "absent" and each create a real
  // playlist on the account, orphaning one. Re-read inside the lock in case a
  // concurrent execution created it while we waited.
  const lock = LockService.getUserLock();
  lock.waitLock(10000);
  try {
    const winner = properties.getProperty(WATCH_LATER_ID_KEY);
    if (winner) return winner;
    const created: GoogleAppsScript.YouTube.Schema.Playlist =
      YouTube.Playlists!.insert(
        {
          snippet: {
            title: WATCH_LATER_TITLE,
            description: "Managed by MyTube.",
          },
          status: { privacyStatus: "private" },
        },
        "snippet,status",
      );
    const id = created.id ?? "";
    if (id) properties.setProperty(WATCH_LATER_ID_KEY, id);
    return id;
  } finally {
    lock.releaseLock();
  }
}

/** The Watch Later playlist id if it already exists, or "" without creating one. */
function findWatchLaterPlaylistId(): string {
  return (
    PropertiesService.getUserProperties().getProperty(WATCH_LATER_ID_KEY) ?? ""
  );
}

/**
 * The set of video ids in Watch Later, for flagging "already added" in lists.
 * Returns [] (no API call) if the user has no Watch Later playlist yet. Cached
 * per user for 10 minutes; add/removeFromWatchLater keep the cache in sync.
 */
export function getWatchLaterVideoIds(): string[] {
  const playlistId = findWatchLaterPlaylistId();
  if (!playlistId) return [];
  const cache = CacheService.getUserCache();
  const cached = cache.get(WATCH_LATER_IDS_CACHE_KEY);
  if (cached) {
    try {
      return JSON.parse(cached) as string[];
    } catch {
      // fall through and refetch
    }
  }
  const ids = getPlaylistVideos(playlistId).map((video) => video.videoId);
  cache.put(
    WATCH_LATER_IDS_CACHE_KEY,
    JSON.stringify(ids),
    WATCH_LATER_IDS_TTL_SECONDS,
  );
  return ids;
}

// Keeps the cached id set in sync after an add/remove, avoiding a refetch.
function updateCachedWatchLaterIds(videoId: string, present: boolean): void {
  const cache = CacheService.getUserCache();
  const cached = cache.get(WATCH_LATER_IDS_CACHE_KEY);
  if (!cached) return; // no cache yet; the next read fetches fresh
  try {
    const ids = JSON.parse(cached) as string[];
    const next = present
      ? ids.includes(videoId)
        ? ids
        : [...ids, videoId]
      : ids.filter((id) => id !== videoId);
    cache.put(
      WATCH_LATER_IDS_CACHE_KEY,
      JSON.stringify(next),
      WATCH_LATER_IDS_TTL_SECONDS,
    );
  } catch {
    // Leave the cache; it will expire and refetch.
  }
}

/** Videos in the app-managed Watch Later playlist. */
export function getWatchLaterVideos(): Video[] {
  return getPlaylistVideos(getWatchLaterPlaylistId());
}

/** Adds a video to the Watch Later playlist. */
export function addToWatchLater(videoId: string): void {
  YouTube.PlaylistItems!.insert(
    {
      snippet: {
        playlistId: getWatchLaterPlaylistId(),
        resourceId: { kind: "youtube#video", videoId },
      },
    },
    "snippet",
  );
  updateCachedWatchLaterIds(videoId, true);
}

/**
 * Re-adds a video to Watch Later if it is not already there. Used to undo the
 * Watch Later drop that marking a video seen performs. Never creates the
 * playlist: if the user has none, marking seen dropped nothing, so there is
 * nothing to restore.
 */
export function restoreToWatchLater(videoId: string): void {
  const playlistId = findWatchLaterPlaylistId();
  if (!playlistId) return;
  if (getWatchLaterVideoIds().includes(videoId)) return;
  YouTube.PlaylistItems!.insert(
    {
      snippet: {
        playlistId,
        resourceId: { kind: "youtube#video", videoId },
      },
    },
    "snippet",
  );
  updateCachedWatchLaterIds(videoId, true);
}

/** Removes the first Watch Later item matching the video id. */
export function removeFromWatchLater(videoId: string): void {
  const playlistId = getWatchLaterPlaylistId();
  let pageToken: string | undefined = undefined;
  do {
    const response: GoogleAppsScript.YouTube.Schema.PlaylistItemListResponse =
      YouTube.PlaylistItems!.list("snippet", {
        playlistId,
        maxResults: 50,
        pageToken,
      });
    for (const item of response.items ?? []) {
      if (item.id && item.snippet?.resourceId?.videoId === videoId) {
        YouTube.PlaylistItems!.remove(item.id);
        updateCachedWatchLaterIds(videoId, false);
        return;
      }
    }
    pageToken = response.nextPageToken ?? undefined;
  } while (pageToken);
}

function bestThumbnailUrl(
  thumbnails: GoogleAppsScript.YouTube.Schema.ThumbnailDetails | undefined,
): string {
  if (!thumbnails) return "";
  return (
    thumbnails.medium?.url ??
    thumbnails.default?.url ??
    thumbnails.high?.url ??
    ""
  );
}

const DURATION_CACHE_PREFIX = "dur:";
const DURATION_UNKNOWN = -1; // cached for ids the API does not return (deleted/private/live)
const DURATION_BATCH_SIZE = 50; // videos.list accepts at most 50 ids
const VIDEOS_API_URL = "https://www.googleapis.com/youtube/v3/videos";
// liveStreamingDetails marks an announced video. videos.list costs the same
// quota whatever parts it returns, so asking for it is free.
const VIDEO_LENGTH_PARTS = "contentDetails,liveStreamingDetails";
// An upcoming video is cached as this prefix plus its scheduled start, in the
// same entry as a duration, so one cache read answers both questions.
const UPCOMING_CACHE_PREFIX = "upcoming:";

/** One video's length lookup. */
export interface VideoLength {
  /** Seconds, or DURATION_UNKNOWN (-1) when YouTube gives none. */
  durationSeconds: number;
  /** Set while the video is announced but not out yet (shared/upcoming.ts). */
  scheduledStartAt?: string;
}

// A fetched length plus how long the shared cache may keep it.
interface FetchedLength extends VideoLength {
  cacheSeconds: number;
}

/**
 * Length in seconds for each video id, used to detect Shorts, plus the
 * scheduled start of a video that is announced but not out yet. RSS gives
 * neither, so we ask the Data API (1 quota unit per 50 ids). Results are
 * cached in the shared script cache because a video's length is the same for
 * every user, so most lookups are free after the first.
 *
 * The 6-hour cache is the CacheService maximum, so the first feed load after a
 * long gap misses on hundreds of ids. The advanced service can only ask one
 * batch at a time, so the misses go out as plain HTTPS requests in ONE
 * UrlFetchApp.fetchAll instead, signed with the user's own OAuth token. A
 * batch whose request fails falls back to the advanced service. A batch that
 * fails both ways is left out and NOT cached: unknown is not "no duration".
 * An upcoming or live video is cached for less time (videoLengthCacheSeconds),
 * because its answer changes when it comes out.
 */
export function getVideoLengths(videoIds: string[]): {
  [id: string]: VideoLength;
} {
  const result: { [id: string]: VideoLength } = {};
  if (videoIds.length === 0) return result;

  const cache = CacheService.getScriptCache();
  const keys = videoIds.map((id) => DURATION_CACHE_PREFIX + id);
  // getAll has a per-call size limit, and the feed can be 1000+ ids; read in
  // chunks so a large feed never trips it.
  const cached: { [key: string]: string } = {};
  for (let offset = 0; offset < keys.length; offset += 100) {
    Object.assign(cached, cache.getAll(keys.slice(offset, offset + 100)));
  }
  const missing: string[] = [];
  for (const id of videoIds) {
    const hit = cached[DURATION_CACHE_PREFIX + id];
    if (hit !== undefined && hit !== null) result[id] = parseCachedLength(hit);
    else missing.push(id);
  }

  const batches: string[][] = [];
  for (let offset = 0; offset < missing.length; offset += DURATION_BATCH_SIZE)
    batches.push(missing.slice(offset, offset + DURATION_BATCH_SIZE));
  const parallel = fetchLengthBatchesInParallel(batches);

  // One putAll per TTL: putAll takes a single TTL for every entry it writes.
  const toCache: { [ttl: number]: { [key: string]: string } } = {};
  batches.forEach((batch: string[], index: number): void => {
    const lengths =
      parallel[index] ?? fetchLengthBatchWithAdvancedService(batch);
    if (lengths === null) return;
    for (const id of batch) {
      // Cache a sentinel for ids the API skipped so we do not re-query them.
      const fetched: FetchedLength = lengths[id] ?? {
        durationSeconds: DURATION_UNKNOWN,
        cacheSeconds: videoLengthCacheSeconds(undefined, Date.now()),
      };
      const length: VideoLength = { durationSeconds: fetched.durationSeconds };
      if (fetched.scheduledStartAt !== undefined)
        length.scheduledStartAt = fetched.scheduledStartAt;
      result[id] = length;
      if (!toCache[fetched.cacheSeconds]) toCache[fetched.cacheSeconds] = {};
      toCache[fetched.cacheSeconds][DURATION_CACHE_PREFIX + id] =
        cachedLengthValue(length);
    }
  });

  for (const ttl of Object.keys(toCache).map(Number)) {
    const values = toCache[ttl];
    const entries = Object.keys(values);
    for (let offset = 0; offset < entries.length; offset += 100) {
      const chunk: { [key: string]: string } = {};
      for (const key of entries.slice(offset, offset + 100))
        chunk[key] = values[key];
      cache.putAll(chunk, ttl);
    }
  }
  return result;
}

function cachedLengthValue(length: VideoLength): string {
  return length.scheduledStartAt !== undefined
    ? UPCOMING_CACHE_PREFIX + length.scheduledStartAt
    : String(length.durationSeconds);
}

function parseCachedLength(value: string): VideoLength {
  if (value.indexOf(UPCOMING_CACHE_PREFIX) === 0)
    return {
      durationSeconds: DURATION_UNKNOWN,
      scheduledStartAt: value.slice(UPCOMING_CACHE_PREFIX.length),
    };
  return { durationSeconds: Number(value) };
}

// One entry per batch: its lengths, or null when that request failed. All
// null when the fetch itself throws (quota, no token).
function fetchLengthBatchesInParallel(
  batches: string[][],
): ({ [id: string]: FetchedLength } | null)[] {
  if (batches.length === 0) return [];
  try {
    const headers: { [name: string]: string } = {
      Authorization: "Bearer " + ScriptApp.getOAuthToken(),
    };
    const responses: GoogleAppsScript.URL_Fetch.HTTPResponse[] =
      UrlFetchApp.fetchAll(
        batches.map(
          (batch: string[]): GoogleAppsScript.URL_Fetch.URLFetchRequest => ({
            url:
              VIDEOS_API_URL +
              "?part=" +
              encodeURIComponent(VIDEO_LENGTH_PARTS) +
              "&maxResults=" +
              DURATION_BATCH_SIZE +
              "&id=" +
              encodeURIComponent(batch.join(",")),
            headers,
            muteHttpExceptions: true,
          }),
        ),
      );
    return batches.map(
      (
        _batch: string[],
        index: number,
      ): { [id: string]: FetchedLength } | null =>
        parseVideosResponse(responses[index]),
    );
  } catch {
    return batches.map((): null => null);
  }
}

function parseVideosResponse(
  response: GoogleAppsScript.URL_Fetch.HTTPResponse | undefined,
): { [id: string]: FetchedLength } | null {
  if (!response || response.getResponseCode() !== 200) return null;
  try {
    const body = JSON.parse(
      response.getContentText(),
    ) as GoogleAppsScript.YouTube.Schema.VideoListResponse;
    if (!Array.isArray(body.items)) return null;
    return lengthsOf(body.items);
  } catch {
    return null;
  }
}

function fetchLengthBatchWithAdvancedService(
  batch: string[],
): { [id: string]: FetchedLength } | null {
  try {
    const response: GoogleAppsScript.YouTube.Schema.VideoListResponse =
      YouTube.Videos!.list(VIDEO_LENGTH_PARTS, {
        id: batch.join(","),
        maxResults: DURATION_BATCH_SIZE,
      });
    return lengthsOf(response.items ?? []);
  } catch {
    return null;
  }
}

function lengthsOf(items: GoogleAppsScript.YouTube.Schema.Video[]): {
  [id: string]: FetchedLength;
} {
  const lengths: { [id: string]: FetchedLength } = {};
  const nowMs: number = Date.now();
  for (const item of items) {
    if (!item.id) continue;
    const details: LiveStreamingDetails | undefined =
      item.liveStreamingDetails ?? undefined;
    const length: FetchedLength = {
      durationSeconds: parseIso8601Duration(
        item.contentDetails?.duration ?? "",
      ),
      cacheSeconds: videoLengthCacheSeconds(details, nowMs),
    };
    const scheduledStartAt: string | undefined = scheduledStartOf(details);
    if (scheduledStartAt !== undefined) {
      // An announced video has no length yet ("P0D"), whatever the API says.
      length.durationSeconds = DURATION_UNKNOWN;
      length.scheduledStartAt = scheduledStartAt;
    }
    lengths[item.id] = length;
  }
  return lengths;
}

// Parses an ISO 8601 duration (e.g. "PT1H2M3S", "PT45S") to whole seconds.
// Returns DURATION_UNKNOWN for an unparseable value.
function parseIso8601Duration(iso: string): number {
  const match = /^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!match) return DURATION_UNKNOWN;
  const days = Number(match[1] ?? 0);
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3] ?? 0);
  const seconds = Number(match[4] ?? 0);
  return days * 86400 + hours * 3600 + minutes * 60 + seconds;
}

/**
 * One page of top-level comments for a video. order is "relevance" or "time";
 * pageToken is "" for the first page. Returns no comments (not an error) when
 * the video has comments turned off.
 */
export function getComments(
  videoId: string,
  order: CommentOrder,
  pageToken: string,
): CommentPage {
  let response: GoogleAppsScript.YouTube.Schema.CommentThreadListResponse;
  try {
    response = YouTube.CommentThreads!.list("snippet", {
      videoId,
      maxResults: 50,
      order,
      textFormat: "plainText",
      pageToken: pageToken || undefined,
    });
  } catch (error) {
    const message = String((error as { message?: string })?.message ?? error);
    // A video with comments turned off returns "disabled comments"; that is a
    // normal empty case. Surface anything else (e.g. a missing OAuth scope)
    // instead of silently hiding it as "No comments".
    if (
      message.indexOf("disabled comments") >= 0 ||
      message.indexOf("commentsDisabled") >= 0
    ) {
      return { comments: [], nextPageToken: "" };
    }
    throw new Error(message);
  }
  const comments: VideoComment[] = [];
  for (const thread of response.items ?? []) {
    const snippet = thread.snippet?.topLevelComment?.snippet;
    if (!snippet) continue;
    comments.push({
      author: snippet.authorDisplayName ?? "",
      authorImageUrl: snippet.authorProfileImageUrl ?? "",
      text: snippet.textDisplay ?? "",
      likeCount: snippet.likeCount ?? 0,
      publishedAt: snippet.publishedAt ?? "",
    });
  }
  return { comments, nextPageToken: response.nextPageToken ?? "" };
}
