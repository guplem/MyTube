// The page doGet serves: the PWA wrapper on GitHub Pages (pages/) frames it, and
// the favicon comes from that same site. See the note above doGet in main.ts.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  installAppsScriptMocks,
  uninstallAppsScriptMocks,
  type AppsScriptMocks,
} from "../helpers/appsScriptMock";
import { doGet } from "../../src/server/main";
import { setPreference } from "../../src/server/preferences";

let mocks: AppsScriptMocks;

beforeEach(() => {
  mocks = installAppsScriptMocks();
});
afterEach(() => {
  uninstallAppsScriptMocks();
});

describe("doGet", () => {
  it("allows framing, so the GitHub Pages wrapper can embed the app", () => {
    doGet();
    expect(mocks.htmlCalls).toContain("setXFrameOptionsMode:ALLOWALL");
  });

  it("sets the favicon from the GitHub Pages site", () => {
    doGet();
    expect(mocks.htmlCalls).toContain(
      "setFaviconUrl:https://triunitystudios.com/MyTube/icon-192.png",
    );
  });

  it("still serves the page when Google rejects the favicon", () => {
    mocks.rejectFavicon = true;
    expect(() => doGet()).not.toThrow();
    expect(mocks.htmlCalls).toContain("setTitle:MyTube");
    expect(mocks.htmlCalls).toContain("setXFrameOptionsMode:ALLOWALL");
  });

  it("embeds the account's stored preferences in the page", () => {
    setPreference("mytube.hideViewed", "true");
    doGet();
    expect(JSON.parse(mocks.templateValues.preferencesJson)).toEqual({
      "mytube.hideViewed": "true",
    });
  });

  it("embeds null when the account has no stored preferences yet", () => {
    doGet();
    expect(mocks.templateValues.preferencesJson).toBe("null");
  });

  it("embeds the account key that the list previews are saved under", () => {
    mocks.userKey = "key-<1>";
    doGet();
    expect(mocks.templateValues.accountKeyJson).toBe('"key-\\u003c1>"');
  });

  it("embeds an empty key, which turns the previews off, when Session fails", () => {
    (globalThis as Record<string, unknown>).Session = {
      getTemporaryActiveUserKey: (): string => {
        throw new Error("no session");
      },
    };
    expect(() => doGet()).not.toThrow();
    expect(mocks.templateValues.accountKeyJson).toBe('""');
  });
});
