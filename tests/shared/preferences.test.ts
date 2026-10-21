// The policy for which preferences the account store keeps, and the safe
// embedding of the stored set into the served page. See shared/preferences.ts.

import { describe, expect, it } from "vitest";
import {
  MAX_PREFERENCE_KEYS,
  MAX_PREFERENCE_VALUE_LENGTH,
  isValidPreference,
  preferencesScriptLiteral,
  sanitizePreferences,
} from "../../src/shared/preferences";

describe("isValidPreference", () => {
  it("accepts an app key with a short value", () => {
    expect(isValidPreference("mytube.hideViewed", "true")).toBe(true);
  });

  it("rejects a key outside the app's namespace", () => {
    expect(isValidPreference("hideViewed", "true")).toBe(false);
  });

  it("rejects a value over the length cap", () => {
    const long: string = "x".repeat(MAX_PREFERENCE_VALUE_LENGTH + 1);
    expect(isValidPreference("mytube.beforeDate", long)).toBe(false);
  });

  it("rejects a key over the length cap", () => {
    expect(isValidPreference("mytube." + "k".repeat(100), "1")).toBe(false);
  });
});

describe("sanitizePreferences", () => {
  it("keeps only valid string entries", () => {
    expect(
      sanitizePreferences({
        "mytube.hideShorts": "false",
        "mytube.speed": 2,
        other: "x",
      }),
    ).toEqual({ "mytube.hideShorts": "false" });
  });

  it("returns an empty set for input that is not an object", () => {
    expect(sanitizePreferences(null)).toEqual({});
    expect(sanitizePreferences("x")).toEqual({});
    expect(sanitizePreferences(["mytube.a"])).toEqual({});
  });

  it("keeps at most the key cap", () => {
    const many: Record<string, string> = {};
    for (let i = 0; i < MAX_PREFERENCE_KEYS + 5; i++)
      many["mytube.k" + i] = "1";
    expect(Object.keys(sanitizePreferences(many))).toHaveLength(
      MAX_PREFERENCE_KEYS,
    );
  });
});

describe("preferencesScriptLiteral", () => {
  it("writes null when the account has no stored set", () => {
    expect(preferencesScriptLiteral(null)).toBe("null");
  });

  it("escapes a closing script tag inside a value", () => {
    const literal: string = preferencesScriptLiteral({
      "mytube.x": "</script><script>alert(1)</script>",
    });
    expect(literal).not.toContain("</script>");
    expect(JSON.parse(literal)).toEqual({
      "mytube.x": "</script><script>alert(1)</script>",
    });
  });
});
