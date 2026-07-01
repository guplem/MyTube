// Chapters parsed out of a video description. YouTube has no chapter API, so
// like Shorts detection (length, not a flag) we infer them from the text: the
// same "clearly labeled timestamps" the player already linkifies, grouped into
// a scrollable strip. A chapter is a description line that is a timestamp plus a
// label (either order); we need at least two to treat the description as
// chaptered, so a stray inline timestamp does not conjure a one-item strip.

export interface Chapter {
  /** Start time in seconds, parsed from the timestamp. */
  seconds: number;
  /** The line's text with the timestamp and separators stripped. */
  label: string;
  /** The timestamp exactly as written, e.g. "1:23" or "1:02:03". */
  timestampText: string;
}

// A timestamp anchored at the start of a line (after optional brackets/space):
// "0:00 Intro", "[0:00] Intro", "(0:00) Intro".
const LEADING_TIMESTAMP = /^[\s[(]*(\d{1,2}:[0-5]\d(?::[0-5]\d)?)(.*)$/;
// A timestamp anchored at the end of a line: "Intro - 0:00", "Intro (0:00)".
const TRAILING_TIMESTAMP = /^(.*?)(\d{1,2}:[0-5]\d(?::[0-5]\d)?)[\s\])]*$/;

// Leading/trailing separators that sit between a label and its timestamp.
const LEADING_SEPARATORS = /^[\s\-–—·•:|)\].]+/;
const TRAILING_SEPARATORS = /[\s\-–—·•:|([]+$/;

function timestampToSeconds(timestamp: string): number {
  const parts = timestamp.split(":").map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return parts[0] * 60 + parts[1];
}

function stripSeparators(label: string): string {
  return label.replace(LEADING_SEPARATORS, "").replace(TRAILING_SEPARATORS, "").trim();
}

/**
 * Extract chapters from a video description. Returns [] when the description has
 * no recognizable chapter list (fewer than two labeled timestamps). The result
 * is sorted ascending by start time so callers can find the current chapter with
 * a simple scan.
 */
export function parseChapters(description: string): Chapter[] {
  if (!description) return [];
  const chapters: Chapter[] = [];
  for (const rawLine of description.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    let timestampText: string;
    let label: string;
    const leading = LEADING_TIMESTAMP.exec(line);
    const trailing = leading ? null : TRAILING_TIMESTAMP.exec(line);
    if (leading) {
      timestampText = leading[1];
      label = leading[2];
    } else if (trailing) {
      timestampText = trailing[2];
      label = trailing[1];
    } else {
      continue;
    }

    label = stripSeparators(label);
    if (!label) continue; // a bare timestamp with no title is not a chapter
    chapters.push({ seconds: timestampToSeconds(timestampText), label, timestampText });
  }

  if (chapters.length < 2) return [];
  return chapters.sort((a, b) => a.seconds - b.seconds);
}
