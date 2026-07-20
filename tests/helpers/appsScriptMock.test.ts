// The fakes must reject writes the real Apps Script services reject, so a
// change that broke the chunking in history.ts/dismissed.ts (or cached an
// oversized blob) fails the suite instead of only crashing in production.
// Limits mirrored here: PropertiesService caps each value at ~9KB and the whole
// store at ~500KB; CacheService caps each value at ~100KB. See ADR 0006.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AppsScriptMocks } from "./appsScriptMock";
import {
  installAppsScriptMocks,
  uninstallAppsScriptMocks,
} from "./appsScriptMock";

let mocks: AppsScriptMocks;

beforeEach(() => {
  mocks = installAppsScriptMocks();
});
afterEach(() => {
  uninstallAppsScriptMocks();
});

describe("FakeProperties size limits", () => {
  it("rejects a value over the 9KB per-value limit", () => {
    const tooBig = "a".repeat(10 * 1024);
    expect(() =>
      mocks.userProperties.setProperty("history_0", tooBig),
    ).toThrow();
  });

  it("accepts a value just under the 9KB per-value limit", () => {
    const underLimit = "a".repeat(8 * 1024);
    expect(() =>
      mocks.userProperties.setProperty("history_0", underLimit),
    ).not.toThrow();
  });

  it("rejects setProperties when any value exceeds the 9KB per-value limit", () => {
    const tooBig = "a".repeat(10 * 1024);
    expect(() =>
      mocks.userProperties.setProperties({ ok: "small", history_0: tooBig }),
    ).toThrow();
  });

  it("rejects a write that pushes the total store past the 500KB limit", () => {
    const chunk = "a".repeat(9 * 1024 - 32); // just under the per-value cap
    expect(() => {
      for (let i = 0; i < 60; i += 1) {
        mocks.userProperties.setProperty(`history_${i}`, chunk);
      }
    }).toThrow();
  });

  it("counts UTF-8 bytes, not characters, against the per-value limit", () => {
    // "€" is 3 UTF-8 bytes: 4096 chars = 12288 bytes > 9216, though .length is
    // well under 9KB.
    const multiByte = "€".repeat(4 * 1024);
    expect(multiByte.length).toBeLessThan(9 * 1024);
    expect(() =>
      mocks.userProperties.setProperty("history_0", multiByte),
    ).toThrow();
  });

  it("respects deleteAllOthers when computing the total store size", () => {
    const chunk = "a".repeat(9 * 1024 - 32);
    for (let i = 0; i < 50; i += 1) {
      mocks.userProperties.setProperty(`history_${i}`, chunk);
    }
    // Replacing the whole store leaves plenty of headroom, so this must not
    // throw even though the pre-call store is nearly full.
    expect(() =>
      mocks.userProperties.setProperties({ history_0: chunk }, true),
    ).not.toThrow();
  });
});

describe("FakeCache size limits", () => {
  it("rejects a value over the 100KB per-value limit", () => {
    const tooBig = "a".repeat(101 * 1024);
    expect(() => mocks.scriptCache.put("feed_channel", tooBig)).toThrow();
  });

  it("accepts a value just under the 100KB per-value limit", () => {
    const underLimit = "a".repeat(90 * 1024);
    expect(() =>
      mocks.scriptCache.put("feed_channel", underLimit),
    ).not.toThrow();
  });

  it("rejects putAll when any value exceeds the 100KB per-value limit", () => {
    const tooBig = "a".repeat(101 * 1024);
    expect(() =>
      mocks.scriptCache.putAll({ ok: "small", feed_channel: tooBig }),
    ).toThrow();
  });
});
