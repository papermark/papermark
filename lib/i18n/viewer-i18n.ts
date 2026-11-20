/**
 * i18next instance(s) used by the viewer.
 *
 * Design choices:
 *  - One instance per locale, lazily created on the client (kept on a module
 *    cache). This avoids re-initializing on every page navigation between
 *    `/view/[linkId]` and `/view/[linkId]/d/[doc]`.
 *  - Translation resources are loaded statically via `import()`. That lets
 *    Next.js code-split each locale's JSON into its own chunk — the visitor
 *    only downloads the JSON for their resolved language.
 *  - Server rendering inlines the namespace resources via `getStaticProps`/
 *    `getServerSideProps` so the first paint is already translated and we
 *    don't ship an English flash before the JSON hydrates.
 */
import i18next, { type i18n as I18nInstance, type Resource } from "i18next";
import { initReactI18next } from "react-i18next";

import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALE_CODES,
  VIEWER_NAMESPACES,
  type SupportedLocaleCode,
  type ViewerNamespace,
} from "./locales";

const clientInstances = new Map<SupportedLocaleCode, I18nInstance>();

/**
 * Get-or-create the i18next instance for `locale`, pre-populated with `resources`.
 *
 * Subsequent calls with the same locale return the cached instance and merge
 * any extra namespaces into it — this lets a page that needs only `viewer`
 * load that namespace cheaply, and a later page that needs `dataroom` add
 * to the same instance.
 */
export function getOrCreateViewerI18n(
  locale: SupportedLocaleCode,
  resources: Partial<Record<ViewerNamespace, Record<string, unknown>>>,
): I18nInstance {
  const cached = clientInstances.get(locale);
  if (cached) {
    // Merge any newly-provided namespaces in case the page bundle ships more.
    for (const [ns, bundle] of Object.entries(resources)) {
      if (bundle) cached.addResourceBundle(locale, ns, bundle, true, true);
    }
    return cached;
  }

  const fresh = i18next.createInstance();
  fresh.use(initReactI18next).init({
    lng: locale,
    fallbackLng: DEFAULT_LOCALE,
    supportedLngs: [...SUPPORTED_LOCALE_CODES],
    ns: [...VIEWER_NAMESPACES],
    defaultNS: "viewer",
    fallbackNS: "viewer",
    interpolation: {
      // React already escapes — letting i18next double-escape would break
      // copy that includes `<`/`>` like "AT&T" or "<unknown>".
      escapeValue: false,
    },
    react: {
      useSuspense: false,
    },
    resources: buildResourceTree(locale, resources),
    returnEmptyString: false,
    // Saves ~10-15% per render — we never need plurals across languages we
    // don't ship, so loading all is wasted memory.
    load: "currentOnly",
  });
  clientInstances.set(locale, fresh);
  return fresh;
}

/**
 * Server-side resource loader. Returns a JSON-cloneable record so it can be
 * passed through `getStaticProps`/`getServerSideProps` as page props and
 * hydrated on the client without a refetch.
 *
 * Locales that don't yet have a translation for a key fall back to English
 * via i18next's `fallbackLng`, but we always ship the requested locale's
 * file so the rest of the page is not English-mixed.
 */
export async function loadViewerNamespaces(
  locale: SupportedLocaleCode,
  namespaces: readonly ViewerNamespace[] = VIEWER_NAMESPACES,
): Promise<Partial<Record<ViewerNamespace, Record<string, unknown>>>> {
  const entries = await Promise.all(
    namespaces.map(async (ns) => {
      const bundle = await loadNamespaceFile(locale, ns).catch(async () => {
        // Missing locale file → fall back to English so the namespace is
        // never undefined. The locale-tagged HTML still says `lang="de"` etc.
        if (locale !== DEFAULT_LOCALE) {
          return loadNamespaceFile(DEFAULT_LOCALE, ns);
        }
        return {};
      });
      return [ns, bundle] as const;
    }),
  );
  return Object.fromEntries(entries);
}

/**
 * Static dynamic import so Next.js can analyze it at build time and create a
 * chunk per (locale, namespace). Using a switch instead of template literals
 * because Webpack/Turbopack must see literal strings to split correctly.
 */
async function loadNamespaceFile(
  locale: SupportedLocaleCode,
  namespace: ViewerNamespace,
): Promise<Record<string, unknown>> {
  // Each `import(...)` call must be its own literal so the bundler can emit
  // a separate chunk per locale+namespace pair.
  // Keep this in lockstep with SUPPORTED_LOCALES and VIEWER_NAMESPACES.
  switch (locale) {
    case "en":
      switch (namespace) {
        case "access-form":
          return (await import("../../locales/en/access-form.json")).default;
        case "dataroom":
          return (await import("../../locales/en/dataroom.json")).default;
        case "viewer":
          return (await import("../../locales/en/viewer.json")).default;
      }
      break;
    case "de":
      switch (namespace) {
        case "access-form":
          return (await import("../../locales/de/access-form.json")).default;
        case "dataroom":
          return (await import("../../locales/de/dataroom.json")).default;
        case "viewer":
          return (await import("../../locales/de/viewer.json")).default;
      }
      break;
    case "fr":
      switch (namespace) {
        case "access-form":
          return (await import("../../locales/fr/access-form.json")).default;
        case "dataroom":
          return (await import("../../locales/fr/dataroom.json")).default;
        case "viewer":
          return (await import("../../locales/fr/viewer.json")).default;
      }
      break;
    case "es":
      switch (namespace) {
        case "access-form":
          return (await import("../../locales/es/access-form.json")).default;
        case "dataroom":
          return (await import("../../locales/es/dataroom.json")).default;
        case "viewer":
          return (await import("../../locales/es/viewer.json")).default;
      }
      break;
    case "it":
      switch (namespace) {
        case "access-form":
          return (await import("../../locales/it/access-form.json")).default;
        case "dataroom":
          return (await import("../../locales/it/dataroom.json")).default;
        case "viewer":
          return (await import("../../locales/it/viewer.json")).default;
      }
      break;
    case "nl":
      switch (namespace) {
        case "access-form":
          return (await import("../../locales/nl/access-form.json")).default;
        case "dataroom":
          return (await import("../../locales/nl/dataroom.json")).default;
        case "viewer":
          return (await import("../../locales/nl/viewer.json")).default;
      }
      break;
    case "pt-BR":
      switch (namespace) {
        case "access-form":
          return (await import("../../locales/pt-BR/access-form.json")).default;
        case "dataroom":
          return (await import("../../locales/pt-BR/dataroom.json")).default;
        case "viewer":
          return (await import("../../locales/pt-BR/viewer.json")).default;
      }
      break;
    case "ja":
      switch (namespace) {
        case "access-form":
          return (await import("../../locales/ja/access-form.json")).default;
        case "dataroom":
          return (await import("../../locales/ja/dataroom.json")).default;
        case "viewer":
          return (await import("../../locales/ja/viewer.json")).default;
      }
      break;
  }
  return {};
}

function buildResourceTree(
  locale: SupportedLocaleCode,
  resources: Partial<Record<ViewerNamespace, Record<string, unknown>>>,
): Resource {
  const tree: Resource = {};
  tree[locale] = {};
  for (const [ns, bundle] of Object.entries(resources)) {
    if (bundle) tree[locale][ns] = bundle;
  }
  return tree;
}
