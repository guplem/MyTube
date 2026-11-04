// The stored caption size: what a stored value means, and the sizes the
// Settings picker offers. The player applies the size through YouTube's
// captions module, which takes a step from YouTube's own size menu.

import { describe, it, expect } from "vitest";
import {
  CAPTION_REFERENCE_HEIGHT,
  CAPTION_SIZE_CHOICES,
  captionSizeStep,
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

describe("captionSizeStep", () => {
  // The normal desktop player: 900px wide (.player-view in index.html), 16:9.
  it("pins the reference height to the normal desktop player", () => {
    expect(CAPTION_REFERENCE_HEIGHT).toBe((900 * 9) / 16);
  });

  // A player no taller than the normal one keeps the chosen step: YouTube's
  // own scaling is right there, and a phone needs no larger text.
  it("keeps the chosen step in a player no taller than the normal one", () => {
    expect(captionSizeStep(0, CAPTION_REFERENCE_HEIGHT)).toBe(0);
    expect(captionSizeStep(-1, 220)).toBe(-1);
    expect(captionSizeStep(1, 220)).toBe(1);
  });

  // Theater mode or fullscreen on a 1080p screen: about twice the height, so
  // YouTube doubles the captions. Half size cancels that.
  it("halves the captions in a player twice as tall", () => {
    expect(captionSizeStep(0, CAPTION_REFERENCE_HEIGHT * 2)).toBe(-2);
    expect(captionSizeStep(2, CAPTION_REFERENCE_HEIGHT * 2)).toBe(0);
  });

  // 1.5x taller wants 67%: 75% is nearer than 50% (on a ratio scale).
  it("picks the nearest step on a ratio scale", () => {
    expect(captionSizeStep(0, CAPTION_REFERENCE_HEIGHT * 1.5)).toBe(-1);
  });

  it("stops at the smallest step", () => {
    expect(captionSizeStep(-2, CAPTION_REFERENCE_HEIGHT * 3)).toBe(-2);
  });

  // A player not laid out yet reports 0: keep the chosen step.
  it("keeps the chosen step for a height it cannot use", () => {
    expect(captionSizeStep(-1, 0)).toBe(-1);
    expect(captionSizeStep(-1, Number.NaN)).toBe(-1);
  });
});
