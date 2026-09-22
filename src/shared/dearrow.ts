// The community-title policy, shared so the server can pick a title from the
// DeArrow answer and the browser can choose which title to show, with the
// rules pinned by tests instead of a browser. DeArrow is a public crowd
// database of better (less clickbait) video titles, run by the SponsorBlock
// project (see src/server/dearrow.ts).
//
// The titles are community-submitted, so the rules follow DeArrow's own
// client: a locked title (set by a DeArrow moderator) wins, else the highest
// vote wins, and a downvoted title never shows.

import type { Video } from "./video";

/** The raw title entry shape DeArrow returns, before any check. */
interface RawCommunityTitle {
  title?: unknown;
  original?: unknown;
  votes?: unknown;
  locked?: unknown;
}

/**
 * Cleans one DeArrow title for display. DeArrow writes ">" before a word to
 * mean "keep the casing of this word", and its own client removes the marker.
 * Only a ">" at the start or after whitespace, and before a non-space
 * character, is a marker; every other ">" is part of the title.
 */
export function cleanCommunityTitle(raw: string): string {
  return raw.replace(/(^|\s)>(?=\S)/g, "$1").trim();
}

/**
 * Picks the community title to show from one video's raw DeArrow `titles`
 * list. Returns "" when nothing must show: an empty or malformed list, only
 * downvoted titles, or a locked ORIGINAL title (the moderators say the
 * uploader's title is fine).
 */
export function chooseCommunityTitle(raw: unknown): string {
  if (!Array.isArray(raw)) return "";

  const usable: { text: string; entry: RawCommunityTitle }[] = [];
  for (const entry of raw as RawCommunityTitle[]) {
    if (!entry || typeof entry !== "object") continue;
    if (typeof entry.title !== "string") continue;
    const text = cleanCommunityTitle(entry.title);
    if (!text) continue;
    usable.push({ text, entry });
  }

  const locked = usable.find(
    (candidate: { entry: RawCommunityTitle }): boolean =>
      candidate.entry.locked === true,
  );
  if (locked) return locked.entry.original === true ? "" : locked.text;

  let best: { text: string; votes: number } | null = null;
  for (const { text, entry } of usable) {
    if (entry.original === true) continue;
    const votes = typeof entry.votes === "number" ? entry.votes : 0;
    if (!Number.isFinite(votes) || votes < 0) continue;
    // Strictly greater, so a tie keeps the earlier entry (DeArrow lists its
    // best title first).
    if (!best || votes > best.votes) best = { text, votes };
  }
  return best ? best.text : "";
}

/** The title that a card or the player shows for a video. */
export function pickDisplayTitle(video: Video, useCommunity: boolean): string {
  if (useCommunity && video.communityTitle) return video.communityTitle;
  return video.title;
}
