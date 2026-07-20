import { describe, it, expect } from "vitest";
import { parseChapters } from "../../src/shared/chapters";

describe("parseChapters", () => {
  it("parses a standard leading-timestamp chapter list", () => {
    const description = ["0:00 Intro", "1:30 First topic", "5:05 Wrap up"].join(
      "\n",
    );
    expect(parseChapters(description)).toEqual([
      { seconds: 0, label: "Intro", timestampText: "0:00" },
      { seconds: 90, label: "First topic", timestampText: "1:30" },
      { seconds: 305, label: "Wrap up", timestampText: "5:05" },
    ]);
  });

  it("parses H:MM:SS timestamps", () => {
    const description = ["0:00 Start", "1:02:03 Later"].join("\n");
    expect(parseChapters(description)).toEqual([
      { seconds: 0, label: "Start", timestampText: "0:00" },
      { seconds: 3723, label: "Later", timestampText: "1:02:03" },
    ]);
  });

  it("strips dash and colon separators between timestamp and label", () => {
    const description = ["0:00 - Intro", "2:00 : Middle"].join("\n");
    expect(parseChapters(description)).toEqual([
      { seconds: 0, label: "Intro", timestampText: "0:00" },
      { seconds: 120, label: "Middle", timestampText: "2:00" },
    ]);
  });

  it("supports labels written before the timestamp", () => {
    const description = ["Intro - 0:00", "Deep dive - 3:45"].join("\n");
    expect(parseChapters(description)).toEqual([
      { seconds: 0, label: "Intro", timestampText: "0:00" },
      { seconds: 225, label: "Deep dive", timestampText: "3:45" },
    ]);
  });

  it("handles bracketed timestamps", () => {
    const description = ["[0:00] Intro", "[4:20] Topic"].join("\n");
    expect(parseChapters(description)).toEqual([
      { seconds: 0, label: "Intro", timestampText: "0:00" },
      { seconds: 260, label: "Topic", timestampText: "4:20" },
    ]);
  });

  it("ignores timestamps buried mid-line (prose, not a chapter list)", () => {
    const description = [
      "Check the discount at 5:00 today only",
      "Thanks for watching at 2:30 mark",
    ].join("\n");
    expect(parseChapters(description)).toEqual([]);
  });

  it("ignores a description with a single labeled timestamp", () => {
    expect(parseChapters("0:00 Intro\nSubscribe for more!")).toEqual([]);
  });

  it("ignores bare timestamps with no label", () => {
    // Two bare timestamps and one real chapter -> only one chapter -> not chaptered.
    expect(parseChapters("0:00\n1:23\nSome text")).toEqual([]);
  });

  it("sorts chapters ascending by start time", () => {
    const description = ["5:00 Third", "0:00 First", "2:00 Second"].join("\n");
    expect(parseChapters(description).map((c) => c.label)).toEqual([
      "First",
      "Second",
      "Third",
    ]);
  });

  it("returns [] for empty or non-chaptered descriptions", () => {
    expect(parseChapters("")).toEqual([]);
    expect(
      parseChapters("Just a normal description with no timestamps."),
    ).toEqual([]);
  });

  it("keeps chapters mixed with surrounding description text", () => {
    const description = [
      "Welcome to the video!",
      "",
      "Chapters:",
      "0:00 Intro",
      "1:15 Setup",
      "3:40 Demo",
      "",
      "Follow me on social media",
    ].join("\n");
    expect(parseChapters(description).map((c) => c.label)).toEqual([
      "Intro",
      "Setup",
      "Demo",
    ]);
  });
});
