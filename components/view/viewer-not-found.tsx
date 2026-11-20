"use client";

import NotFound from "@/pages/404";
import { useTranslation } from "react-i18next";

/**
 * Why a visitor is being shown the not-found screen instead of the link.
 *
 * Each reason maps to `viewer.notFound.reasons.<reason>` in the locale files;
 * the value here is the English fallback.
 */
const REASONS = {
  expired: "Sorry, the link you're looking for is expired.",
  archived: "Sorry, the link you're looking for is archived.",
  dataroomClosed: "This data room has been closed and is no longer available.",
  loadErrorRefresh:
    "Sorry, we had trouble loading this link. Please try refreshing.",
  loadErrorRetry:
    "Sorry, we had trouble loading this link. Please try again in a moment.",
  embedOnly: "This page can only be accessed when embedded in another website.",
} as const;

export type ViewerNotFoundReason = keyof typeof REASONS;

/**
 * The not-found screen, rendered in the data room's language.
 *
 * Every `NotFound` under `pages/view/**` lives inside an inner component that
 * the page's default export wraps in `<ViewerI18nProvider>`, so `t` always
 * resolves here. The early-exit `getStaticProps` branches (a link that failed
 * to load, or a frozen data room read before the brand is known) ship no
 * bundles — those fall back to English, which is the best we can do without a
 * resolved brand locale.
 */
export function ViewerNotFound({ reason }: { reason: ViewerNotFoundReason }) {
  const { t } = useTranslation("viewer");

  return (
    <NotFound
      eyebrow={t("notFound.eyebrow", "404 error")}
      title={t("notFound.title", "Page not found.")}
      message={t(`notFound.reasons.${reason}`, REASONS[reason])}
      homeLabel={t("notFound.goHome", "Go back home")}
    />
  );
}
