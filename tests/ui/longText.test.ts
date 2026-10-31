// Worst-case text in the app stylesheet. Titles, channel names, playlist
// names, and comment handles come from YouTube, and some have no spaces
// (a long hashtag run, a URL-like title). With no break point, such text
// overflows its box and, on a phone, makes the whole page scroll sideways.
// Every class that shows such text must let it break anywhere.

import { describe, expect, it } from "vitest";
import { appStyleRules, type StyleRule } from "../helpers/stylesheet";

// Add a class here when it starts to show text from YouTube or a user.
const REMOTE_TEXT: string[] = [
  ".video-title",
  ".video-channel",
  ".player-title",
  ".playlist-item",
  ".player-desc",
  ".comment-author",
  ".comment-text",
  ".info-list dd",
  ".info-submission-title",
];

const rules: StyleRule[] = appStyleRules();

describe("text from YouTube", (): void => {
  it.each(REMOTE_TEXT)(
    "%s breaks a long unbroken word",
    (selector: string): void => {
      const wraps: boolean = rules.some(
        (rule: StyleRule): boolean =>
          rule.conditions.length === 0 &&
          rule.selectors.includes(selector) &&
          rule.declarations.get("overflow-wrap") === "anywhere",
      );
      expect(wraps).toBe(true);
    },
  );

  it.each(REMOTE_TEXT)(
    "%s is not made unbreakable again by a later rule",
    (selector: string): void => {
      const undoing: string[] = rules
        .filter((rule: StyleRule): boolean =>
          rule.selectors.some((candidate: string): boolean =>
            candidate.endsWith(selector),
          ),
        )
        .filter((rule: StyleRule): boolean => {
          const wrap: string | undefined =
            rule.declarations.get("overflow-wrap");
          return (
            (wrap !== undefined && wrap !== "anywhere") ||
            rule.declarations.get("white-space") === "nowrap"
          );
        })
        .flatMap((rule: StyleRule): string[] => rule.selectors);
      expect(undoing).toEqual([]);
    },
  );
});
