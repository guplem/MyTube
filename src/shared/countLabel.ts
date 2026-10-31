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
  // Round first, then pick the unit: 999,950 rounds to "1000.0K", which must
  // read "1M".
  const thousands: number = Math.round(count / 100) / 10;
  if (thousands >= 1000) {
    const millions: number = Math.round(count / 100000) / 10;
    return String(millions) + "M";
  }
  if (count >= 1000) return String(thousands) + "K";
  return String(count);
}
