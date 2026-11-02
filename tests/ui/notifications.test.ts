// Every notification is the bottom snackbar from src/ui/toast.ts: one look,
// one place on screen. A screen never builds its own banner or floating
// notice. The check reads the UI source as text: only toast.ts may mark an
// element as a status or alert message, which is what a notification is.

import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readRepoFile } from "../helpers/stylesheet";

const MESSAGE_ROLE =
  /setAttribute\(\s*["']role["']\s*,\s*["'](status|alert)["']/;

const sources: string[] = readdirSync("src/ui").filter(
  (name: string): boolean => name.endsWith(".ts"),
);

describe("notifications", (): void => {
  it("toast.ts marks its snackbars as status messages (the check is not vacuous)", (): void => {
    expect(MESSAGE_ROLE.test(readRepoFile("src/ui/toast.ts"))).toBe(true);
  });

  it("come only from toast.ts", (): void => {
    const offenders: string[] = sources
      .filter((name: string): boolean => name !== "toast.ts")
      .filter((name: string): boolean =>
        MESSAGE_ROLE.test(readRepoFile("src/ui/" + name)),
      );
    expect(offenders).toEqual([]);
  });
});
