// Viewport rules for the two top pages: the Apps Script page (its viewport
// tag comes from doGet in src/server/main.ts) and the installable wrapper
// (pages/index.html), which frames the app.

import { describe, expect, it } from "vitest";
import {
  parseCss,
  readRepoFile,
  rulesOf,
  styleBlockOf,
  type StyleRule,
} from "../helpers/stylesheet";

const wrapperHtml: string = readRepoFile("pages/index.html");

function viewportContents(): string[] {
  const fromWrapper: string[] = [
    ...wrapperHtml.matchAll(/name="viewport"\s+content="([^"]*)"/g),
  ].map((match: RegExpMatchArray): string => match[1]);
  const fromDoGet: string[] = [
    ...readRepoFile("src/server/main.ts").matchAll(
      /addMetaTag\(\s*"viewport",\s*"([^"]*)"/g,
    ),
  ].map((match: RegExpMatchArray): string => match[1]);
  return [...fromWrapper, ...fromDoGet];
}

describe("viewport tags", (): void => {
  it("are found on both top pages", (): void => {
    expect(viewportContents()).toHaveLength(2);
  });

  it("never block zoom (an accessibility failure; fix input font size instead)", (): void => {
    for (const content of viewportContents()) {
      expect(content).not.toMatch(/user-scalable\s*=\s*(no|0)/);
      expect(content).not.toMatch(/maximum-scale/);
    }
  });
});

describe("the installable wrapper", (): void => {
  it("pads the app away from the notch whenever it draws under it", (): void => {
    if (!wrapperHtml.includes("viewport-fit=cover")) return;
    // Inside the app's iframes env(safe-area-inset-*) reads 0, so the
    // wrapper, the top page, must hold the padding.
    const css: string = styleBlockOf(wrapperHtml);
    const padding: string = rulesOf(parseCss(css))
      .map((rule: StyleRule): string => rule.declarations.get("padding") ?? "")
      .join(" ");
    for (const side of ["top", "right", "bottom", "left"]) {
      expect(padding, side).toContain("env(safe-area-inset-" + side);
    }
  });
});
