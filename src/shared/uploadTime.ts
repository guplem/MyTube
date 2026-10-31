// The upload time on cards and in the player. Recent uploads read as an age
// ("5h ago"), because the hour matters less than "how fresh". Older ones read
// as a date with the time, because "3 days ago" hides which evening it was.
// The words stay English like the rest of the UI; the date and the time use
// the browser's locale, so 18:40 or 6:40 PM follows the viewer's habit.

const MINUTE_MS: number = 60 * 1000;
// How far ahead of the viewer's clock an upload may sit and still read as
// "Just now": the server's and the device's clocks can differ a little.
const CLOCK_SKEW_MS: number = 5 * MINUTE_MS;
const HOUR_MS: number = 60 * MINUTE_MS;

function startOfDay(date: Date): number {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
}

/** `locale` is for tests; the app passes none and gets the browser's. */
export function formatUploadTime(
  iso: string,
  now: Date = new Date(),
  locale?: string,
): string {
  const uploaded: Date = new Date(iso);
  const uploadedMs: number = uploaded.getTime();
  if (Number.isNaN(uploadedMs)) return "";
  const today: number = startOfDay(now);
  // A small clock difference can put a fresh upload in the future.
  const ageMs: number = Math.max(0, now.getTime() - uploadedMs);

  // A scheduled premiere sits in the future: it gets its date, not an age.
  const future: boolean = uploadedMs - now.getTime() > CLOCK_SKEW_MS;
  if (uploadedMs >= today && !future) {
    if (ageMs < MINUTE_MS) return "Just now";
    if (ageMs < HOUR_MS) return Math.floor(ageMs / MINUTE_MS) + "m ago";
    return Math.floor(ageMs / HOUR_MS) + "h ago";
  }

  const time: string = new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
  }).format(uploaded);
  const yesterday: number = startOfDay(new Date(today - 1));
  if (uploadedMs >= yesterday && !future) return "Yesterday at " + time;

  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: uploaded.getFullYear() === now.getFullYear() ? undefined : "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(uploaded);
}

// The whole upload moment, for when the short form above is not enough:
// "13h ago" and "Yesterday at 18:40" both hide the date. The player shows it
// when the viewer taps or holds the upload time.
/** `locale` is for tests; the app passes none and gets the browser's. */
export function formatFullUploadTime(iso: string, locale?: string): string {
  const uploaded: Date = new Date(iso);
  if (Number.isNaN(uploaded.getTime())) return "";
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "full",
    timeStyle: "short",
  }).format(uploaded);
}
