// Whether a server mutation leaves the kept feed page correct. The rule turns on
// object identity: the page survives only when the screen the user acted on was
// working on the page's OWN Video objects.

import { describe, it, expect } from "vitest";
import {
  feedPageSurvivesMutation,
  type FeedMutationScreen,
} from "../../src/shared/feedPageStaleness";

function screen(overrides: Partial<FeedMutationScreen>): FeedMutationScreen {
  return {
    inFeedSection: false,
    isPlayer: false,
    playerQueueIsFeedPage: false,
    ...overrides,
  };
}

describe("feedPageSurvivesMutation", () => {
  it("keeps the page for a toggle on the feed list itself", () => {
    expect(feedPageSurvivesMutation(screen({ inFeedSection: true }))).toBe(
      true,
    );
  });

  it("keeps the page for a player the feed list handed its own queue to", () => {
    expect(
      feedPageSurvivesMutation(
        screen({
          inFeedSection: true,
          isPlayer: true,
          playerQueueIsFeedPage: true,
        }),
      ),
    ).toBe(true);
  });

  // Browser back/forward re-renders the player from google.script.history, which
  // serializes the queue across the Apps Script iframe, and a forward navigation
  // with no queue rebuilds a fresh one. Either way the player mutates copies —
  // and so does a player whose queue WAS the kept page until a warm-up replaced
  // it, which is why the caller re-asks the cache instead of remembering a flag.
  it("drops the page for a feed player whose queue is not the kept page", () => {
    expect(
      feedPageSurvivesMutation(
        screen({
          inFeedSection: true,
          isPlayer: true,
          playerQueueIsFeedPage: false,
        }),
      ),
    ).toBe(false);
  });

  it("drops the page for a toggle on another list screen", () => {
    expect(feedPageSurvivesMutation(screen({}))).toBe(false);
  });

  it("drops the page for a player opened from another list", () => {
    expect(feedPageSurvivesMutation(screen({ isPlayer: true }))).toBe(false);
  });

  it("drops the page outside the feed section even if the queue flag is set", () => {
    expect(
      feedPageSurvivesMutation(
        screen({ isPlayer: true, playerQueueIsFeedPage: true }),
      ),
    ).toBe(false);
  });
});
