// Reads the app stylesheet for the static UI rule tests in tests/ui/.
//
// The browser layer has no unit tests (it needs a browser and the
// google.script bridge), but its CSS is plain text. postcss parses it, so a
// test can check a rule such as "every :hover sits behind a hover-capable
// media query" on every selector, without a browser.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postcss, {
  type AtRule,
  type Container,
  type Root,
  type Rule,
} from "postcss";

const repoRoot: string = fileURLToPath(new URL("../..", import.meta.url));

export function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), "utf8");
}

/** The CSS inside the first <style> block of an HTML file. */
export function styleBlockOf(html: string): string {
  const match: RegExpMatchArray | null = html.match(
    /<style>([\s\S]*?)<\/style>/,
  );
  if (!match) throw new Error("No <style> block found");
  return match[1];
}

/** One style rule, with the at-rule conditions that wrap it. */
export interface StyleRule {
  selectors: string[];
  /** Params of every enclosing @media/@supports, outermost first. */
  conditions: string[];
  /** Last value of each declared property, keyed by lower-case name. */
  declarations: Map<string, string>;
  /** Text of the comment right before the rule, or "" when there is none. */
  comment: string;
  node: Rule;
}

export function parseCss(css: string): Root {
  return postcss.parse(css);
}

export function rulesOf(root: Root): StyleRule[] {
  const rules: StyleRule[] = [];
  root.walkRules((node: Rule): void => {
    // Keyframe steps (0%, 50%, from) are rules too; they are not selectors.
    if (node.parent?.type === "atrule") {
      const parent: AtRule = node.parent as AtRule;
      if (parent.name.endsWith("keyframes")) return;
    }
    const conditions: string[] = [];
    let parent: Container | undefined = node.parent as Container | undefined;
    while (parent && parent.type === "atrule") {
      conditions.unshift((parent as AtRule).params);
      parent = parent.parent as Container | undefined;
    }
    const declarations: Map<string, string> = new Map();
    node.walkDecls((decl): void => {
      declarations.set(decl.prop.toLowerCase(), decl.value);
    });
    const previous = node.prev();
    rules.push({
      selectors: node.selectors.map((selector: string): string =>
        selector.replace(/\s+/g, " ").trim(),
      ),
      conditions,
      declarations,
      comment: previous?.type === "comment" ? previous.text : "",
      node,
    });
  });
  return rules;
}

/** The app stylesheet (src/ui/index.html), parsed into rules. */
export function appStyleRules(): StyleRule[] {
  return rulesOf(parseCss(styleBlockOf(readRepoFile("src/ui/index.html"))));
}
