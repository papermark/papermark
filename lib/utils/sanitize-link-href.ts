/**
 * Page links come from document content and are rendered as clickable overlays.
 * Only allow same-page anchors and http(s)/mailto/tel URLs so unsafe schemes
 * (e.g. javascript:) can never be wired up to a click target. Returns the
 * original href when safe, or null when it should not be rendered.
 */
export const getSafeLinkHref = (href: string): string | null => {
  if (href.startsWith("#")) {
    return href;
  }
  try {
    const base =
      typeof window !== "undefined" ? window.location.href : "http://localhost";
    const url = new URL(href, base);
    if (
      url.protocol === "http:" ||
      url.protocol === "https:" ||
      url.protocol === "mailto:" ||
      url.protocol === "tel:"
    ) {
      return href;
    }
  } catch {
    return null;
  }
  return null;
};
