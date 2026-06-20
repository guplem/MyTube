// Reads the user's subscriptions through the YouTube advanced service.
//
// We call the API only to learn which channels the user is subscribed to, and we
// cache that list per user. The actual videos come from each channel's RSS feed
// (see feed.ts), which costs no API quota. See PLAN.md section 5.

import type { Video } from "../shared/video";
import type { PlaylistSummary } from "../shared/playlist";

export interface SubscriptionChannel {
  channelId: string;
  title: string;
}

const WATCH_LATER_ID_KEY = "watchLaterPlaylistId";
const WATCH_LATER_TITLE = "MyTube — Watch Later";

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
        publishedAt: snippet.publishedAt ?? "",
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
