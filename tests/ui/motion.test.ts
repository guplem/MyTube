// Motion rules for the app (src/ui). Motion animates transform and opacity
// only: they skip layout and paint, so they hold the frame rate on a slow
// phone. A rule that must animate something else carries a comment with
// "motion-exception:" and the reason, right before it. Every motion also
// has a calmer version for people who ask the system to reduce motion.

import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AtRule, Root } from "postcss";
import {
  parseCss,
  readRepoFile,
  rulesOf,
  styleBlockOf,
  transitionedProperties,
  type StyleRule,
} from "../helpers/stylesheet";

const EXCEPTION = "motion-exception:";
const CHEAP = new Set<string>(["transform", "opacity"]);

const root: Root = parseCss(styleBlockOf(readRepoFile("src/ui/index.html")));
const rules: StyleRule[] = rulesOf(root);

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

/** What the reduced-motion rules set for a selector, merged in order. */
function reducedOverride(selector: string): Map<string, string> {
  const merged: Map<string, string> = new Map();
  for (const rule of rules.filter(isReducedMotion)) {
    if (!rule.selectors.includes(selector)) continue;
    for (const [property, value] of rule.declarations)
      merged.set(property, value);
  }
  return merged;
}

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
        // A step's own timing function shapes the motion; it animates nothing.
        if (!CHEAP.has(decl.prop) && decl.prop !== "animation-timing-function")
          offenders.push(keyframes.params + " " + decl.prop);
      });
    });
    expect(offenders).toEqual([]);
  });

  it("gives every animation and every moving transition a reduced-motion override", (): void => {
    // The override must really calm the motion: an animation stops, and a
    // transform transition is replaced by one that does not move.
    const missing: string[] = [];
    for (const rule of rules.filter(
      (r: StyleRule): boolean => !isReducedMotion(r),
    )) {
      const moves: boolean = transitionedProperties(rule).includes("transform");
      if (!hasAnimation(rule) && !moves) continue;
      for (const selector of rule.selectors) {
        const override: Map<string, string> = reducedOverride(selector);
        const calmed: StyleRule = { ...rule, declarations: override };
        if (
          hasAnimation(rule) &&
          (override.get("animation") ?? override.get("animation-name")) !==
            "none"
        )
          missing.push(selector + " (animation not set to none)");
        if (
          moves &&
          (!override.has("transition") ||
            transitionedProperties(calmed).includes("transform"))
        )
          missing.push(selector + " (transition still moves)");
      }
    }
    expect(missing).toEqual([]);
  });

  it("never sets smooth scrolling in CSS, which reduced motion would not calm", (): void => {
    const smooth: string[] = rules
      .filter(
        (rule: StyleRule): boolean =>
          rule.declarations.get("scroll-behavior") === "smooth",
      )
      .flatMap((rule: StyleRule): string[] => rule.selectors);
    expect(smooth).toEqual([]);
  });
});

describe("script motion", (): void => {
  it("scrolls smoothly only through the helper that honors reduced motion", (): void => {
    const offenders: string[] = readdirSync(
      new URL("../../src/ui", import.meta.url),
    )
      .filter(
        (name: string): boolean => name.endsWith(".ts") && name !== "motion.ts",
      )
      .filter((name: string): boolean =>
        /["'`]smooth["'`]/.test(readRepoFile("src/ui/" + name)),
      );
    expect(offenders).toEqual([]);
  });
});

describe("toast entrance", (): void => {
  // A toast is inserted, and a plain transition never runs on insert, so
  // the start state lives in @starting-style.
  const startRules: StyleRule[] = rules.filter(
    (rule: StyleRule): boolean =>
      rule.selectors.includes(".toast") &&
      rule.node.parent?.type === "atrule" &&
      (rule.node.parent as AtRule).name === "starting-style",
  );

  it("starts transparent and below its resting place", (): void => {
    expect(startRules).toHaveLength(1);
    expect(startRules[0].declarations.get("opacity")).toBe("0");
    expect(startRules[0].declarations.get("transform")).toMatch(
      /^translateY\(/,
    );
  });

  it("only fades when the system reduces motion", (): void => {
    const reduced: string | undefined = rules
      .filter(isReducedMotion)
      .find((rule: StyleRule): boolean => rule.selectors.includes(".toast"))
      ?.declarations.get("transition");
    expect(reduced).toBeDefined();
    expect(reduced).not.toContain("transform");
  });
});
