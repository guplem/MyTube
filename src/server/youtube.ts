// Reads the user's subscriptions through the YouTube advanced service.
//
// We call the API only to learn which channels the user is subscribed to, and we
// cache that list per user. The actual videos come from each channel's RSS feed
// (see feed.ts), which costs no API quota. See PLAN.md section 5.

import type { Video } from "../shared/video";
import type { PlaylistSummary } from "../shared/playlist";
import type { VideoComment } from "../shared/comment";

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
export function getSubscriptionChannels(forceRefresh: boolean): SubscriptionChannel[] {
  const properties = PropertiesService.getUserProperties();
  if (!forceRefresh) {
    const cached = properties.getProperty(CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached) as CachedChannels;
      if (Date.now() - parsed.fetchedAt < CACHE_TTL_MS) return parsed.channels;
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
      YouTube.Playlists!.list("snippet,contentDetails", { mine: true, maxResults: 50, pageToken });
    for (const item of response.items ?? []) {
      if (!item.id) continue;
      playlists.push({
        playlistId: item.id,
        title: item.snippet?.title ?? "",
        itemCount: item.contentDetails?.itemCount ?? 0,
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
      YouTube.PlaylistItems!.list("snippet,contentDetails", { playlistId, maxResults: 50, pageToken });
    for (const item of response.items ?? []) {
      // videoOwnerChannel* are the actual uploader; they exist in the API
      // response but are missing from this @types version, so widen the type.
      const snippet = item.snippet as
        | (GoogleAppsScript.YouTube.Schema.PlaylistItemSnippet & {
            videoOwnerChannelId?: string;
            videoOwnerChannelTitle?: string;
          })
        | undefined;
      const videoId = snippet?.resourceId?.videoId ?? item.contentDetails?.videoId;
      if (!videoId || !snippet) continue;
      videos.push({
        videoId,
        title: snippet.title ?? "",
        channelId: snippet.videoOwnerChannelId ?? snippet.channelId ?? "",
        channelTitle: snippet.videoOwnerChannelTitle ?? snippet.channelTitle ?? "",
        thumbnailUrl: bestThumbnailUrl(snippet.thumbnails),
        // Use the video's real upload date (contentDetails.videoPublishedAt),
        // not snippet.publishedAt, which is the date it was added to the playlist.
        publishedAt: item.contentDetails?.videoPublishedAt ?? snippet.publishedAt ?? "",
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
  const created: GoogleAppsScript.YouTube.Schema.Playlist = YouTube.Playlists!.insert(
    {
      snippet: { title: WATCH_LATER_TITLE, description: "Managed by MyTube." },
      status: { privacyStatus: "private" },
    },
    "snippet,status",
  );
  const id = created.id ?? "";
  if (id) properties.setProperty(WATCH_LATER_ID_KEY, id);
  return id;
}

/** The Watch Later playlist id if it already exists, or "" without creating one. */
function findWatchLaterPlaylistId(): string {
  return PropertiesService.getUserProperties().getProperty(WATCH_LATER_ID_KEY) ?? "";
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
  cache.put(WATCH_LATER_IDS_CACHE_KEY, JSON.stringify(ids), WATCH_LATER_IDS_TTL_SECONDS);
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
    cache.put(WATCH_LATER_IDS_CACHE_KEY, JSON.stringify(next), WATCH_LATER_IDS_TTL_SECONDS);
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

/** Removes the first Watch Later item matching the video id. */
export function removeFromWatchLater(videoId: string): void {
  const playlistId = getWatchLaterPlaylistId();
  let pageToken: string | undefined = undefined;
  do {
    const response: GoogleAppsScript.YouTube.Schema.PlaylistItemListResponse =
      YouTube.PlaylistItems!.list("snippet", { playlistId, maxResults: 50, pageToken });
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
  return thumbnails.medium?.url ?? thumbnails.default?.url ?? thumbnails.high?.url ?? "";
}

const DURATION_CACHE_PREFIX = "dur:";
const DURATION_CACHE_TTL_SECONDS = 21600; // 6h, the CacheService maximum
const DURATION_UNKNOWN = -1; // cached for ids the API does not return (deleted/private/live)

/**
 * Length in seconds for each video id, used to detect Shorts. RSS gives no
 * duration, so we ask the Data API (part=contentDetails, 1 quota unit per 50
 * ids). Results are cached in the shared script cache because a video's length
 * is the same for every user, so most lookups are free after the first.
 */
export function getVideoDurationsSeconds(videoIds: string[]): { [id: string]: number } {
  const result: { [id: string]: number } = {};
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
    if (hit !== undefined && hit !== null) result[id] = Number(hit);
    else missing.push(id);
  }

  const toCache: { [key: string]: string } = {};
  for (let offset = 0; offset < missing.length; offset += 50) {
    const batch = missing.slice(offset, offset + 50);
    const response: GoogleAppsScript.YouTube.Schema.VideoListResponse =
      YouTube.Videos!.list("contentDetails", { id: batch.join(","), maxResults: 50 });
    const returned = new Set<string>();
    for (const item of response.items ?? []) {
      if (!item.id) continue;
      const seconds = parseIso8601Duration(item.contentDetails?.duration ?? "");
      result[item.id] = seconds;
      toCache[DURATION_CACHE_PREFIX + item.id] = String(seconds);
      returned.add(item.id);
    }
    // Cache a sentinel for ids the API skipped so we do not re-query them.
    for (const id of batch) {
      if (!returned.has(id)) {
        result[id] = DURATION_UNKNOWN;
        toCache[DURATION_CACHE_PREFIX + id] = String(DURATION_UNKNOWN);
      }
    }
  }

  const entries = Object.keys(toCache);
  for (let offset = 0; offset < entries.length; offset += 100) {
    const chunk: { [key: string]: string } = {};
    for (const key of entries.slice(offset, offset + 100)) chunk[key] = toCache[key];
    cache.putAll(chunk, DURATION_CACHE_TTL_SECONDS);
  }
  return result;
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

/** Top-level comments for a video, most relevant first. Empty if comments are disabled. */
export function getComments(videoId: string): VideoComment[] {
  let response: GoogleAppsScript.YouTube.Schema.CommentThreadListResponse;
  try {
    response = YouTube.CommentThreads!.list("snippet", {
      videoId,
      maxResults: 50,
      order: "relevance",
      textFormat: "plainText",
    });
  } catch (error) {
    const message = String((error as { message?: string })?.message ?? error);
    // A video with comments turned off returns "disabled comments"; that is a
    // normal empty case. Surface anything else (e.g. a missing OAuth scope)
    // instead of silently hiding it as "No comments".
    if (message.indexOf("disabled comments") >= 0 || message.indexOf("commentsDisabled") >= 0) {
      return [];
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
  return comments;
}
