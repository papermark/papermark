import { useRouter } from "next/router";

import React, { useEffect, useRef, useState } from "react";

import { ConfidentialViewOverlay } from "@/ee/features/permissions/components/confidential-view/confidential-view-overlay";
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";

import { useDisablePullToRefresh } from "@/lib/hooks/use-disable-pull-to-refresh";
import {
  getRotationLayerStyle,
  useFullscreen,
} from "@/lib/hooks/use-fullscreen";
import { useTouchZoom } from "@/lib/hooks/use-touch-zoom";
import {
  useViewerKeyboardShortcuts,
  useViewerPageKeyboardShortcuts,
} from "@/lib/hooks/use-viewer-keyboard-shortcuts";
import { useSafePageViewTracker } from "@/lib/tracking/safe-page-view-tracker";
import { getTrackingOptions } from "@/lib/tracking/tracking-config";
import { WatermarkConfig } from "@/lib/types";
import { type PageLink } from "@/lib/types/page-link";
import { cn } from "@/lib/utils";
import { getSafeLinkHref } from "@/lib/utils/sanitize-link-href";
import { useMediaQuery } from "@/lib/utils/use-media-query";

import { ScreenProtector } from "../ScreenProtection";
import Nav, { TNavData } from "../nav";
import { PoweredBy } from "../powered-by";
import Question from "../question";
import Toolbar from "../toolbar";
import { ViewerThemeColor } from "../viewer-theme-color";
import { SVGWatermark } from "../watermark-svg";
import { AwayPoster } from "./away-poster";
import { FullscreenControls } from "./fullscreen-controls";
import {
  partitionPageLinks,
  renderMediaOverlay,
  scaleCoordinates,
} from "./page-media";

import "@/styles/custom-viewer-styles.css";

const calculateOptimalWidth = (
  containerWidth: number,
  metadata: { width: number; height: number } | null,
  isMobile: boolean,
  isTablet: boolean,
) => {
  if (!metadata) {
    // Fallback dimensions if metadata is null
    return isMobile ? containerWidth : Math.min(800, containerWidth * 0.6);
  }

  const aspectRatio = metadata.width / metadata.height;
  const maxWidth = Math.min(1400, containerWidth); // 100% of container width, max 1400px
  const minWidth = Math.min(
    800,
    isTablet ? containerWidth * 0.9 : containerWidth * 0.6,
  ); // 60% of container width, min 600px

  // For landscape documents (width > height), use more width
  if (aspectRatio > 1) {
    return maxWidth;
  }

  // For portrait documents, use full width on mobile, min width on desktop
  return isMobile ? containerWidth : minWidth;
};

