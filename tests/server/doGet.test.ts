// The page doGet serves: the PWA wrapper on GitHub Pages (pages/) frames it, and
// the favicon comes from that same site. See the note above doGet in main.ts.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  installAppsScriptMocks,
  uninstallAppsScriptMocks,
  type AppsScriptMocks,
} from "../helpers/appsScriptMock";
import { doGet } from "../../src/server/main";

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
      "setFaviconUrl:https://guplem.github.io/MyTube/icon-192.png",
    );
  });

  it("still serves the page when Google rejects the favicon", () => {
    mocks.rejectFavicon = true;
    expect(() => doGet()).not.toThrow();
    expect(mocks.htmlCalls).toContain("setTitle:MyTube");
    expect(mocks.htmlCalls).toContain("setXFrameOptionsMode:ALLOWALL");
  });
});
