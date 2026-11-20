/**
 * Locale-aware replacements for the `en-US`-hardcoded helpers in `lib/utils.ts`.
 *
 * Only the viewer side uses these — admin pages keep the legacy helpers so
 * the admin UI stays in a stable English format for analytics/exports.
 */
import { DEFAULT_LOCALE, type SupportedLocaleCode } from "./locales";

/** "January 15, 2025" / "15. Januar 2025" / "15 janvier 2025". */
export function formatDateLocalized(
  dateString: string | Date | number,
  locale: SupportedLocaleCode = DEFAULT_LOCALE,
  options?: Intl.DateTimeFormatOptions,
): string {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
    ...options,
  }).format(date);
}

/**
 * Relative time ("2 hours ago", "vor 2 Stunden") matching the existing
 * `timeAgo` semantics (jumps to absolute date once we're more than ~23h out).
 */
export function timeAgoLocalized(
  timestamp: Date | string | number | undefined,
  locale: SupportedLocaleCode = DEFAULT_LOCALE,
): string {
  if (!timestamp) return relativeJustNow(locale);
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return relativeJustNow(locale);

  const diff = Date.now() - date.getTime();

  if (diff < 60_000) return relativeJustNow(locale);

  if (diff > 82_800_000) {
    // More than ~23h: switch to short absolute date, omit year when current.
    const sameYear = date.getFullYear() === new Date().getFullYear();
    return new Intl.DateTimeFormat(locale, {
      month: "short",
      day: "numeric",
      year: sameYear ? undefined : "numeric",
    }).format(date);
  }

  // `ms()` gives us a friendly English distance like "5 minutes" — feed that
  // into Intl.RelativeTimeFormat so we get locale-correct phrasing without
  // shipping a relative-time table per language.
  return relativeFromMs(diff, locale);
}

function relativeJustNow(locale: SupportedLocaleCode): string {
  // RelativeTimeFormat doesn't have a "just now" — use the smallest unit
  // (seconds) at value 0 so we get the locale's natural "now"/"adesso"/"maintenant"
  // phrasing. Falls back gracefully on older runtimes.
  try {
    return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(
      0,
      "second",
    );
  } catch {
    return "Just now";
  }
}

function relativeFromMs(diffMs: number, locale: SupportedLocaleCode): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "always" });
  const seconds = Math.round(diffMs / 1000);
  const minutes = Math.round(seconds / 60);
  const hours = Math.round(minutes / 60);

  // `-N` because the event is in the past.
  if (hours >= 1) return rtf.format(-hours, "hour");
  if (minutes >= 1) return rtf.format(-minutes, "minute");
  return rtf.format(-seconds, "second");
}
