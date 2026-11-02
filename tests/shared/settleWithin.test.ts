// The bounded wait that the player uses for a fresh resume position when it
// opens a video from a saved list copy. See settleWithin.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { settleWithin } from "../../src/shared/settleWithin";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("settleWithin", () => {
  it("returns the answer that comes in time", async () => {
    const result = settleWithin(Promise.resolve(42), 1000, 7);
    await expect(result).resolves.toBe(42);
  });

  it("returns the fallback when the answer is late", async () => {
    const late = new Promise<number>((resolve) => {
      setTimeout(() => resolve(42), 5000);
    });
    const result = settleWithin(late, 1000, 7);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(result).resolves.toBe(7);
  });

  it("returns the fallback when the call fails", async () => {
    const result = settleWithin(Promise.reject(new Error("down")), 1000, 7);
    await expect(result).resolves.toBe(7);
  });
});
