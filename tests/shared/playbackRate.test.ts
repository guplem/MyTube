// The stored playback speed: what a stored value means, and which speeds a
// picker offers. Two callers read the same rule (the player, which applies the
// speed, and the Settings screen, which shows it), so the rule is shared.

import { describe, it, expect } from "vitest";
import {
  DEFAULT_PLAYBACK_RATE,
  PLAYBACK_RATE_CHOICES,
  parsePlaybackRate,
  playbackRateChoices,
} from "../../src/shared/playbackRate";

describe("parsePlaybackRate", () => {
  it("reads a stored speed", () => {
    expect(parsePlaybackRate("1.5")).toBe(1.5);
  });

  // Nothing stored yet is the first-visit case: play at normal speed.
  it("falls back to normal speed when nothing is stored", () => {
    expect(parsePlaybackRate("")).toBe(DEFAULT_PLAYBACK_RATE);
  });

  it("falls back to normal speed on an unreadable value", () => {
    expect(parsePlaybackRate("fast")).toBe(DEFAULT_PLAYBACK_RATE);
  });

  // A zero or negative rate would freeze or reverse the player, and YouTube
  // rejects it anyway, so it can never become the stored speed.
  it("rejects a rate that is not above zero", () => {
    expect(parsePlaybackRate("0")).toBe(DEFAULT_PLAYBACK_RATE);
    expect(parsePlaybackRate("-2")).toBe(DEFAULT_PLAYBACK_RATE);
  });

  it("rejects an unbounded rate", () => {
    expect(parsePlaybackRate("Infinity")).toBe(DEFAULT_PLAYBACK_RATE);
  });
});

describe("playbackRateChoices", () => {
  it("offers the standard speeds when the current speed is one of them", () => {
    expect(playbackRateChoices(1.5)).toEqual(PLAYBACK_RATE_CHOICES);
  });

  // YouTube's own speed menu can report a rate our list does not carry, and the
  // player stores whatever it reports. A picker built from the list alone would
  // show a different speed than the one that plays, and the first repaint would
  // save that wrong speed over the real one.
  it("adds the current speed when it is not one of them", () => {
    expect(playbackRateChoices(1.1)).toEqual([
      0.25, 0.5, 0.75, 1, 1.1, 1.25, 1.5, 1.75, 2,
    ]);
  });

  it("keeps the list sorted when the current speed is the fastest", () => {
    expect(playbackRateChoices(3)).toEqual([
      0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 3,
    ]);
  });
});
