// A bounded wait on an answer that can be slow or fail. The player uses it for
// the stored resume position of a video opened from a saved list copy
// (ADR 0011): a late or failed answer must only mean "use the copy's own
// position", never a player that waits forever.

/** Resolves with the answer of `promise` if it comes within `ms`, otherwise
 *  with `fallback`. A rejection also resolves with `fallback`. */
export function settleWithin<T>(
  promise: Promise<T>,
  ms: number,
  fallback: T,
): Promise<T> {
  return new Promise<T>((resolve: (value: T) => void): void => {
    const timer: ReturnType<typeof setTimeout> = setTimeout(
      (): void => resolve(fallback),
      ms,
    );
    promise.then(
      (value: T): void => {
        clearTimeout(timer);
        resolve(value);
      },
      (): void => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}
