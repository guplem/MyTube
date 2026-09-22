// The community-title policy: which DeArrow title wins for a video, how the
// title text is cleaned, and which title a card or the player shows. See
// src/shared/dearrow.ts.

import { describe, expect, it } from "vitest";
import {
  chooseCommunityTitle,
  cleanCommunityTitle,
  pickDisplayTitle,
} from "../../src/shared/dearrow";
import type { Video } from "../../src/shared/video";

function entry(
  title: string,
  votes: number,
  locked: boolean = false,
  original: boolean = false,
): { title: string; votes: number; locked: boolean; original: boolean } {
  return { title, votes, locked, original };
}

describe("cleanCommunityTitle", () => {
  it("strips the keep-casing marker at the start of the title", () => {
    expect(cleanCommunityTitle(">iPhone review")).toBe("iPhone review");
  });

  it("strips the keep-casing marker after whitespace", () => {
    expect(cleanCommunityTitle("The >iPhone and >macOS")).toBe(
      "The iPhone and macOS",
    );
  });

  it("keeps a > that is not a marker", () => {
    expect(cleanCommunityTitle("A > B")).toBe("A > B");
    expect(cleanCommunityTitle("A->B")).toBe("A->B");
  });

  it("trims the result", () => {
    expect(cleanCommunityTitle("  Title  ")).toBe("Title");
  });
});

describe("chooseCommunityTitle", () => {
  it("picks a locked title over a higher-voted one", () => {
    expect(
      chooseCommunityTitle([entry("Voted", 10), entry("Locked", 0, true)]),
    ).toBe("Locked");
  });

  it("returns no title when the locked title is the original", () => {
    expect(
      chooseCommunityTitle([
        entry("Voted", 10),
        entry("Uploader title", 0, true, true),
      ]),
    ).toBe("");
  });

  it("picks the highest-voted non-original title when none is locked", () => {
    expect(
      chooseCommunityTitle([
        entry("Low", 1),
        entry("Original", 50, false, true),
        entry("High", 5),
      ]),
    ).toBe("High");
  });

  it("keeps the first title on a vote tie", () => {
    expect(chooseCommunityTitle([entry("First", 0), entry("Second", 0)])).toBe(
      "First",
    );
  });

  it("shows a title with zero votes", () => {
    expect(chooseCommunityTitle([entry("New title", 0)])).toBe("New title");
  });

  it("never shows a downvoted unlocked title", () => {
    expect(chooseCommunityTitle([entry("Downvoted", -1)])).toBe("");
  });

  it("returns no title for an empty or malformed list", () => {
    expect(chooseCommunityTitle([])).toBe("");
    expect(chooseCommunityTitle(undefined)).toBe("");
    expect(chooseCommunityTitle("not a list")).toBe("");
    expect(chooseCommunityTitle([null, { votes: 3 }, { title: 7 }])).toBe("");
  });

  it("drops a title longer than 200 characters", () => {
    expect(
      chooseCommunityTitle([entry("x".repeat(201), 9), entry("Short", 1)]),
    ).toBe("Short");
    expect(chooseCommunityTitle([entry("x".repeat(200), 9)])).toBe(
      "x".repeat(200),
    );
  });

  it("shows a title that has no votes field", () => {
    expect(chooseCommunityTitle([{ title: "T" }])).toBe("T");
  });

  it("treats only locked: true as locked", () => {
    expect(
      chooseCommunityTitle([
        { title: "Truthy lock", votes: 0, locked: 1 },
        entry("High", 5),
      ]),
    ).toBe("High");
  });

  it("never shows a title whose votes are not a number", () => {
    expect(chooseCommunityTitle([{ title: "T", votes: NaN }])).toBe("");
  });

  it("cleans the chosen title and skips one that cleans to nothing", () => {
    expect(
      chooseCommunityTitle([entry("   ", 9), entry(">macOS tips", 1)]),
    ).toBe("macOS tips");
  });
});

describe("pickDisplayTitle", () => {
  const video: Video = {
    videoId: "v1",
    title: "YOU WON'T BELIEVE THIS",
    channelId: "c1",
    channelTitle: "Channel",
    thumbnailUrl: "",
    publishedAt: "2026-01-01T00:00:00+00:00",
    seen: false,
  };

  it("shows the community title when the switch is on", () => {
    expect(
      pickDisplayTitle({ ...video, communityTitle: "A calm title" }, true),
    ).toBe("A calm title");
  });

  it("shows the YouTube title when the switch is off", () => {
    expect(
      pickDisplayTitle({ ...video, communityTitle: "A calm title" }, false),
    ).toBe(video.title);
  });

  it("shows the YouTube title when there is no community title", () => {
    expect(pickDisplayTitle(video, true)).toBe(video.title);
    expect(pickDisplayTitle({ ...video, communityTitle: "" }, true)).toBe(
      video.title,
    );
  });
});
