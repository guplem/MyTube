// The stored caption size: what a stored value means, and the sizes the
// Settings picker offers. The player applies the size through YouTube's
// captions module, which takes a step from YouTube's own size menu.

import { describe, it, expect } from "vitest";
import {
  CAPTION_SIZE_CHOICES,
  DEFAULT_CAPTION_SIZE,
  parseCaptionSize,
} from "../../src/shared/captionSize";

describe("parseCaptionSize", () => {
  it("reads a stored size", () => {
    expect(parseCaptionSize("-1")).toBe(-1);
  });

  // 0 is YouTube's own size, so the first visit looks exactly like YouTube.
  // The other tests read the constant, so only this one pins it.
  it("falls back to exactly YouTube's own size", () => {
    expect(DEFAULT_CAPTION_SIZE).toBe(0);
  });

  it("falls back to YouTube's own size when nothing is stored", () => {
    expect(parseCaptionSize("")).toBe(DEFAULT_CAPTION_SIZE);
  });

  // Number, not parseInt: "-1px" is not a value we wrote.
  it("falls back on an unreadable value", () => {
    expect(parseCaptionSize("-1px")).toBe(DEFAULT_CAPTION_SIZE);
    expect(parseCaptionSize("abc")).toBe(DEFAULT_CAPTION_SIZE);
  });

  // A step the picker does not offer would show one size and apply another.
  it("falls back on a step the picker does not offer", () => {
    expect(parseCaptionSize("0.5")).toBe(DEFAULT_CAPTION_SIZE);
    expect(parseCaptionSize("9")).toBe(DEFAULT_CAPTION_SIZE);
  });
});

describe("CAPTION_SIZE_CHOICES", () => {
  it("offers YouTube's menu steps from 50% to 200%, smallest first", () => {
    expect(CAPTION_SIZE_CHOICES.map((c) => [c.step, c.label])).toEqual([
      [-2, "50%"],
      [-1, "75%"],
      [0, "100%"],
      [1, "150%"],
      [2, "200%"],
    ]);
  });
});
