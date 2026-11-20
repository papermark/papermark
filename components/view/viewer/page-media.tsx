import React from "react";

import {
  resolvePageLinkKind,
  type MediaPageLink,
  type PageLink,
  type RegularPageLink,
} from "@/lib/types/page-link";

import { MediaVideoOverlay } from "./media-video-overlay";

export const scaleCoordinates = (coords: string, scaleFactor: number) => {
  return coords
    .split(",")
    .map((coord) => parseFloat(coord) * scaleFactor)
    .join(",");
};

/**
 * Splits a page's link entries into clickable hyperlinks and media overlays
 * (animated GIFs / embedded videos). Falls back to the legacy convention of
 * treating any href ending in `.gif` as an animated overlay.
 */
export function partitionPageLinks(pageLinks: PageLink[]): {
  links: RegularPageLink[];
  media: MediaPageLink[];
} {
  const links: RegularPageLink[] = [];
  const media: MediaPageLink[] = [];
  for (const link of pageLinks) {
    const kind = resolvePageLinkKind(link);
    if (kind === "link") {
      const href = "href" in link ? (link.href ?? "") : "";
      if (!href) continue;
      const regular = link as RegularPageLink;
      links.push({
        href,
        coords: regular.coords,
        ...(regular.isInternal ? { isInternal: regular.isInternal } : {}),
        ...(regular.targetPage ? { targetPage: regular.targetPage } : {}),
      });
    } else {
      // Promote legacy gif-by-href entries into the new shape.
      const media_link: MediaPageLink = {
        kind,
        coords: link.coords,
        ...("href" in link && link.href ? { href: link.href } : {}),
        ...("posterUrl" in link && link.posterUrl
          ? { posterUrl: link.posterUrl }
          : {}),
        ...("naturalWidth" in link && link.naturalWidth
          ? { naturalWidth: link.naturalWidth }
          : {}),
        ...("naturalHeight" in link && link.naturalHeight
          ? { naturalHeight: link.naturalHeight }
          : {}),
      };
      if (media_link.href) media.push(media_link);
    }
  }
  return { links, media };
}

export function renderMediaOverlay({
  key,
  link,
  displayScale,
  leftOffset,
  topOffset = 0,
  isCurrentPage,
}: {
  key: string;
  link: MediaPageLink;
  displayScale: number;
  leftOffset: number;
  topOffset?: number;
  isCurrentPage: boolean;
}) {
  if (!link.href) return null;
  const [x1, y1, x2, y2] = scaleCoordinates(link.coords, displayScale)
    .split(",")
    .map(Number);
  const overlayWidth = x2 - x1;
  const overlayHeight = y2 - y1;
  const style: React.CSSProperties = {
    position: "absolute",
    top: y1 + topOffset,
    left: x1 + leftOffset,
    width: `${overlayWidth}px`,
    height: `${overlayHeight}px`,
  };

  if (link.kind === "video") {
    return (
      <MediaVideoOverlay
        key={key}
        src={link.href}
        poster={link.posterUrl}
        isCurrentPage={isCurrentPage}
        style={{ ...style, background: "black" }}
      />
    );
  }

  return (
    <img
      key={key}
      src={link.href}
      alt="Animated overlay"
      style={{ ...style, pointerEvents: "none" }}
    />
  );
}
