// What the watched toggle leaves Watch Later membership at, on each screen and
// in each direction. This is the rule a failed request has to put back, so the
// cards never show a membership the server does not have.

import { describe, it, expect } from "vitest";
import { watchLaterAfterSeenToggle } from "../../src/shared/watchLaterAfterSeen";

describe("watchLaterAfterSeenToggle", () => {
  // Feed, playlists, history, Watch Later: marking watched drops the video from
  // Watch Later server-side, so the flag goes off wherever it was on.
  it("un-saves whenever the video is marked watched", () => {
    expect(watchLaterAfterSeenToggle(true, true, false)).toBe(false);
    expect(watchLaterAfterSeenToggle(true, false, false)).toBe(false);
    // The Watch Later screen marks watched too: the restore belongs to the
    // un-toggle, so it must not save the video back here.
    expect(watchLaterAfterSeenToggle(true, true, true)).toBe(false);
  });

  // The Watch Later screen only: its un-toggle calls undoMarkVideoSeen, which
  // restores the playlist entry, so the card must read saved again.
  it("re-saves when the screen restores the playlist entry", () => {
    expect(watchLaterAfterSeenToggle(false, false, true)).toBe(true);
  });

  // Feed, playlists and history: un-marking never re-adds, so a video that was
  // already saved before the tap stays saved.
  it("keeps an existing membership when the screen restores nothing", () => {
    expect(watchLaterAfterSeenToggle(false, true, false)).toBe(true);
  });

  // Same screens, the other membership: un-marking must not invent a save.
  it("leaves an unsaved video unsaved when the screen restores nothing", () => {
    expect(watchLaterAfterSeenToggle(false, false, false)).toBe(false);
  });
});
