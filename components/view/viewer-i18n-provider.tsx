"use client";

import { useEffect, useMemo } from "react";

import { I18nextProvider } from "react-i18next";

import type {
  SupportedLocaleCode,
  ViewerNamespace,
} from "@/lib/i18n/locales";
import { getOrCreateViewerI18n } from "@/lib/i18n/viewer-i18n";

export type ViewerI18nProviderProps = {
  /** Locale picked by the admin in branding (always one of SUPPORTED_LOCALE_CODES). */
  locale: SupportedLocaleCode;
  /**
   * Translation bundles inlined by `getStaticProps`/`getServerSideProps` so
   * the first paint is already translated and visitors never see an English
   * flash before the JSON hydrates. We only ever inline the one active locale.
   */
  resources: Partial<Record<ViewerNamespace, Record<string, unknown>>>;
  children: React.ReactNode;
};

/**
 * Wraps the viewer tree in a singleton-per-locale i18next instance so every
 * child component can call `useTranslation()` without prop-drilling.
 *
 * Deliberately minimal — there is no visitor-side language switching, cookie
 * reading, or Accept-Language detection. Whatever locale the admin set on
 * the brand is the locale the page renders in.
 */
export function ViewerI18nProvider({
  locale,
  resources,
  children,
}: ViewerI18nProviderProps) {
  const i18n = useMemo(
    () => getOrCreateViewerI18n(locale, resources),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale],
  );

  // When the page re-renders with fresh resources (e.g. the visitor navigates
  // to a deeper route that ships more namespaces), merge them into the cached
  // instance so any newly-required key resolves instead of falling back to en.
  useEffect(() => {
    for (const [ns, content] of Object.entries(resources)) {
      if (content) i18n.addResourceBundle(locale, ns, content, true, true);
    }
  }, [resources, i18n, locale]);

  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}
