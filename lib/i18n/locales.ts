/**
 * Single source of truth for which languages the viewer can render in.
 *
 * Adding a language is two steps:
 *   1. Add an entry to `SUPPORTED_LOCALES` below.
 *   2. Drop the matching `locales/<code>/*.json` files (translators only).
 *
 * No other code change is required. Components stay untouched.
 *
 * `code` is a BCP-47 tag we pass to `Intl.DateTimeFormat`, `Intl.RelativeTimeFormat`,
 * and i18next. Keep it lowercase except for region (e.g. `pt-BR`, `zh-CN`).
 *
 * `nativeName` is the language label shown in the branding settings dropdown
 * (admin picks one language for the whole dataroom — visitors can't switch).
 */
export type SupportedLocaleCode =
  | "en"
  | "de"
  | "fr"
  | "es"
  | "it"
  | "nl"
  | "pt-BR"
  | "ja";

export type SupportedLocale = {
  code: SupportedLocaleCode;
  nativeName: string;
  englishName: string;
};

export const SUPPORTED_LOCALES: readonly SupportedLocale[] = [
  { code: "en", nativeName: "English", englishName: "English" },
  { code: "de", nativeName: "Deutsch", englishName: "German" },
  { code: "fr", nativeName: "Français", englishName: "French" },
  { code: "es", nativeName: "Español", englishName: "Spanish" },
  { code: "it", nativeName: "Italiano", englishName: "Italian" },
  { code: "nl", nativeName: "Nederlands", englishName: "Dutch" },
  { code: "pt-BR", nativeName: "Português (Brasil)", englishName: "Portuguese (Brazil)" },
  { code: "ja", nativeName: "日本語", englishName: "Japanese" },
] as const;

export const DEFAULT_LOCALE: SupportedLocaleCode = "en";

export const SUPPORTED_LOCALE_CODES: readonly SupportedLocaleCode[] =
  SUPPORTED_LOCALES.map((l) => l.code);

/**
 * Narrow an arbitrary string (e.g. from the DB) to a supported locale code,
 * or return null when the value is missing/unknown.
 */
export function asSupportedLocale(
  value: string | null | undefined,
): SupportedLocaleCode | null {
  if (!value) return null;
  return (SUPPORTED_LOCALE_CODES as readonly string[]).includes(value)
    ? (value as SupportedLocaleCode)
    : null;
}

/** All translation namespaces shipped on the viewer. */
export const VIEWER_NAMESPACES = [
  "access-form",
  "dataroom",
  "viewer",
] as const;

export type ViewerNamespace = (typeof VIEWER_NAMESPACES)[number];
