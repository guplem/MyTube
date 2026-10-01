// The lock-screen rule: which pauses the player undoes. YouTube's embed pauses
// itself when the page goes hidden; the player plays again only for a pause
// that lands close to the moment the page hid.

import { describe, it, expect } from "vitest";
import {
  BACKGROUND_PAUSE_WINDOW_MS,
  shouldResumeAfterHide,
} from "../../src/shared/backgroundPlay";

describe("shouldResumeAfterHide", () => {
  it("resumes a pause that comes just after the page hid", () => {
    expect(shouldResumeAfterHide(10_000, 10_300)).toBe(true);
  });

  // The embed can pause before the browser reports the page as hidden.
  it("resumes a pause that comes just before the page hid", () => {
    expect(shouldResumeAfterHide(10_300, 10_000)).toBe(true);
  });

  it("resumes at the edge of the window", () => {
    expect(shouldResumeAfterHide(0, BACKGROUND_PAUSE_WINDOW_MS)).toBe(true);
  });

  // A pause from the lock-screen controls comes long after the page hid.
  it("keeps a later pause", () => {
    expect(shouldResumeAfterHide(0, BACKGROUND_PAUSE_WINDOW_MS + 1)).toBe(
      false,
    );
  });

  // A pause the viewer made on screen, long before the phone locked.
  it("keeps an earlier pause", () => {
    expect(shouldResumeAfterHide(BACKGROUND_PAUSE_WINDOW_MS + 1, 0)).toBe(
      false,
    );
  });

  it("keeps a pause when the page never hid", () => {
    expect(shouldResumeAfterHide(null, 5_000)).toBe(false);
  });

  it("keeps a page hide with no pause", () => {
    expect(shouldResumeAfterHide(5_000, null)).toBe(false);
  });

  // The window must stay short, or it would undo real lock-screen pauses.
  it("uses a window of about one second", () => {
    expect(BACKGROUND_PAUSE_WINDOW_MS).toBe(1500);
  });
});
