import { expect, test } from "vitest";

// Temporary probe for validating the auto-merge repeat-run fix. It fails on
// purpose so the CI "test" check stays red and this throwaway PR never merges,
// while the PR still triggers the Auto-merge workflow twice. Delete with the
// throwaway branch once the validation is done.
test("probe: fails on purpose so the validation PR does not merge", () => {
  expect(1).toBe(2);
});
