/**
 * Helper for viewer pages that load translation bundles at build/SSR time
 * and forward them to `<ViewerI18nProvider>`.
 *
 * Use in `getStaticProps` / `getServerSideProps` for any page under
 * `pages/view/**`. The helper:
 *   1. Reads the brand's `defaultLanguage` (falls back to "en").
 *   2. Pre-loads bundles for that single locale.
 *   3. Returns ready-to-spread props for the page.
 */
import {
  DEFAULT_LOCALE,
  asSupportedLocale,
  type SupportedLocaleCode,
  type ViewerNamespace,
} from "./locales";
import { loadViewerNamespaces } from "./viewer-i18n";

function getBrandLocale(
  brand: { defaultLanguage?: string | null } | null | undefined,
): SupportedLocaleCode {
  return asSupportedLocale(brand?.defaultLanguage) ?? DEFAULT_LOCALE;
}

export type ViewerI18nPageProps = {
  i18n: {
    locale: SupportedLocaleCode;
    resources: Partial<Record<ViewerNamespace, Record<string, unknown>>>;
  };
};

export async function buildViewerI18nPageProps(
  brand: { defaultLanguage?: string | null } | null | undefined,
): Promise<ViewerI18nPageProps> {
  const locale = getBrandLocale(brand);
  const resources = await loadViewerNamespaces(locale);
  return { i18n: { locale, resources } };
}
