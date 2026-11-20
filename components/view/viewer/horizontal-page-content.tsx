import type { MouseEvent, MutableRefObject } from "react";

import { getContainedImageRect } from "@/lib/hooks/use-fullscreen";
import { WatermarkConfig } from "@/lib/types";
import { type PageLink } from "@/lib/types/page-link";
import { getSafeLinkHref } from "@/lib/utils/sanitize-link-href";

import { SVGWatermark } from "../watermark-svg";
import {
  partitionPageLinks,
  renderMediaOverlay,
  scaleCoordinates,
} from "./page-media";

export type HorizontalViewerPage = {
  file: string | null;
  pageNumber: string;
  embeddedLinks: string[];
  pageLinks?: PageLink[] | null;
  metadata: { width: number; height: number; scaleFactor: number } | null;
};

type PageDimensions = Record<number, { width: number; height: number }>;

export function HorizontalPageContent({
  page,
  index,
  isCurrentPage,
  imgHeight,
  imgMaxHeight,
  imgMaxWidth,
  watermarkConfig,
  viewerEmail,
  linkName,
  ipAddress,
  imageDimensions,
  imageRefs,
  getScaleFactor,
  onImageDimensionsChange,
  onLinkClick,
}: {
  page: HorizontalViewerPage;
  index: number;
  isCurrentPage: boolean;
  imgHeight?: string;
  imgMaxHeight: string;
  imgMaxWidth?: string;
  watermarkConfig?: WatermarkConfig | null;
  viewerEmail?: string;
  linkName?: string;
  ipAddress?: string;
  imageDimensions: PageDimensions;
  imageRefs: MutableRefObject<(HTMLImageElement | null)[]>;
  getScaleFactor: ({
    naturalHeight,
    scaleFactor,
  }: {
    naturalHeight: number;
    scaleFactor: number;
  }) => number;
  onImageDimensionsChange: (
    index: number,
    dimensions: { width: number; height: number },
  ) => void;
  onLinkClick: (href: string, event: MouseEvent<HTMLAreaElement>) => void;
}) {
  // 0 makes getContainedImageRect fall back to the full element box.
  const aspectRatio =
    page.metadata && page.metadata.height > 0
      ? page.metadata.width / page.metadata.height
      : 0;

  const watermarkBox = imageDimensions[index];
  const watermarkRect =
    watermarkConfig && watermarkBox
      ? getContainedImageRect(
          watermarkBox.width,
          watermarkBox.height,
          aspectRatio,
        )
      : null;

  return (
    <div className="relative w-fit">
      <img
        className="viewer-image-mobile !pointer-events-auto object-contain"
        style={{
          height: imgHeight,
          maxHeight: imgMaxHeight,
          maxWidth: imgMaxWidth,
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        ref={(ref) => {
          imageRefs.current[index] = ref;
          if (ref) {
            ref.onload = () =>
              onImageDimensionsChange(index, {
                width: ref.clientWidth,
                height: ref.clientHeight,
              });
          }
        }}
        useMap={`#page-map-${index + 1}`}
        src={page.file || "https://www.papermark.com/_static/blank.gif"}
        alt={`Page ${index + 1}`}
      />

      {watermarkConfig && watermarkRect ? (
        <div
          className="pointer-events-none absolute"
          style={{
            left: watermarkRect.left,
            top: watermarkRect.top,
            zIndex: 20,
          }}
        >
          <SVGWatermark
            config={watermarkConfig}
            viewerData={{
              email: viewerEmail,
              date: new Date().toLocaleDateString(),
              time: new Date().toLocaleTimeString(),
              link: linkName,
              ipAddress,
            }}
            documentDimensions={{
              width: watermarkRect.width,
              height: watermarkRect.height,
            }}
            pageIndex={index}
          />
        </div>
      ) : null}

      {(() => {
        if (!page.pageLinks) return null;
        const { links, media } = partitionPageLinks(page.pageLinks);
        const displayScale = getScaleFactor({
          naturalHeight: page.metadata?.height ?? 0,
          scaleFactor: page.metadata?.scaleFactor ?? 1,
        });

        // In fullscreen the <img> is given an explicit height plus
        // `object-contain`, so the visible image is letterboxed inside a larger
        // element box. Track the actual contained image rect (same math as the
        // watermark) so GIF/video overlays scale and sit on the image instead
        // of drifting into the letterbox bands and mis-scaling off the box.
        const mediaBox = imageDimensions[index];
        const mediaRect = mediaBox
          ? getContainedImageRect(mediaBox.width, mediaBox.height, aspectRatio)
          : null;
        const mediaScale =
          mediaRect && page.metadata && page.metadata.height > 0
            ? ((page.metadata.scaleFactor ?? 1) * mediaRect.height) /
              page.metadata.height
            : displayScale;
        const mediaLeftOffset = mediaRect ? mediaRect.left : 0;
        const mediaTopOffset = mediaRect ? mediaRect.top : 0;

        return (
          <>
            {links.length > 0 ? (
              <map name={`page-map-${index + 1}`}>
                {links.map((link, linkIndex) => {
                  const safeHref = getSafeLinkHref(link.href);
                  if (!safeHref) {
                    return null;
                  }
                  const isInternal = safeHref.startsWith("#");
                  return (
                    <area
                      key={linkIndex}
                      shape="rect"
                      coords={scaleCoordinates(link.coords, displayScale)}
                      href={safeHref}
                      onClick={(event) => onLinkClick(safeHref, event)}
                      target={isInternal ? "_self" : "_blank"}
                      rel={isInternal ? undefined : "noopener noreferrer"}
                    />
                  );
                })}
              </map>
            ) : null}

            {imageDimensions[index]
              ? media.map((link, linkIndex) =>
                  renderMediaOverlay({
                    key: `overlay-${index}-${linkIndex}`,
                    link,
                    displayScale: mediaScale,
                    leftOffset: mediaLeftOffset,
                    topOffset: mediaTopOffset,
                    isCurrentPage,
                  }),
                )
              : null}
          </>
        );
      })()}
    </div>
  );
}
