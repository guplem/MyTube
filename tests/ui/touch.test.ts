// Touch rules for the app stylesheet (src/ui/index.html). A phone has no
// hover: it applies :hover on tap and keeps it until the next tap elsewhere,
// so a hover look must sit behind a hover-capable media query, and touch gets
// its press feedback from :active instead.

import { describe, expect, it } from "vitest";
import { appStyleRules, type StyleRule } from "../helpers/stylesheet";

const HOVER_GATE = "(hover: hover) and (pointer: fine)";

const rules: StyleRule[] = appStyleRules();

function isGated(rule: StyleRule): boolean {
  return rule.conditions.some((condition: string): boolean =>
    condition.includes(HOVER_GATE),
  );
}

const hoverSelectors: { selector: string; rule: StyleRule }[] = rules.flatMap(
  (rule: StyleRule) =>
    rule.selectors
      .filter((selector: string): boolean => selector.includes(":hover"))
      .map((selector: string) => ({ selector, rule })),
);

describe("hover styles", (): void => {
  it("exist (the checks below are not vacuous)", (): void => {
    expect(hoverSelectors.length).toBeGreaterThan(10);
  });

  it("all sit behind the hover-capable media query", (): void => {
    const ungated: string[] = hoverSelectors
      .filter(({ rule }): boolean => !isGated(rule))
      .map(({ selector }): string => selector);
    expect(ungated).toEqual([]);
  });

  it("each have an ungated :active twin, so touch gets press feedback", (): void => {
    const activeSelectors: Set<string> = new Set(
      rules
        .filter((rule: StyleRule): boolean => !isGated(rule))
        .flatMap((rule: StyleRule): string[] => rule.selectors),
    );
    const missing: string[] = hoverSelectors
      .map(({ selector }): string => selector.replace(/:hover/g, ":active"))
      .filter((twin: string): boolean => !activeSelectors.has(twin));
    expect(missing).toEqual([]);
  });
});

function declarationsFor(selector: string): Map<string, string> {
  const merged: Map<string, string> = new Map();
  for (const rule of rules) {
    if (rule.conditions.length > 0) continue;
    if (!rule.selectors.includes(selector)) continue;
    for (const [property, value] of rule.declarations)
      merged.set(property, value);
  }
  return merged;
}

describe("touch baseline", (): void => {
  it("turns off the grey tap flash and the landscape font inflation", (): void => {
    const html: Map<string, string> = declarationsFor("html");
    expect(html.get("-webkit-tap-highlight-color")).toBe("transparent");
    expect(html.get("-webkit-text-size-adjust")).toBe("100%");
  });

  it("makes controls tap at once and never double-tap zoom", (): void => {
    for (const control of ["button", "select", "label"]) {
      expect(declarationsFor(control).get("touch-action"), control).toBe(
        "manipulation",
      );
    }
  });

  it("keeps a long press from selecting a button label", (): void => {
    const button: Map<string, string> = declarationsFor("button");
    expect(button.get("user-select")).toBe("none");
    expect(button.get("-webkit-user-select")).toBe("none");
  });

  it("keeps a long press on a button or its thumbnail from opening a callout", (): void => {
    // -webkit-touch-callout inherits, so the card thumbnail inside
    // .video-play is covered by the button rule.
    expect(declarationsFor("button").get("-webkit-touch-callout")).toBe("none");
  });

  it("never selects body text as a whole", (): void => {
    expect(declarationsFor("body").get("user-select")).toBeUndefined();
  });
});
