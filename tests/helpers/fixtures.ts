// Test fixtures: builders for YouTube RSS XML, Data API responses, and Video
// objects. Keeping each wire shape in one place means a format change is a
// one-line fixture edit.

import type { Video } from "../../src/shared/video";

export interface RssEntry {
  videoId: string;
  title: string;
  channelId: string;
  channelTitle: string;
  thumbnailUrl?: string;
  publishedAt: string;
}

/** A channel's Atom RSS feed in the exact namespaced shape YouTube serves. */
export function channelRss(entries: RssEntry[]): string {
  const items = entries
    .map(
      (e) => `
  <entry>
    <id>yt:video:${e.videoId}</id>
    <yt:videoId>${e.videoId}</yt:videoId>
    <yt:channelId>${e.channelId}</yt:channelId>
    <title>${e.title}</title>
    <author><name>${e.channelTitle}</name></author>
    <published>${e.publishedAt}</published>
    <media:group>
      <media:thumbnail url="${e.thumbnailUrl ?? `https://i.ytimg.com/vi/${e.videoId}/hqdefault.jpg`}"/>
    </media:group>
  </entry>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015"
      xmlns:media="http://search.yahoo.com/mrss/"
      xmlns="http://www.w3.org/2005/Atom">
  <title>Channel feed</title>${items}
</feed>`;
}

/** One PlaylistItems.list page shaped like the real API for the given video ids. */
export function playlistItemsPage(videoIds: string[]): { items: unknown[] } {
  return {
    items: videoIds.map((videoId) => ({
      id: `item-${videoId}`,
      snippet: { title: videoId, resourceId: { videoId }, thumbnails: {} },
      contentDetails: { videoId },
    })),
  };
}

/** A Video with sensible defaults; override any field. */
export function makeVideo(overrides: Partial<Video> = {}): Video {
  return {
    videoId: "vid",
    title: "Title",
    channelId: "chan",
    channelTitle: "Channel",
    thumbnailUrl: "https://i.ytimg.com/vi/vid/hqdefault.jpg",
    publishedAt: "2026-06-20T10:00:00+00:00",
    seen: false,
    ...overrides,
  };
}
