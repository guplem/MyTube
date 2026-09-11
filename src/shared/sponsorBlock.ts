// The sponsor-skip policy, shared so the server can clean the SponsorBlock
// answer and the browser can decide when to jump, with the rules pinned by
// tests instead of a browser. SponsorBlock is a public crowd database of
// "skip this part" time ranges inside a video (see src/server/sponsorBlock.ts).
//
// The data is community-submitted and sometimes wrong, so the rules here are
// deliberately strict: keep only the two categories the app skips, drop
// anything malformed, and merge overlaps so two entries can never fight over
// the same moment.

/** The segment kinds the player jumps past. Every other category stays. */
export type SponsorCategory = "sponsor" | "selfpromo";

/** One cleaned time range to jump past, in seconds from the video start. */
export interface SponsorSegment {
  category: SponsorCategory;
  startSeconds: number;
  endSeconds: number;
}

const SKIPPED_CATEGORIES: SponsorCategory[] = ["sponsor", "selfpromo"];

// SponsorBlock marks each entry with an actionType. Only "skip" means "jump
// past this"; "mute", "poi" (a point of interest) and "full" (a label for the
// whole video) must never move playback.
const SKIP_ACTION_TYPE = "skip";

/** The raw entry shape SponsorBlock returns, before any check. */
interface RawSponsorSegment {
  category?: unknown;
  actionType?: unknown;
  segment?: unknown;
}

/** The label the player shows for a skipped category. */
export function sponsorCategoryLabel(category: SponsorCategory): string {
  return category === "selfpromo" ? "self-promotion" : "sponsor";
}

/**
 * Cleans one video's raw SponsorBlock entries into segments the player can
 * act on: only skip actions in a skipped category, only finite ranges with a
 * real length, sorted by start time, and with overlapping or touching ranges
 * merged into one. Returns an empty list for anything unexpected, so a broken
 * answer can never move playback.
 *
 * `durationSeconds` is the video length when the caller knows it. A bad crowd
 * entry such as [0, 99999] would otherwise seek past the end, which ends the
 * video and autoplays the next one, and the viewer cannot undo that. Without a
 * duration no upper bound applies.
 */
export function normalizeSponsorSegments(
  raw: unknown,
  durationSeconds?: number,
): SponsorSegment[] {
  const limitSeconds =
    typeof durationSeconds === "number" &&
    Number.isFinite(durationSeconds) &&
    durationSeconds > 0
      ? durationSeconds
      : null;
  if (!Array.isArray(raw)) return [];

  const usable: SponsorSegment[] = [];
  for (const entry of raw as RawSponsorSegment[]) {
    if (!entry || typeof entry !== "object") continue;
    if (entry.actionType !== SKIP_ACTION_TYPE) continue;
    const category = entry.category as SponsorCategory;
    if (SKIPPED_CATEGORIES.indexOf(category) < 0) continue;
    const range = entry.segment;
    if (!Array.isArray(range) || range.length < 2) continue;
    const startSeconds = Number(range[0]);
    const endSeconds = Number(range[1]);
    if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds))
      continue;
    if (startSeconds < 0 || endSeconds <= startSeconds) continue;
    if (limitSeconds !== null && endSeconds > limitSeconds) continue;
    usable.push({ category, startSeconds, endSeconds });
  }

  usable.sort((a, b) => a.startSeconds - b.startSeconds);

  // Merge overlapping and touching ranges. Two entries that both cover a
  // moment would otherwise each ask for a jump, and the second jump would
  // land the viewer back inside the first. The merged range keeps the
  // category of the entry that starts first, which is the one the viewer
  // reaches.
  const merged: SponsorSegment[] = [];
  for (const segment of usable) {
    const last = merged[merged.length - 1];
    if (last && segment.startSeconds <= last.endSeconds) {
      last.endSeconds = Math.max(last.endSeconds, segment.endSeconds);
      continue;
    }
    merged.push({ ...segment });
  }
  return merged;
}

/** What the player must do at one playback position. */
export interface SponsorSkipDecision {
  /** The segment to jump past now, or null when nothing must move. */
  segment: SponsorSegment | null;
  /** The value the caller must keep as its last-jumped memory. */
  lastSkippedStartSeconds: number | null;
}

/**
 * Decides whether the player must jump past a segment at this position, and
 * what the last-jumped memory becomes.
 *
 * Three rules, all here so a browser is not needed to test them:
 *
 * 1. `ignoredStartSeconds` holds the start times of the segments the viewer
 *    undid. They stay ignored for the rest of the video. Segments never
 *    overlap after normalizeSponsorSegments, so the start time is a stable id.
 * 2. `lastSkippedStartSeconds` is the segment the player jumped past last. The
 *    same segment is never jumped twice in a row, so a viewer who rewinds into
 *    it keeps the rewind.
 * 3. The memory clears when the position is outside every segment. An
 *    unreadable position is not a position outside every segment, so it keeps
 *    the memory.
 */
export function sponsorSkipDecision(
  segments: SponsorSegment[],
  positionSeconds: number,
  ignoredStartSeconds: number[],
  lastSkippedStartSeconds: number | null,
): SponsorSkipDecision {
  if (!Number.isFinite(positionSeconds)) {
    return { segment: null, lastSkippedStartSeconds };
  }
  for (const segment of segments) {
    if (positionSeconds < segment.startSeconds) break; // sorted: no later match
    if (positionSeconds >= segment.endSeconds) continue;
    if (ignoredStartSeconds.indexOf(segment.startSeconds) >= 0) continue;
    if (segment.startSeconds === lastSkippedStartSeconds) {
      return { segment: null, lastSkippedStartSeconds };
    }
    return { segment, lastSkippedStartSeconds: segment.startSeconds };
  }
  return { segment: null, lastSkippedStartSeconds: null };
}
