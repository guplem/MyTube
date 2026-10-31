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
