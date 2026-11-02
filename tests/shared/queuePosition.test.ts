// The player's place in its queue, shown between the previous and next
// buttons on wide screens: "3 / 24".

import { describe, it, expect } from "vitest";
import { queuePosition } from "../../src/shared/queuePosition";

describe("queuePosition", () => {
  it("counts from 1, so the first video reads 1, not 0", () => {
    expect(queuePosition(0, 24)).toBe("1 / 24");
    expect(queuePosition(2, 24)).toBe("3 / 24");
  });

  it("shows the last video as the queue length", () => {
    expect(queuePosition(23, 24)).toBe("24 / 24");
  });

  // With one video both buttons are off, and "1 / 1" only adds noise.
  it("shows nothing for a queue of one video or none", () => {
    expect(queuePosition(0, 1)).toBe("");
    expect(queuePosition(0, 0)).toBe("");
  });

  // The player clamps its index, but a counter must never read "0 / 5" or
  // "6 / 5" if a caller does not.
  it("clamps an index outside the queue", () => {
    expect(queuePosition(-1, 5)).toBe("1 / 5");
    expect(queuePosition(9, 5)).toBe("5 / 5");
  });
});
