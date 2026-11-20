import { parsePageId } from "notion-utils";

export type ViewerHref =
  | { kind: "page"; pageId: string }
  | { kind: "other"; href: string; openInNewTab: boolean };

function normalizePageId(value: string): string | null {
  return parsePageId(value, { uuid: false }) ?? null;
}

export function getViewerPageIdFromHref(href: string): string | null {
  try {
    const url = new URL(href, "http://local.invalid");
    const fromQuery = url.searchParams.get("pageid");
    if (fromQuery) {
      return normalizePageId(fromQuery);
    }

    const pathId = normalizePageId(url.pathname);
    if (!pathId) return null;

    const stripped = url.pathname.replace(/^\/|\/$/g, "").replace(/-/g, "");
    if (stripped.toLowerCase() === pathId) {
      return pathId;
    }

    if (url.origin !== "http://local.invalid") {
      return null;
    }

    return pathId;
  } catch {
    return normalizePageId(href);
  }
}

export function classifyViewerHref(href: string | undefined): ViewerHref | null {
  if (!href) return null;

  const pageId = getViewerPageIdFromHref(href);
  if (pageId) {
    return { kind: "page", pageId };
  }

  return {
    kind: "other",
    href,
    openInNewTab: /^https?:\/\//i.test(href) || href.startsWith("//"),
  };
}

export function toViewerPageHref(pageId: string): string {
  const id = normalizePageId(pageId) ?? pageId.replace(/-/g, "");
  return `?pageid=${id}`;
}
