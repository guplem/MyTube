// When a held touch counts as a long press: held long enough, and still on
// the same spot (a moved finger is a scroll, not a press).

import { describe, expect, it } from "vitest";
import {
  LONG_PRESS_MS,
  LONG_PRESS_SLOP_PX,
  isLongPress,
} from "../../src/shared/longPress";

describe("isLongPress", (): void => {
  it("needs the finger down for the full hold time", (): void => {
    expect(isLongPress(LONG_PRESS_MS - 1, 0, 0)).toBe(false);
    expect(isLongPress(LONG_PRESS_MS, 0, 0)).toBe(true);
  });

  it("holds half a second, long enough not to catch a normal tap", (): void => {
    expect(LONG_PRESS_MS).toBe(500);
  });

  it("allows a small wobble but not a scroll, on either axis", (): void => {
    expect(isLongPress(LONG_PRESS_MS, LONG_PRESS_SLOP_PX, 0)).toBe(true);
    expect(isLongPress(LONG_PRESS_MS, 0, -LONG_PRESS_SLOP_PX)).toBe(true);
    expect(isLongPress(LONG_PRESS_MS, LONG_PRESS_SLOP_PX + 1, 0)).toBe(false);
    expect(isLongPress(LONG_PRESS_MS, 0, -(LONG_PRESS_SLOP_PX + 1))).toBe(
      false,
    );
  });

  it("measures the distance, not each axis alone", (): void => {
    // 8px on both axes is 11.3px away: a drag, though each axis is under 10.
    expect(isLongPress(LONG_PRESS_MS, 8, 8)).toBe(false);
  });
});
