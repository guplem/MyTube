// Per-account UI preferences in PropertiesService: one JSON property, so every
// device of the account reads the same set. See server/preferences.ts.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  installAppsScriptMocks,
  uninstallAppsScriptMocks,
  type AppsScriptMocks,
} from "../helpers/appsScriptMock";
import {
  getPreferences,
  importPreferences,
  setPreference,
} from "../../src/server/preferences";
import { MAX_PREFERENCE_KEYS } from "../../src/shared/preferences";

let mocks: AppsScriptMocks;

beforeEach(() => {
  mocks = installAppsScriptMocks();
});
afterEach(() => {
  uninstallAppsScriptMocks();
});

describe("preferences store", () => {
  it("reports no stored set before the first write", () => {
    expect(getPreferences()).toBeNull();
  });

  it("stores, overwrites, and clears a preference", () => {
    setPreference("mytube.hideViewed", "true");
    setPreference("mytube.beforeDate", "2026-06-08");
    setPreference("mytube.hideViewed", "false");
    setPreference("mytube.beforeDate", null);
    expect(getPreferences()).toEqual({ "mytube.hideViewed": "false" });
  });

  it("keeps an emptied set as stored, not as missing", () => {
    setPreference("mytube.beforeDate", "2026-06-08");
    setPreference("mytube.beforeDate", null);
    expect(getPreferences()).toEqual({});
  });

  it("serializes the write under the user lock", () => {
    setPreference("mytube.hideViewed", "true");
    expect(mocks.lockCalls).toEqual(["acquire", "release"]);
  });

  it("rejects a key outside the app's namespace", () => {
    expect(() => setPreference("evil", "1")).toThrow();
    expect(getPreferences()).toBeNull();
  });

  it("rejects a new key once the set is full, but still updates a kept one", () => {
    for (let i = 0; i < MAX_PREFERENCE_KEYS; i++) {
      setPreference("mytube.k" + i, "1");
    }
    expect(() => setPreference("mytube.extra", "1")).toThrow();
    setPreference("mytube.k0", "2");
    expect(getPreferences()?.["mytube.k0"]).toBe("2");
  });

  it("reads a corrupt stored value as no stored set", () => {
    mocks.userProperties.setProperty("preferences", "{not json");
    expect(getPreferences()).toBeNull();
  });
});

describe("importPreferences", () => {
  it("fills an account that has no stored set", () => {
    importPreferences({ "mytube.hideViewed": "true", junk: "x" });
    expect(getPreferences()).toEqual({ "mytube.hideViewed": "true" });
  });

  it("stores nothing for an empty import, so a fresh browser cannot wipe the set", () => {
    importPreferences({ junk: "x" });
    expect(getPreferences()).toBeNull();
  });

  it("never overwrites a stored set, so the first device wins", () => {
    setPreference("mytube.hideViewed", "false");
    importPreferences({ "mytube.hideViewed": "true" });
    expect(getPreferences()).toEqual({ "mytube.hideViewed": "false" });
  });
});
