import { describe, expect, it } from "vitest";
import { shuffled } from "../../src/shared/shuffle";

// A fixed "random" source: each call returns the next value of the list.
function sequence(values: number[]): () => number {
  let next = 0;
  return (): number => values[next++ % values.length];
}

describe("shuffled", (): void => {
  it("returns a new array and leaves the input as it was", (): void => {
    const input: number[] = [1, 2, 3, 4];
    const output: number[] = shuffled(input, sequence([0]));
    expect(output).not.toBe(input);
    expect(input).toEqual([1, 2, 3, 4]);
  });

  it("keeps every item exactly once", (): void => {
    const output: number[] = shuffled([1, 2, 3, 4, 5], Math.random);
    expect([...output].sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it("swaps with the index the random source picks (Fisher-Yates)", (): void => {
    // random() = 0 always picks index 0: [a,b,c] -> swap c<->a, then b<->c.
    expect(shuffled(["a", "b", "c"], sequence([0]))).toEqual(["b", "c", "a"]);
    // random() just under 1 always picks the item itself: no change.
    expect(shuffled(["a", "b", "c"], sequence([0.999]))).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("handles an empty list and a single item", (): void => {
    expect(shuffled([], Math.random)).toEqual([]);
    expect(shuffled(["only"], Math.random)).toEqual(["only"]);
  });
});
