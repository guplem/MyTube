// Viewport rules for the two top pages: the Apps Script page (its viewport
// tag comes from doGet in src/server/main.ts) and the installable wrapper
// (pages/index.html), which frames the app.

import { describe, expect, it } from "vitest";
import {
  appStyleRules,
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
      expect(content).not.toMatch(/user-scalable\s*=\s*(no|0)/i);
      expect(content).not.toMatch(/maximum-scale/i);
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
      .flatMap((rule: StyleRule): string[] =>
        [...rule.declarations]
          .filter(([property]): boolean => property.startsWith("padding"))
          .map(([, value]): string => value),
      )
      .join(" ");
    for (const side of ["top", "right", "bottom", "left"]) {
      expect(padding, side).toContain("env(safe-area-inset-" + side);
    }
  });
});

describe("form fields", (): void => {
  // iOS zooms the page when focus lands on a field under 16px and does not
  // zoom back. Fields inherit the 16px body font today.
  const fieldRules: StyleRule[] = appStyleRules().filter(
    (rule: StyleRule): boolean =>
      rule.selectors.some((selector: string): boolean =>
        /\b(input|select|textarea)\b|-select\b|\.feed-date\b/.test(selector),
      ),
  );

  it("exist (the check below is not vacuous)", (): void => {
    expect(fieldRules.length).toBeGreaterThan(3);
  });

  it("never set a font size under 16px", (): void => {
    const small: string[] = fieldRules
      .filter((rule: StyleRule): boolean => {
        // The font shorthand carries a size too: "font: 14px/1 sans-serif".
        const shorthand: string | undefined = rule.declarations
          .get("font")
          ?.match(/(^|\s)([\d.]+(?:px|rem))(\/|\s)/)?.[2];
        const size: string | undefined =
          rule.declarations.get("font-size") ?? shorthand;
        if (size === undefined || size === "inherit") return false;
        const match: RegExpMatchArray | null = size.match(/^([\d.]+)(px|rem)$/);
        if (!match) return true;
        const pixels: number =
          match[2] === "rem" ? Number(match[1]) * 16 : Number(match[1]);
        return pixels < 16;
      })
      .flatMap((rule: StyleRule): string[] => rule.selectors);
    expect(small).toEqual([]);
  });
});
