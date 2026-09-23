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

// A longer title is not a title a card can show; it is spam or broken data.
const MAX_TITLE_LENGTH = 200;

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

/** One DeArrow title submission for a video, after the checks. */
export interface DeArrowSubmission {
  title: string;
  votes: number;
  locked: boolean;
  original: boolean;
}

/** The answer of one submissions lookup. "failed" is not the same as "ok"
 *  with no submissions: the Info tab tells the two apart. */
export type DeArrowSubmissionsResult =
  { status: "ok"; submissions: DeArrowSubmission[] } | { status: "failed" };

/**
 * Checks and cleans one video's raw DeArrow `titles` list, in the order that
 * DeArrow sends it. Drops an entry that is not an object, has no string title,
 * cleans to nothing, or is over-long. A votes field that is not a number reads
 * as 0. A votes number that is not finite is broken data, so the entry drops.
 * Only `true` counts as locked or original.
 */
export function parseDeArrowSubmissions(raw: unknown): DeArrowSubmission[] {
  if (!Array.isArray(raw)) return [];

  const submissions: DeArrowSubmission[] = [];
  for (const entry of raw as RawCommunityTitle[]) {
    if (!entry || typeof entry !== "object") continue;
    if (typeof entry.title !== "string") continue;
    const title = cleanCommunityTitle(entry.title);
    if (!title || title.length > MAX_TITLE_LENGTH) continue;
    const votes = typeof entry.votes === "number" ? entry.votes : 0;
    if (!Number.isFinite(votes)) continue;
    submissions.push({
      title,
      votes,
      locked: entry.locked === true,
      original: entry.original === true,
    });
  }
  return submissions;
}

/** Why the policy picked a submission, or why it picked none. */
export type CommunityTitleReason =
  | "locked"
  | "top-voted"
  | "no-submissions"
  | "locked-original"
  | "only-original"
  | "all-downvoted";

/** The submission that the policy picks (`index`, -1 for none) and why. */
export interface CommunityTitleChoice {
  index: number;
  reason: CommunityTitleReason;
}

/**
 * Applies the title policy to the checked submissions of one video. The
 * player Info tab shows the reason, so a viewer can see why a video keeps its
 * YouTube title.
 */
export function explainCommunityTitle(
  submissions: DeArrowSubmission[],
): CommunityTitleChoice {
  if (submissions.length === 0) return { index: -1, reason: "no-submissions" };

  const locked = submissions.findIndex(
    (submission: DeArrowSubmission): boolean => submission.locked,
  );
  if (locked >= 0) {
    return submissions[locked].original
      ? { index: -1, reason: "locked-original" }
      : { index: locked, reason: "locked" };
  }

  let best = -1;
  let hasOtherTitle = false;
  submissions.forEach((submission: DeArrowSubmission, index: number): void => {
    if (submission.original) return;
    hasOtherTitle = true;
    if (submission.votes < 0) return;
    // Strictly greater, so a tie keeps the earlier entry (DeArrow lists its
    // best title first).
    if (best < 0 || submission.votes > submissions[best].votes) best = index;
  });
  if (best >= 0) return { index: best, reason: "top-voted" };
  return {
    index: -1,
    reason: hasOtherTitle ? "all-downvoted" : "only-original",
  };
}

/**
 * Picks the community title to show from one video's raw DeArrow `titles`
 * list. Returns "" when nothing must show: an empty or malformed list, only
 * downvoted or over-long titles, or a locked ORIGINAL title (the moderators say the
 * uploader's title is fine).
 */
export function chooseCommunityTitle(raw: unknown): string {
  const submissions = parseDeArrowSubmissions(raw);
  const choice = explainCommunityTitle(submissions);
  return choice.index >= 0 ? submissions[choice.index].title : "";
}

/** The title that a card or the player shows for a video. */
export function pickDisplayTitle(video: Video, useCommunity: boolean): string {
  if (useCommunity && video.communityTitle) return video.communityTitle;
  return video.title;
}

/** The hover text of a shown title: the YouTube title when the shown title is
 *  a different one, so the original stays reachable. Else "". */
export function originalTitleHint(video: Video, shown: string): string {
  return shown === video.title ? "" : "YouTube title: " + video.title;
}
