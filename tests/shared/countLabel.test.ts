import { describe, expect, it } from "vitest";
import { countLabel, groupedNumber } from "../../src/shared/countLabel";

describe("groupedNumber", (): void => {
  it("groups thousands with a comma, like the rest of the English UI", (): void => {
    expect(groupedNumber(1284)).toBe("1,284");
    expect(groupedNumber(1000000)).toBe("1,000,000");
  });

  it("leaves small numbers alone", (): void => {
    expect(groupedNumber(0)).toBe("0");
    expect(groupedNumber(999)).toBe("999");
  });
});

describe("countLabel", (): void => {
  it("uses the singular for exactly one", (): void => {
    expect(countLabel(1, "video", "videos")).toBe("1 video");
  });

  it("uses the plural for zero and for many, with grouped thousands", (): void => {
    expect(countLabel(0, "video", "videos")).toBe("0 videos");
    expect(countLabel(2, "video", "videos")).toBe("2 videos");
    expect(countLabel(1284, "video", "videos")).toBe("1,284 videos");
  });
});
