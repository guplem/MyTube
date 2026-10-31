// Counts in UI copy: "1 video", "1,284 videos". The copy is English, so the
// grouping is English too, whatever the browser locale.

const ENGLISH_GROUPING: Intl.NumberFormat = new Intl.NumberFormat("en-US");

export function groupedNumber(count: number): string {
  return ENGLISH_GROUPING.format(count);
}

export function countLabel(
  count: number,
  singular: string,
  plural: string,
): string {
  return groupedNumber(count) + " " + (count === 1 ? singular : plural);
}

/** A short count for tight spots ("1.3K", "1.2M"), where the exact number
 *  does not matter: comment likes, the count over a playlist cover. */
export function compactNumber(count: number): string {
  if (count >= 1000000)
    return (count / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
  if (count >= 1000) return (count / 1000).toFixed(1).replace(/\.0$/, "") + "K";
  return String(count);
}
