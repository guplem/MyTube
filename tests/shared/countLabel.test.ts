import { afterEach, describe, expect, it, vi } from "vitest";
import {
  compactNumber,
  countLabel,
  groupedNumber,
} from "../../src/shared/countLabel";

afterEach((): void => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

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

describe("grouping in a non-English browser", (): void => {
  it("stays English, because the copy around it is English", async (): Promise<void> => {
    // CI runs in en-US, so make "the browser's locale" German: a formatter
    // asked for no locale groups with a dot, as a German browser would.
    const RealNumberFormat: typeof Intl.NumberFormat = Intl.NumberFormat;
    vi.stubGlobal("Intl", {
      ...Intl,
      // A plain function, not an arrow, so `new Intl.NumberFormat()` works:
      // `new` returns the object the function returns.
      NumberFormat: function (
        locale?: string | string[],
        options?: Intl.NumberFormatOptions,
      ): Intl.NumberFormat {
        return new RealNumberFormat(locale ?? "de-DE", options);
      },
    });
    // toLocaleString with no locale reads the browser locale too.
    vi.spyOn(Number.prototype, "toLocaleString").mockImplementation(function (
      this: number,
      locale?: string | string[],
      options?: Intl.NumberFormatOptions,
    ): string {
      return new RealNumberFormat(locale ?? "de-DE", options).format(this);
    });
    vi.resetModules();
    const fresh: typeof import("../../src/shared/countLabel") =
      await import("../../src/shared/countLabel");
    expect(fresh.groupedNumber(1284)).toBe("1,284");
  });
});

describe("compactNumber", (): void => {
  it("keeps numbers under a thousand as they are", (): void => {
    expect(compactNumber(0)).toBe("0");
    expect(compactNumber(999)).toBe("999");
  });

  it("shortens thousands and millions to one decimal, dropping a .0", (): void => {
    expect(compactNumber(1000)).toBe("1K");
    expect(compactNumber(1284)).toBe("1.3K");
    expect(compactNumber(1200000)).toBe("1.2M");
    expect(compactNumber(3000000)).toBe("3M");
  });
});
