// A shuffled copy of a list (Fisher-Yates), for "Shuffle" on list screens.
// The random source is a parameter so tests can fix it.

export function shuffled<T>(
  items: readonly T[],
  random: () => number = Math.random,
): T[] {
  const result: T[] = items.slice();
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j: number = Math.floor(random() * (i + 1));
    const held: T = result[i];
    result[i] = result[j];
    result[j] = held;
  }
  return result;
}
