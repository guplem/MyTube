// Feed-only "dismissed" list in PropertiesService: mark, remove, dedupe, and
// the chunked storage that mirrors the watch history. See dismissed.ts.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installAppsScriptMocks, uninstallAppsScriptMocks } from "../helpers/appsScriptMock";
import {
  getDismissedVideoIds,
  markVideoDismissed,
  removeVideoDismissed,
} from "../../src/server/dismissed";

beforeEach(() => {
  installAppsScriptMocks();
});
afterEach(() => {
  uninstallAppsScriptMocks();
});

describe("dismissed list", () => {
  it("marks a video dismissed", () => {
    markVideoDismissed("a");
    expect(getDismissedVideoIds()).toEqual(["a"]);
  });

  it("does not dismiss the same video twice", () => {
    markVideoDismissed("a");
    markVideoDismissed("a");
    expect(getDismissedVideoIds()).toEqual(["a"]);
  });

  it("removes a dismissed video", () => {
    markVideoDismissed("a");
    markVideoDismissed("b");
    removeVideoDismissed("a");
    expect(getDismissedVideoIds()).toEqual(["b"]);
  });

  it("is a no-op to remove a video that was never dismissed", () => {
    markVideoDismissed("a");
    removeVideoDismissed("missing");
    expect(getDismissedVideoIds()).toEqual(["a"]);
  });

  it("round-trips a list large enough to span multiple chunk properties", () => {
    for (let i = 0; i < 500; i += 1) markVideoDismissed(`video-id-${i}`);
    const ids = getDismissedVideoIds();
    expect(ids).toHaveLength(500);
    expect(ids[0]).toBe("video-id-0");
    expect(ids[499]).toBe("video-id-499");
  });
});