export default function PagesVerticalViewer({
  pages,
  feedbackEnabled,
  screenshotProtectionEnabled,
  confidentialViewEnabled,
  versionNumber,
  showPoweredByBanner,
  enableQuestion = false,
  feedback,
  viewerEmail,
  watermarkConfig,
  ipAddress,
  linkName,
  navData,
  ensurePagesLoaded,
}: {
  pages: {
    file: string | null;
    pageNumber: string;
    embeddedLinks: string[];
    pageLinks?: PageLink[] | null;
    metadata: { width: number; height: number; scaleFactor: number } | null;
  }[];
  feedbackEnabled: boolean;
  screenshotProtectionEnabled: boolean;
  confidentialViewEnabled?: boolean;
  versionNumber: number;
  showPoweredByBanner?: boolean;
  enableQuestion?: boolean | null;
  feedback?: {
    id: string;
    data: { question: string; type: string };
  } | null;
  viewerEmail?: string;
  watermarkConfig?: WatermarkConfig | null;
  ipAddress?: string;
  linkName?: string;
  navData: TNavData;
  ensurePagesLoaded?: (currentPage: number) => void;
}) {
  const { linkId, documentId, viewId, isPreview, dataroomId, brand } = navData;
  const { isMobile, isTablet } = useMediaQuery();

  // Viewer's chosen background color; fills the fullscreen background and tints
  // the browser chrome instead of a hard black.
  const viewerBackgroundColor = brand?.accentColor || "rgb(3, 7, 18)";

  const router = useRouter();
  const {
    isFullscreen,
    isPseudoFullscreen,
    toggleFullscreen,
    rotation,
    rotate,
  } = useFullscreen();

  useDisablePullToRefresh(isMobile);

  const numPages = pages.length;
  const numPagesWithFeedback =
    enableQuestion && feedback ? numPages + 1 : numPages;

  const pageQuery = router.query.p ? Number(router.query.p) : 1;

  const [pageNumber, setPageNumber] = useState<number>(() =>
    pageQuery >= 1 && pageQuery <= numPages ? pageQuery : 1,
  ); // start on first page

  const [submittedFeedback, setSubmittedFeedback] = useState<boolean>(false);
  const [scale, setScale] = useState<number>(1);
  // Unscaled layout size of the zoom content, used to reserve the scaled
  // scroll area (a sizer) so pinch-zoom can pan in both axes. `offsetWidth`
  // and `offsetHeight` are layout metrics unaffected by the CSS transform, so
  // this stays the base size regardless of the current scale.
  const [baseSize, setBaseSize] = useState<{
    width: number;
    height: number;
  } | null>(null);

  const [viewedPages, setViewedPages] = useState<
    { pageNumber: number; duration: number }[]
  >(() =>
    Array.from({ length: numPages }, (_, index) => ({
      pageNumber: index + 1,
      duration: 0,
    })),
  );

  const [isWindowFocused, setIsWindowFocused] = useState(true);

  const startTimeRef = useRef(Date.now());
  const containerRef = useRef<HTMLDivElement>(null);
  const zoomContentRef = useRef<HTMLDivElement>(null);
  const scrollActionRef = useRef<boolean>(false);
  const scrollEndTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const imageRefs = useRef<(HTMLImageElement | null)[]>([]);

  const [imageDimensions, setImageDimensions] = useState<
    Record<number, { width: number; height: number }>
  >({});
  const getScaleFactor = ({
    naturalHeight,
    scaleFactor,
    pageIndex,
  }: {
    naturalHeight: number;
    scaleFactor: number;
    pageIndex: number;
  }) => {
    const containerHeight = imageDimensions[pageIndex]
      ? imageDimensions[pageIndex]!.height
      : window.innerHeight - 64;

    // Add a safety check to prevent division by zero
    if (!naturalHeight || naturalHeight === 0) {
      return scaleFactor;
    }

    return (scaleFactor * containerHeight) / naturalHeight;
  };

  useEffect(() => {
    const updateImageDimensions = () => {
      const newDimensions: Record<number, { width: number; height: number }> =
        {};
      imageRefs.current.forEach((img, index) => {
        if (img) {
          newDimensions[index] = {
            width: img.clientWidth,
            height: img.clientHeight,
          };
        }
      });
      setImageDimensions(newDimensions);
    };

    updateImageDimensions();
    window.addEventListener("resize", updateImageDimensions);

    return () => {
      window.removeEventListener("resize", updateImageDimensions);
    };
  }, [pageNumber]);

  const {
    trackPageViewSafely,
    resetTrackingState,
    startIntervalTracking,
    stopIntervalTracking,
    getActiveDuration,
    isInactive,
    updateActivity,
  } = useSafePageViewTracker({
    ...getTrackingOptions(),
    externalStartTimeRef: startTimeRef,
  });

  useEffect(() => {
    if (pageNumber <= numPages) {
      const trackingData = {
        linkId,
        documentId,
        viewId,
        pageNumber: pageNumber,
        versionNumber,
        dataroomId,
        setViewedPages,
        isPreview,
      };

      startIntervalTracking(trackingData);
    }

    return () => {
      stopIntervalTracking();
    };
  }, [
    pageNumber,
    numPages,
    linkId,
    documentId,
    viewId,
    versionNumber,
    dataroomId,
    isPreview,
    startIntervalTracking,
    stopIntervalTracking,
  ]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (pageNumber > numPages) return;

      if (document.visibilityState === "visible") {
        resetTrackingState();

        if (pageNumber <= numPages) {
          const trackingData = {
            linkId,
            documentId,
            viewId,
            pageNumber: pageNumber,
            versionNumber,
            dataroomId,
            setViewedPages,
            isPreview,
          };
          startIntervalTracking(trackingData);
        }
      } else {
        stopIntervalTracking();

        // Track final duration using activity-aware calculation
        if (pageNumber <= numPages) {
          const duration = getActiveDuration();
          trackPageViewSafely(
            {
              linkId,
              documentId,
              viewId,
              duration,
              pageNumber: pageNumber,
              versionNumber,
              dataroomId,
              setViewedPages,
              isPreview,
            },
            true,
          );
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [
    pageNumber,
    numPages,
    linkId,
    documentId,
    viewId,
    versionNumber,
    dataroomId,
    isPreview,
    trackPageViewSafely,
    resetTrackingState,
    startIntervalTracking,
    stopIntervalTracking,
    getActiveDuration,
  ]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      stopIntervalTracking();
      if (pageNumber <= numPages) {
        const duration = getActiveDuration();
        trackPageViewSafely(
          {
            linkId,
            documentId,
            viewId,
            duration,
            pageNumber: pageNumber,
            versionNumber,
            dataroomId,
            setViewedPages,
            isPreview,
          },
          true,
        );
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [
    pageNumber,
    numPages,
    linkId,
    documentId,
    viewId,
    versionNumber,
    dataroomId,
    isPreview,
    trackPageViewSafely,
    stopIntervalTracking,
    getActiveDuration,
  ]);

  // Add this effect near your other useEffect hooks
  useEffect(() => {
    if (!screenshotProtectionEnabled) return;

    const handleFocus = () => setIsWindowFocused(true);
    const handleBlur = () => setIsWindowFocused(false);

    window.addEventListener("focus", handleFocus);
    window.addEventListener("blur", handleBlur);

    return () => {
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("blur", handleBlur);
    };
  }, [screenshotProtectionEnabled]);

  useEffect(() => {
    ensurePagesLoaded?.(pageNumber);
  }, [pageNumber, ensurePagesLoaded]);

  useEffect(() => {
    // Remove token and email query parameters on component mount
    const removeQueryParams = (queries: string[]) => {
      const currentQuery = { ...router.query };
      const currentPath = router.asPath.split("?")[0];
      queries.forEach((query) => delete currentQuery[query]);

      router.replace(
        {
          pathname: currentPath,
          query: currentQuery,
        },
        undefined,
        { shallow: true },
      );
    };

    if (router.isReady && !dataroomId && router.query.token) {
      removeQueryParams(["token", "email", "domain", "slug", "linkId"]);
    }
  }, [dataroomId, router, router.isReady]);

  const handleScroll = () => {
    const container = containerRef.current;
    if (!container) return;

    if (scrollActionRef.current) return;

    const containerRect = container.getBoundingClientRect();

    // Find which page is most visible in the viewport
    let maxVisiblePage = pageNumber;
    let maxVisibleArea = 0;

    imageRefs.current.forEach((img, index) => {
      if (!img) return;

      const rect = img.getBoundingClientRect();
      const visibleHeight =
        Math.min(rect.bottom, containerRect.bottom) -
        Math.max(rect.top, containerRect.top);
      const visibleArea = Math.max(0, visibleHeight);

      if (visibleArea > maxVisibleArea) {
        maxVisibleArea = visibleArea;
        maxVisiblePage = index + 1;
      }
    });

    const feedbackElement = document.getElementById("feedback-question");
    if (feedbackElement) {
      const feedbackRect = feedbackElement.getBoundingClientRect();
      const isFeedbackVisible =
        feedbackRect.top < containerRect.bottom &&
        feedbackRect.bottom > containerRect.top;

      if (isFeedbackVisible) {
        setPageNumber(numPagesWithFeedback);
        startTimeRef.current = Date.now();
        return;
      }
    }

    if (maxVisiblePage !== pageNumber) {
      if (pageNumber <= numPages) {
        const duration = getActiveDuration();
        trackPageViewSafely({
          linkId,
          documentId,
          viewId,
          duration,
          pageNumber: pageNumber,
          versionNumber,
          dataroomId,
          setViewedPages,
          isPreview,
        });
      }

      setPageNumber(maxVisiblePage);
      startTimeRef.current = Date.now();
    }
  };

  const goToPreviousPage = () => {
    if (pageNumber <= 1) return;
    if (enableQuestion && feedback && pageNumber === numPagesWithFeedback) {
      const targetImg = imageRefs.current[pageNumber - 2];
      if (targetImg) {
        targetImg.scrollIntoView({ behavior: "smooth", block: "start" });
        setPageNumber(pageNumber - 1);
        startTimeRef.current = Date.now();
      }
      return;
    }

    if (pageNumber === numPagesWithFeedback + 1) {
      const targetImg = imageRefs.current[pageNumber - 2];
      if (targetImg) {
        targetImg.scrollIntoView({ behavior: "smooth", block: "start" });
        setPageNumber(pageNumber - 1);
        startTimeRef.current = Date.now();
      }
      return;
    }

    const duration = getActiveDuration();
    trackPageViewSafely({
      linkId,
      documentId,
      viewId,
      duration,
      pageNumber: pageNumber,
      versionNumber,
      dataroomId,
      setViewedPages,
      isPreview,
    });

    const targetImg = imageRefs.current[pageNumber - 2];
    if (targetImg) {
      targetImg.scrollIntoView({ behavior: "smooth", block: "start" });
      setPageNumber(pageNumber - 1);
      startTimeRef.current = Date.now();
    }
  };

  const goToNextPage = () => {
    if (pageNumber >= numPagesWithFeedback) return;

    if (pageNumber === numPages && enableQuestion && feedback) {
      const feedbackElement = document.getElementById("feedback-question");
      if (feedbackElement) {
        feedbackElement.scrollIntoView({ behavior: "smooth", block: "start" });
        setPageNumber(numPagesWithFeedback);
        startTimeRef.current = Date.now();
      }
      return;
    }

    if (pageNumber > numPages) {
      const targetImg = imageRefs.current[pageNumber];
      if (targetImg) {
        targetImg.scrollIntoView({ behavior: "smooth", block: "start" });
        setPageNumber(pageNumber + 1);
        startTimeRef.current = Date.now();
      }
      return;
    }

    const duration = getActiveDuration();
    trackPageViewSafely({
      linkId,
      documentId,
      viewId,
      duration,
      pageNumber: pageNumber,
      versionNumber,
      dataroomId,
      setViewedPages,
      isPreview,
    });

    const targetImg = imageRefs.current[pageNumber];
    if (targetImg) {
      targetImg.scrollIntoView({ behavior: "smooth", block: "start" });
      setPageNumber(pageNumber + 1);
      startTimeRef.current = Date.now();
    }
  };

  useViewerPageKeyboardShortcuts({
    orientation: "vertical",
    onPreviousPage: goToPreviousPage,
    onNextPage: goToNextPage,
  });

  const handleLinkClick = (href: string, event: React.MouseEvent) => {
    // Check if it's an internal page link or external link
    const pageMatch = href.match(/#page=(\d+)/);
    if (pageMatch) {
      event.preventDefault();
      const targetPage = parseInt(pageMatch[1]);
      if (targetPage >= 1 && targetPage <= numPages) {
        // Track the current page before jumping
        const duration = getActiveDuration();
        trackPageViewSafely({
          linkId,
          documentId,
          viewId,
          duration,
          pageNumber: pageNumber,
          versionNumber,
          dataroomId,
          setViewedPages,
          isPreview,
        });

        setPageNumber(targetPage);

        // Wait for images to load before scrolling
        const waitForImageAndScroll = () => {
          const targetImg = imageRefs.current[targetPage - 1];

          // Check if target image exists and is loaded
          if (targetImg && targetImg.complete && targetImg.naturalHeight > 0) {
            scrollActionRef.current = true;
            targetImg.scrollIntoView({ behavior: "smooth", block: "start" });
            return;
          }

          // If image element exists but not loaded, wait for it
          if (targetImg) {
            const handleLoad = () => {
              scrollActionRef.current = true;
              targetImg.scrollIntoView({ behavior: "smooth", block: "start" });
              targetImg.removeEventListener("load", handleLoad);
            };
            targetImg.addEventListener("load", handleLoad);

            // Timeout fallback in case image is already cached but complete wasn't set
            setTimeout(() => {
              targetImg.removeEventListener("load", handleLoad);
              if (targetImg) {
                scrollActionRef.current = true;
                targetImg.scrollIntoView({
                  behavior: "smooth",
                  block: "start",
                });
              }
            }, 500);
            return;
          }

          // Image ref not available yet, wait for React to render
          requestAnimationFrame(waitForImageAndScroll);
        };

        // Start checking after React processes the state update
        requestAnimationFrame(() => {
          requestAnimationFrame(waitForImageAndScroll);
        });

        // Reset the start time for the new page
        startTimeRef.current = Date.now();
      }
    } else {
      // Track external link clicks
      if (!isPreview && viewId) {
        fetch("/api/record_click", {
          method: "POST",
          body: JSON.stringify({
            timestamp: new Date().toISOString(),
            sessionId: viewId,
            linkId,
            documentId,
            viewId,
            pageNumber: pageNumber.toString(),
            href,
            versionNumber,
            dataroomId,
          }),
          headers: {
            "Content-Type": "application/json",
          },
        }).catch(console.error); // Non-blocking
      }
    }
  };

  const handleScrollRef = useRef(handleScroll);
  handleScrollRef.current = handleScroll;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handler = () => {
      handleScrollRef.current();

      if (scrollActionRef.current) {
        if (scrollEndTimeoutRef.current)
          clearTimeout(scrollEndTimeoutRef.current);
        scrollEndTimeoutRef.current = setTimeout(() => {
          scrollActionRef.current = false;
        }, 150);
      }
    };
    container.addEventListener("scroll", handler, { passive: true });

    return () => {
      container.removeEventListener("scroll", handler);
      if (scrollEndTimeoutRef.current)
        clearTimeout(scrollEndTimeoutRef.current);
    };
  }, []);

  const [containerWidth, setContainerWidth] = useState<number>(0);
  const [containerHeight, setContainerHeight] = useState<number>(0);

  // Add resize observer to track container width and height
  useEffect(() => {
    if (!containerRef.current) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
        setContainerHeight(entry.contentRect.height);
      }
    });

    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  // Rotating the viewport (and the container resize it triggers) changes each
  // page's rendered size, but per-page dimensions are otherwise only captured on
  // `img.onload`. Re-measure once the post-rotation layout has committed so the
  // dynamic watermark and link overlays — both sized from `imageDimensions` —
  // keep covering the rotated pages instead of using stale upright dimensions.
  useEffect(() => {
    if (typeof window === "undefined") return;

    const measure = () => {
      setImageDimensions((prev) => {
        let changed = false;
        const next = { ...prev };
        imageRefs.current.forEach((img, index) => {
          if (!img) return;
          const width = img.clientWidth;
          const height = img.clientHeight;
          if (!width || !height) return;
          const existing = next[index];
          if (
            !existing ||
            existing.width !== width ||
            existing.height !== height
          ) {
            next[index] = { width, height };
            changed = true;
          }
        });
        return changed ? next : prev;
      });
    };

    const raf = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(raf);
  }, [rotation, isFullscreen, isPseudoFullscreen, containerWidth, containerHeight]);

  const handleZoomIn = () => {
    setScale((prev) => Math.min(prev + 0.25, 3)); // Max zoom 3x
  };

  const handleZoomOut = () => {
    setScale((prev) => Math.max(prev - 0.25, 0.5)); // Min zoom 0.5x
  };

  useViewerKeyboardShortcuts({
    onZoomIn: handleZoomIn,
    onZoomOut: handleZoomOut,
    onResetZoom: () => setScale(1),
    onToggleFullscreen: toggleFullscreen,
  });

  const { isPinching } = useTouchZoom({
    containerRef,
    scale,
    setScale,
    minScale: 1,
    maxScale: 3,
    enabled: isMobile,
  });

  // Measure the unscaled content size so the sizer can reserve the scaled
  // scroll area. Re-measures as pages load (height grows) or the viewport
  // resizes (width changes); the transform never changes these layout metrics,
  // so observing the content element does not feed back into itself.
  useEffect(() => {
    const el = zoomContentRef.current;
    if (!el) return;
    const measure = () =>
      setBaseSize({ width: el.offsetWidth, height: el.offsetHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // In fullscreen a non-zero rotation turns the viewport into a fixed, rotated
  // full-viewport layer (see getRotationLayerStyle); otherwise it just sizes to
  // the available height. The scroll container fills the swapped box, so the
  // ResizeObserver reports the rotated width/height and the per-page fullscreen
  // sizing below scales each page to the physical viewport height automatically.
  const viewportStyle = (isFullscreen &&
    getRotationLayerStyle(rotation, viewerBackgroundColor)) || {
    height: isPseudoFullscreen ? "100dvh" : "calc(100dvh - 64px)",
  };

  // Pseudo-fullscreen (iPhone, no native Fullscreen API) hides the navbar, so
  // this overlay is the only way to rotate or exit and must stay regardless of
  // the viewport breakpoint — an iPhone rotated to landscape reports > 640px,
  // which flips `isMobile` to false and would otherwise strand the viewer.
  const showFullscreenOverlay = isFullscreen && (isMobile || isPseudoFullscreen);

  return (
    <div
      className={cn(isPseudoFullscreen && "fixed inset-0 z-[60]")}
      style={
        isPseudoFullscreen
          ? { backgroundColor: viewerBackgroundColor }
          : undefined
      }
    >
      {/* While presenting, tint the browser chrome to the viewer background
          (accent) so iOS Safari's status-bar/safe-area matches the immersive
          document instead of the brand-colored top bar. Rendering it here (a
          deeper next/head entry than the base brand ViewerThemeColor) makes the
          accent win, and it reverts on exit. */}
      {isFullscreen && <ViewerThemeColor color={viewerBackgroundColor} />}
      {!isPseudoFullscreen && (
        <Nav
          pageNumber={pageNumber}
          numPages={numPagesWithFeedback}
          embeddedLinks={pages[pageNumber - 1]?.embeddedLinks}
          hasWatermark={watermarkConfig ? true : false}
          handleZoomIn={handleZoomIn}
          handleZoomOut={handleZoomOut}
          handleFullscreen={toggleFullscreen}
          isFullscreen={isFullscreen}
          navData={navData}
        />
      )}
      <div style={viewportStyle} className="relative overflow-hidden">
        <div className="h-full w-full">
          {/* Document Content */}
          <div className="h-full w-full">
            <div
              className={cn(
                "h-full w-full",
                "overflow-auto",
                // Disable smooth scrolling while pinching so the focal-point
                // scroll compensation lands instantly instead of animating and
                // drifting out from under the fingers.
                !isPinching && "scroll-smooth",
                !isWindowFocused &&
                  screenshotProtectionEnabled &&
                  "blur-xl transition-all duration-300",
              )}
              style={isMobile ? { touchAction: "pan-x pan-y" } : undefined}
              ref={containerRef}
            >
              {/* Sizer: `margin: 0 auto` centers the content when it fits and
                  left-aligns it (scrollable from the left edge) once it grows
                  wider than the viewport — unlike flex centering, which clips
                  the overflowing start. Locks to the scaled dimensions only
                  when zoomed so default layout stays responsive. */}
              <div
                className="mx-auto"
                style={
                  scale > 1 && baseSize
                    ? {
                        width: `${baseSize.width * scale}px`,
                        height: `${baseSize.height * scale}px`,
                      }
                    : { width: "fit-content" }
                }
              >
                <div
                  ref={zoomContentRef}
                  className="transform-container"
                  style={{
                    width: "fit-content",
                    transform: `scale(${scale})`,
                    transition: isPinching ? "none" : "transform 0.2s ease-out",
                    transformOrigin: "0 0",
                  }}
                >
                  <div
                    className="flex flex-col items-center gap-2"
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                  >
                    {pages.map((page, index) => {
                      const aspectRatio =
                        page.metadata && page.metadata.height > 0
                          ? page.metadata.width / page.metadata.height
                          : 0;
                      // In fullscreen scale each page up to fill the viewport
                      // height (bounded by the container width) so a render
                      // smaller than the screen still fills it, instead of
                      // sitting at the default max width.
                      const optimalWidth =
                        isFullscreen && containerHeight && aspectRatio
                          ? Math.min(
                              containerWidth,
                              containerHeight * aspectRatio,
                            )
                          : containerWidth
                            ? calculateOptimalWidth(
                                containerWidth,
                                page.metadata,
                                isMobile,
                                isTablet,
                              )
                            : 800;

                      // Calculate placeholder height from metadata aspect ratio
                      const placeholderHeight =
                        page.metadata && page.metadata.width > 0
                          ? (optimalWidth * page.metadata.height) /
                            page.metadata.width
                          : 600; // fallback height

                      if (!page.file) {
                        // Render a placeholder div with correct dimensions to preserve scroll height
                        return (
                          <div
                            key={index}
                            className="relative w-full px-4 md:px-8"
                            style={{
                              width: `${optimalWidth}px`,
                            }}
                          >
                            <div
                              className="viewer-container relative border-b border-t border-gray-100 bg-gray-50"
                              style={{
                                height: `${placeholderHeight}px`,
                              }}
                            />
                          </div>
                        );
                      }

                      return (
                        <div
                          key={index}
                          className="relative w-full px-4 md:px-8"
                          style={{
                            width: `${optimalWidth}px`,
                          }}
                        >
                          <div className="viewer-container relative border-b border-t border-gray-100">
                            <div
                              className="pointer-events-none absolute bottom-0 left-0 w-px"
                              style={{
                                height: "10%",
                                background:
                                  "linear-gradient(to top, #f3f4f6, transparent)",
                              }}
                            />
                            <div
                              className="pointer-events-none absolute bottom-0 right-0 w-px"
                              style={{
                                height: "10%",
                                background:
                                  "linear-gradient(to top, #f3f4f6, transparent)",
                              }}
                            />
                            <div
                              className="pointer-events-none absolute left-0 top-0 w-px"
                              style={{
                                height: "10%",
                                background:
                                  "linear-gradient(to bottom, #f3f4f6, transparent)",
                              }}
                            />
                            <div
                              className="pointer-events-none absolute right-0 top-0 w-px"
                              style={{
                                height: "10%",
                                background:
                                  "linear-gradient(to bottom, #f3f4f6, transparent)",
                              }}
                            />
                            <img
                              className="viewer-image-mobile h-auto w-full object-contain"
                              onContextMenu={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                              }}
                              ref={(ref) => {
                                imageRefs.current[index] = ref;
                                if (ref) {
                                  ref.onload = () =>
                                    setImageDimensions((prev) => ({
                                      ...prev,
                                      [index]: {
                                        width: ref.clientWidth,
                                        height: ref.clientHeight,
                                      },
                                    }));
                                }
                              }}
                              useMap={`#page-map-${index + 1}`}
                              src={page.file}
                              alt={`Page ${index + 1}`}
                            />

                            {watermarkConfig && imageDimensions[index] ? (
                              <div
                                className="pointer-events-none absolute left-0 top-0"
                                style={{ zIndex: 20 }}
                              >
                                <SVGWatermark
                                  config={watermarkConfig}
                                  viewerData={{
                                    email: viewerEmail,
                                    date: new Date().toLocaleDateString(),
                                    time: new Date().toLocaleTimeString(),
                                    link: linkName,
                                    ipAddress: ipAddress,
                                  }}
                                  documentDimensions={imageDimensions[index]}
                                  pageIndex={index}
                                />
                              </div>
                            ) : null}
                          </div>

                          {(() => {
                            if (!page.pageLinks) return null;
                            const { links, media } = partitionPageLinks(
                              page.pageLinks,
                            );
                            const displayScale = getScaleFactor({
                              naturalHeight: page.metadata?.height ?? 0,
                              scaleFactor: page.metadata?.scaleFactor ?? 1,
                              pageIndex: index,
                            });
                            // Vertical layout uses px-4/md:px-8 outer padding
                            // instead of a center-aligned image, so the overlay
                            // origin is shifted by the active padding.
                            const leftOffset = isMobile ? 16 : 32;
                            const isCurrentPage = pageNumber === index + 1;

                            return (
                              <>
                                {links.length > 0 ? (
                                  <map name={`page-map-${index + 1}`}>
                                    {links.map((link, linkIndex) => {
                                      const safeHref = getSafeLinkHref(
                                        link.href,
                                      );
                                      if (!safeHref) {
                                        return null;
                                      }
                                      const isInternal =
                                        safeHref.startsWith("#");
                                      return (
                                        <area
                                          key={linkIndex}
                                          shape="rect"
                                          coords={scaleCoordinates(
                                            link.coords,
                                            displayScale,
                                          )}
                                          href={safeHref}
                                          onClick={(e) =>
                                            handleLinkClick(safeHref, e)
                                          }
                                          target={
                                            isInternal ? "_self" : "_blank"
                                          }
                                          rel={
                                            isInternal
                                              ? undefined
                                              : "noopener noreferrer"
                                          }
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
                                        displayScale,
                                        leftOffset,
                                        isCurrentPage,
                                      }),
                                    )
                                  : null}
                              </>
                            );
                          })()}
                        </div>
                      );
                    })}

                    {enableQuestion &&
                      feedback &&
                      pageNumber >= numPagesWithFeedback - 1 && (
                        <div
                          id="feedback-question"
                          className={cn("relative block h-dvh w-full")}
                          style={{ height: "calc(100dvh - 64px)" }}
                        >
                          <Question
                            accentColor={brand?.accentColor}
                            feedback={feedback}
                            viewId={viewId}
                            submittedFeedback={submittedFeedback}
                            setSubmittedFeedback={setSubmittedFeedback}
                            isPreview={isPreview}
                          />
                        </div>
                      )}
                  </div>
                </div>
              </div>
            </div>

            {/* Up/down chevron tap-zones are a desktop-hover affordance
                (`opacity-0 hover:opacity-100`). On touch devices `hover:`
                is unreliable and the strips become invisible-but-tap-active
                — every attempt to scroll near the top/bottom 96px would
                fire a page jump instead. We render them on non-mobile only.
                On mobile the user navigates by scrolling, which is now the
                natural gesture both inside and outside the fence. */}
            {!isMobile && (
              <>
                {/* Up arrow - hide on first page */}
                <div
                  className={cn(
                    "absolute left-0 right-0 top-0 flex h-24 items-start justify-center pt-4 transition-opacity duration-200",
                    pageNumber <= 1 ? "hidden" : "opacity-0 hover:opacity-100",
                  )}
                  onClick={goToPreviousPage}
                >
                  <button
                    disabled={pageNumber <= 1}
                    className="rounded-full bg-gray-950/50 p-1 hover:bg-gray-950/75"
                  >
                    <ChevronUpIcon className="h-10 w-10 text-white" />
                  </button>
                </div>

                {/* Down arrow - hide on last page unless there's an account creation page */}
                <div
                  className={cn(
                    "absolute bottom-0 left-0 right-0 flex h-24 items-end justify-center pb-4 transition-opacity duration-200",
                    pageNumber >= numPagesWithFeedback
                      ? "hidden"
                      : "opacity-0 hover:opacity-100",
                  )}
                  onClick={goToNextPage}
                >
                  <button
                    disabled={pageNumber >= numPagesWithFeedback}
                    className="rounded-full bg-gray-950/50 p-1 hover:bg-gray-950/75"
                  >
                    <ChevronDownIcon className="h-10 w-10 text-white" />
                  </button>
                </div>
              </>
            )}

            {feedbackEnabled && pageNumber <= numPages ? (
              <Toolbar
                viewId={viewId}
                pageNumber={pageNumber}
                isPreview={isPreview}
              />
            ) : null}

            {screenshotProtectionEnabled ? <ScreenProtector /> : null}
            {confidentialViewEnabled ? (
              <ConfidentialViewOverlay
                navbarAbove={!isPseudoFullscreen && rotation === 0}
                rotation={rotation}
              />
            ) : null}
            {showPoweredByBanner ? <PoweredBy linkId={linkId} /> : null}
            <AwayPoster
              isVisible={isInactive}
              inactivityThreshold={
                getTrackingOptions().inactivityThreshold || 20000
              }
              onDismiss={updateActivity}
            />
          </div>
        </div>
        {/* Placed inside the viewport so the rotate/exit buttons rotate with
            the presentation and land at the presentation's top-right (not the
            physical screen's) after a quarter turn, matching the horizontal
            viewer. */}
        {showFullscreenOverlay ? (
          <FullscreenControls
            showRotate
            onRotate={rotate}
            onExit={toggleFullscreen}
          />
        ) : null}
      </div>
    </div>
  );
}
