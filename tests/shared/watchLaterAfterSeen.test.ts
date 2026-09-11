// What the watched toggle leaves Watch Later membership at, on each screen and
// in each direction. This is the rule a failed request has to put back, so the
// cards never show a membership the server does not have.

import { describe, it, expect } from "vitest";
import {
  watchLaterAfterSeenToggle,
  type WatchLaterAfterSeenInput,
} from "../../src/shared/watchLaterAfterSeen";

function tap(
  input: Partial<WatchLaterAfterSeenInput> = {},
): WatchLaterAfterSeenInput {
  return {
    seenTarget: false,
    wasSaved: false,
    restoresWatchLater: false,
    ...input,
  };
}

describe("watchLaterAfterSeenToggle", () => {
  // Feed, playlists and history: marking watched drops the video from Watch
  // Later server-side, so the flag goes off wherever it was on.
  it("un-saves a saved video that the user marks watched", () => {
    expect(
      watchLaterAfterSeenToggle(tap({ seenTarget: true, wasSaved: true })),
    ).toBe(false);
  });

  // The Watch Later screen marks watched too, and its restore belongs to the
  // un-toggle. So the restore must not save the video back on the way in.
  it("un-saves on the screen that restores, when the user marks watched", () => {
    expect(
      watchLaterAfterSeenToggle(
        tap({ seenTarget: true, wasSaved: true, restoresWatchLater: true }),
      ),
    ).toBe(false);
  });

  // The Watch Later screen only: its un-toggle calls undoMarkVideoSeen, which
  // restores the playlist entry, so the card must read saved again.
  it("re-saves when the screen restores the playlist entry", () => {
    expect(watchLaterAfterSeenToggle(tap({ restoresWatchLater: true }))).toBe(
      true,
    );
  });

  // Feed, playlists and history: un-marking never re-adds, so a video that was
  // already saved as of this tap stays saved.
  it("keeps an existing membership when the screen restores nothing", () => {
    expect(watchLaterAfterSeenToggle(tap({ wasSaved: true }))).toBe(true);
  });

  // Same screens, the other membership: un-marking must not invent a save.
  it("leaves an unsaved video unsaved when the screen restores nothing", () => {
    expect(watchLaterAfterSeenToggle(tap())).toBe(false);
  });
});
