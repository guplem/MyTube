// Motion rules for the app (src/ui). Motion animates transform and opacity
// only: they skip layout and paint, so they hold the frame rate on a slow
// phone. A rule that must animate something else carries a comment with
// "motion-exception:" and the reason, right before it. Every motion also
// has a calmer version for people who ask the system to reduce motion.

import { describe, expect, it } from "vitest";
import type { AtRule, Root } from "postcss";
import {
  parseCss,
  readRepoFile,
  rulesOf,
  styleBlockOf,
  type StyleRule,
} from "../helpers/stylesheet";

const EXCEPTION = "motion-exception:";
const CHEAP = new Set<string>(["transform", "opacity"]);

const root: Root = parseCss(styleBlockOf(readRepoFile("src/ui/index.html")));
const rules: StyleRule[] = rulesOf(root);

function transitionedProperties(rule: StyleRule): string[] {
  const value: string | undefined =
    rule.declarations.get("transition-property") ??
    rule.declarations.get("transition");
  if (value === undefined || value.trim() === "none") return [];
  return value
    .split(",")
    .map((part: string): string => part.trim().split(/\s+/)[0]);
}

function hasAnimation(rule: StyleRule): boolean {
  const value: string | undefined =
    rule.declarations.get("animation") ??
    rule.declarations.get("animation-name");
  return value !== undefined && value.trim() !== "none";
}

function isReducedMotion(rule: StyleRule): boolean {
  return rule.conditions.some((condition: string): boolean =>
    /prefers-reduced-motion:\s*reduce/.test(condition),
  );
}

const reducedSelectors: Set<string> = new Set(
  rules
    .filter(isReducedMotion)
    .flatMap((rule: StyleRule): string[] => rule.selectors),
);

describe("CSS motion", (): void => {
  it("exists (the checks below are not vacuous)", (): void => {
    expect(rules.filter(hasAnimation).length).toBeGreaterThan(0);
    expect(
      rules.filter(
        (rule: StyleRule): boolean => transitionedProperties(rule).length > 0,
      ).length,
    ).toBeGreaterThan(0);
  });

  it("never transitions `all`", (): void => {
    const offenders: string[] = rules
      .filter((rule: StyleRule): boolean =>
        transitionedProperties(rule).includes("all"),
      )
      .flatMap((rule: StyleRule): string[] => rule.selectors);
    expect(offenders).toEqual([]);
  });

  it("transitions only transform and opacity, unless a motion-exception comment says why", (): void => {
    const offenders: string[] = rules
      .filter((rule: StyleRule): boolean => !rule.comment.includes(EXCEPTION))
      .filter((rule: StyleRule): boolean =>
        transitionedProperties(rule).some(
          (name: string): boolean => !CHEAP.has(name),
        ),
      )
      .flatMap((rule: StyleRule): string[] => rule.selectors);
    expect(offenders).toEqual([]);
  });

  it("keyframes animate only transform and opacity, unless a motion-exception comment says why", (): void => {
    const offenders: string[] = [];
    root.walkAtRules(/keyframes$/, (keyframes: AtRule): void => {
      const previous = keyframes.prev();
      if (previous?.type === "comment" && previous.text.includes(EXCEPTION))
        return;
      keyframes.walkDecls((decl): void => {
        if (!CHEAP.has(decl.prop))
          offenders.push(keyframes.params + " " + decl.prop);
      });
    });
    expect(offenders).toEqual([]);
  });

  it("gives every animation and every moving transition a reduced-motion override", (): void => {
    const missing: string[] = rules
      .filter((rule: StyleRule): boolean => !isReducedMotion(rule))
      .filter(
        (rule: StyleRule): boolean =>
          hasAnimation(rule) ||
          transitionedProperties(rule).includes("transform"),
      )
      .flatMap((rule: StyleRule): string[] => rule.selectors)
      .filter((selector: string): boolean => !reducedSelectors.has(selector));
    expect(missing).toEqual([]);
  });
});
