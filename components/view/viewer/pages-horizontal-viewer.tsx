import { useRouter } from "next/router";

import React, { useEffect, useRef, useState } from "react";

import { ConfidentialViewOverlay } from "@/ee/features/permissions/components/confidential-view/confidential-view-overlay";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useSession } from "next-auth/react";
import {
  ReactZoomPanPinchRef,
  TransformComponent,
  TransformWrapper,
} from "react-zoom-pan-pinch";

import { useAutoHideControls } from "@/lib/hooks/use-auto-hide-controls";
import { useDisablePullToRefresh } from "@/lib/hooks/use-disable-pull-to-refresh";
import {
  getRotationLayerStyle,
  unrotateDelta,
  useFullscreen,
} from "@/lib/hooks/use-fullscreen";
import {
  useViewerKeyboardShortcuts,
  useViewerPageKeyboardShortcuts,
} from "@/lib/hooks/use-viewer-keyboard-shortcuts";
import { useSafePageViewTracker } from "@/lib/tracking/safe-page-view-tracker";
import { getTrackingOptions } from "@/lib/tracking/tracking-config";
import { WatermarkConfig } from "@/lib/types";
import { cn } from "@/lib/utils";

import { ScreenProtector } from "../ScreenProtection";
import Nav, { TNavData } from "../nav";
import { PoweredBy } from "../powered-by";
import Question from "../question";
import Toolbar from "../toolbar";
import { ViewerThemeColor } from "../viewer-theme-color";
import ViewDurationSummary from "../visitor-graph";
import { AwayPoster } from "./away-poster";
import { FullscreenControls } from "./fullscreen-controls";
import {
  HorizontalPageContent,
  type HorizontalViewerPage,
} from "./horizontal-page-content";
import { MobilePageControls } from "./mobile-page-controls";

import "@/styles/custom-viewer-styles.css";

export default function PagesHorizontalViewer({
  pages,
  feedbackEnabled,
  screenshotProtectionEnabled,
  confidentialViewEnabled,
  versionNumber,
  showPoweredByBanner,
  showAccountCreationSlide,
  enableQuestion = false,
  feedback,
  viewerEmail,
  watermarkConfig,
  ipAddress,
  linkName,
  navData,
  ensurePagesLoaded,
}: {
  pages: HorizontalViewerPage[];
  feedbackEnabled: boolean;
  screenshotProtectionEnabled: boolean;
  confidentialViewEnabled?: boolean;
  versionNumber: number;
  showPoweredByBanner?: boolean;
  showAccountCreationSlide?: boolean;
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
  const { isMobile, isPreview, linkId, documentId, viewId, dataroomId, brand } =
    navData;

  // The viewer's chosen background color (matches the surrounding viewer chrome
  // in document-view). Used to fill the fullscreen letterbox and tint the
  // browser chrome instead of a hard black.
  const viewerBackgroundColor = brand?.accentColor || "rgb(3, 7, 18)";

  const router = useRouter();
  const { status: sessionStatus } = useSession();
  const {
    isFullscreen,
    isPseudoFullscreen,
    toggleFullscreen,
    rotation,
    rotate,
  } = useFullscreen();

  useDisablePullToRefresh(!!isMobile);

  const showStatsSlideWithAccountCreation =
    showAccountCreationSlide && // if showAccountCreationSlide is enabled
    sessionStatus !== "authenticated" && // and user is not authenticated
    !dataroomId; // and it's not a dataroom

  const numPages = pages.length;
  const numPagesWithFeedback =
    enableQuestion && feedback ? numPages + 1 : numPages;

  const numPagesWithAccountCreation = showStatsSlideWithAccountCreation
    ? numPagesWithFeedback + 1
    : numPagesWithFeedback;

  const pageQuery = router.query.p ? Number(router.query.p) : 1;

  const [pageNumber, setPageNumber] = useState<number>(() =>
    pageQuery >= 1 && pageQuery <= numPages ? pageQuery : 1,
  ); // start on first page

  // In fullscreen the overlay controls fade after a few seconds (and on each
  // new page) so the slide is unobstructed; a tap anywhere reveals them again.
  const { visible: controlsVisible, reveal: revealControls } =
    useAutoHideControls({ active: isFullscreen, resetKey: pageNumber });

  const [submittedFeedback, setSubmittedFeedback] = useState<boolean>(false);
  const [accountCreated, setAccountCreated] = useState<boolean>(false);
  const [scale, setScale] = useState<number>(1);
  // Mobile pinch/pan runs through react-zoom-pan-pinch; `isZoomed` mirrors its
  // scale so the swipe handler and the "fit" control can react to it.
  const [isZoomed, setIsZoomed] = useState<boolean>(false);

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
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const transformRef = useRef<ReactZoomPanPinchRef | null>(null);
  const scaleRef = useRef<number>(1);
  const mobileViewportRef = useRef<HTMLDivElement>(null);
  const swipeRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const imageRefs = useRef<(HTMLImageElement | null)[]>([]);

  const [imageDimensions, setImageDimensions] = useState<
    Record<number, { width: number; height: number }>
  >({});

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

  const getScaleFactor = ({
    naturalHeight,
    scaleFactor,
  }: {
    naturalHeight: number;
    scaleFactor: number;
  }) => {
    const containerHeight = imageDimensions[pageNumber - 1]
      ? imageDimensions[pageNumber - 1]!.height
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
    // Entering/leaving fullscreen resizes the image box via the fill styles, but
    // the new layout isn't ready on the same tick; re-measure next frame so the
    // zoom scroll area (`scaledWidthPx`) matches the rendered width. A stale
    // smaller width makes `transformOrigin: center top` push the slide's left
    // edge past the scroll origin, clipping it when zoomed.
    const raf = requestAnimationFrame(updateImageDimensions);
    window.addEventListener("resize", updateImageDimensions);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", updateImageDimensions);
    };
    // `rotation` re-measures after a quarter turn resizes the image box so the
    // watermark and link overlays stay locked to the rotated image.
    // `isFullscreen`/`isPseudoFullscreen` re-measure when the fill styles change
    // the image box so scaled zoom bounds stay correct.
  }, [pageNumber, rotation, isFullscreen, isPseudoFullscreen]);

  // Start interval tracking when component mounts or page changes
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

        // Restart interval tracking
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

  const goToPreviousPage = () => {
    if (pageNumber <= 1) return;
    if (enableQuestion && feedback && pageNumber === numPagesWithFeedback) {
      setPageNumber(pageNumber - 1);
      startTimeRef.current = Date.now();
      return;
    }

    if (pageNumber === numPagesWithFeedback + 1) {
      setPageNumber(pageNumber - 1);
      startTimeRef.current = Date.now();
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

    setPageNumber(pageNumber - 1);
    startTimeRef.current = Date.now();
  };

  const goToNextPage = () => {
    if (pageNumber >= numPagesWithAccountCreation) return;

    if (pageNumber > numPages) {
      setPageNumber(pageNumber + 1);
      startTimeRef.current = Date.now();
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

    setPageNumber(pageNumber + 1);
    startTimeRef.current = Date.now();
  };

  useViewerPageKeyboardShortcuts({
    orientation: "horizontal",
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

  // Zoom handlers. Desktop drives the CSS `scale` state directly; mobile
  // delegates to react-zoom-pan-pinch so pinch and pan stay focal-point
  // correct (the page no longer jumps out from under the fingers).
  const handleZoomIn = () => {
    if (isMobile) {
      transformRef.current?.zoomIn();
      return;
    }
    setScale((prev) => Math.min(prev + 0.25, 3));
  };

  const handleZoomOut = () => {
    if (isMobile) {
      transformRef.current?.zoomOut();
      return;
    }
    setScale((prev) => Math.max(prev - 0.25, 0.5));
  };

  const handleResetZoom = () => {
    if (isMobile) {
      transformRef.current?.resetTransform();
      return;
    }
    setScale(1);
  };

  const handleTransform = (
    _ref: ReactZoomPanPinchRef,
    state: { scale: number },
  ) => {
    scaleRef.current = state.scale;
    const zoomed = state.scale > 1.05;
    setIsZoomed((prev) => (prev === zoomed ? prev : zoomed));
  };

  useViewerKeyboardShortcuts({
    onZoomIn: handleZoomIn,
    onZoomOut: handleZoomOut,
    onResetZoom: handleResetZoom,
    onToggleFullscreen: toggleFullscreen,
  });

  // Keep the latest navigation callbacks for the imperative swipe handler,
  // which is bound once and must not close over a stale `pageNumber`.
  const goToNextPageRef = useRef(goToNextPage);
  const goToPreviousPageRef = useRef(goToPreviousPage);

  // Read inside the once-bound swipe handler so a rotate doesn't re-subscribe.
  const rotationRef = useRef(rotation);

  // Sync after commit so the swipe handler only ever reads committed callbacks
  // and rotation (mutating refs during render is unsafe under concurrent React).
  useEffect(() => {
    goToNextPageRef.current = goToNextPage;
    goToPreviousPageRef.current = goToPreviousPage;
    rotationRef.current = rotation;
  }, [goToNextPage, goToPreviousPage, rotation]);

  // Each slide starts unzoomed. The wrapper is NOT keyed by page (keying it
  // remounted react-zoom-pan-pinch and its <img> on every navigation, which
  // painted a blank frame — the flash). Instead we keep it mounted and reset
  // its transform imperatively (0ms so there's no zoom-out animation).
  useEffect(() => {
    scaleRef.current = 1;
    setIsZoomed(false);
    transformRef.current?.resetTransform(0);
  }, [pageNumber]);

  // Swipe left/right to change slides — only while not zoomed, so panning a
  // zoomed page never flips the page. Listeners are attached natively in the
  // capture phase so they observe touches regardless of the zoom layer.
  useEffect(() => {
    if (!isMobile) return;
    const el = mobileViewportRef.current;
    if (!el) return;

    const onStart = (e: TouchEvent) => {
      if (e.touches.length === 1 && scaleRef.current <= 1.05) {
        const touch = e.touches[0];
        swipeRef.current = {
          x: touch.clientX,
          y: touch.clientY,
          time: Date.now(),
        };
      } else {
        swipeRef.current = null;
      }
    };
    const onMove = (e: TouchEvent) => {
      if (swipeRef.current && e.touches.length !== 1) swipeRef.current = null;
    };
    const onEnd = (e: TouchEvent) => {
      const start = swipeRef.current;
      swipeRef.current = null;
      if (!start || scaleRef.current > 1.05) return;
      const touch = e.changedTouches[0];
      if (!touch) return;
      // Remap the physical swipe into the (possibly rotated) content frame so a
      // left/right swipe relative to the presentation always flips the page.
      const { dx, dy } = unrotateDelta(
        touch.clientX - start.x,
        touch.clientY - start.y,
        rotationRef.current,
      );
      const elapsed = Date.now() - start.time;
      if (
        elapsed < 700 &&
        Math.abs(dx) > 48 &&
        Math.abs(dx) > Math.abs(dy) * 1.4
      ) {
        if (dx < 0) goToNextPageRef.current();
        else goToPreviousPageRef.current();
      }
    };

    const opts: AddEventListenerOptions = { passive: true, capture: true };
    el.addEventListener("touchstart", onStart, opts);
    el.addEventListener("touchmove", onMove, opts);
    el.addEventListener("touchend", onEnd, opts);
    return () => {
      el.removeEventListener("touchstart", onStart, opts);
      el.removeEventListener("touchmove", onMove, opts);
      el.removeEventListener("touchend", onEnd, opts);
    };
  }, [isMobile]);

  // Compute scaled sizer dimensions for accurate scroll area
  const currentDims = imageDimensions[pageNumber - 1];
  const scaledWidthPx = currentDims ? currentDims.width * scale : undefined;
  const scaledHeightPx = currentDims ? currentDims.height * scale : undefined;

  const isQuestionSlide =
    !!enableQuestion && !!feedback && pageNumber === numPagesWithFeedback;
  const isAccountSlide =
    showStatsSlideWithAccountCreation &&
    pageNumber === numPagesWithAccountCreation;

  // In fullscreen a non-zero rotation turns the viewport into a fixed, rotated
  // full-viewport layer (see getRotationLayerStyle); otherwise it just sizes to
  // the available height. `getRotationLayerStyle` returns null at rotation 0.
  const viewportStyle = (isFullscreen &&
    getRotationLayerStyle(rotation, viewerBackgroundColor)) || {
    height: isPseudoFullscreen ? "100dvh" : "calc(100dvh - 64px)",
  };

  // Image fit caps. After a quarter turn the slide's height axis maps to the
  // physical width, so bound height by `dvw` (and width by `dvh`) to keep a
  // landscape slide fully visible instead of clipped. Non-rotated behavior is
  // unchanged.
  const rotated = isFullscreen && rotation !== 0;
  const quarterTurn = rotation === 90 || rotation === 270;
  const imgMaxHeight = rotated
    ? quarterTurn
      ? "100dvw"
      : "100dvh"
    : isPseudoFullscreen
      ? "100dvh"
      : "calc(100dvh - 64px)";
  // In fullscreen (no rotation) drive the slide off an explicit height so a
  // page render smaller than the screen scales *up* to fill it, instead of only
  // being capped by max-height. `object-contain` plus a `100dvw` width bound
  // keep the aspect ratio and stop a wide slide from overflowing sideways.
  const imgHeight = isFullscreen && !rotated ? imgMaxHeight : undefined;
  const imgMaxWidth = rotated
    ? quarterTurn
      ? "100dvh"
      : undefined
    : isFullscreen
      ? "100dvw"
      : undefined;

  // Pseudo-fullscreen (iPhone, no native Fullscreen API) hides the navbar, so
  // this overlay is the only way to rotate or exit and must stay regardless of
  // the viewport breakpoint — an iPhone rotated to landscape reports > 640px,
  // which flips `isMobile` to false and would otherwise strand the viewer.
  // Desktop native fullscreen keeps the navbar's exit toggle, so the overlay
  // stays mobile-only there to avoid a duplicate exit button.
  const showFullscreenOverlay = isFullscreen && (isMobile || isPseudoFullscreen);

  const handleImageDimensionsChange = (
    index: number,
    dimensions: { width: number; height: number },
  ) => {
    setImageDimensions((prev) => ({
      ...prev,
      [index]: dimensions,
    }));
  };

  const renderPageContent = (page: HorizontalViewerPage, index: number) => (
    <HorizontalPageContent
      page={page}
      index={index}
      isCurrentPage={pageNumber === index + 1}
      imgHeight={imgHeight}
      imgMaxHeight={imgMaxHeight}
      imgMaxWidth={imgMaxWidth}
      watermarkConfig={watermarkConfig}
      viewerEmail={viewerEmail}
      linkName={linkName}
      ipAddress={ipAddress}
      imageDimensions={imageDimensions}
      imageRefs={imageRefs}
      getScaleFactor={getScaleFactor}
      onImageDimensionsChange={handleImageDimensionsChange}
      onLinkClick={handleLinkClick}
    />
  );

  const renderPage = (page: HorizontalViewerPage, index: number, active: boolean) => (
    <div
      key={index}
      className={cn(
        "viewer-container relative mx-auto w-full",
        active ? "flex justify-center" : "hidden",
      )}
    >
      {renderPageContent(page, index)}
    </div>
  );

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
          numPages={numPagesWithAccountCreation}
          embeddedLinks={pages[pageNumber - 1]?.embeddedLinks}
          hasWatermark={!!watermarkConfig}
          handleZoomIn={handleZoomIn}
          handleZoomOut={handleZoomOut}
          handleFullscreen={toggleFullscreen}
          isFullscreen={isFullscreen}
          hidePageCount={isMobile}
          navData={navData}
        />
      )}
      <div
        ref={mobileViewportRef}
        style={viewportStyle}
        className="relative overflow-hidden"
        onClick={(e) => {
          if (!isFullscreen) return;
          // A tap on a document link follows the link; any other tap brings the
          // faded overlay controls back.
          if ((e.target as HTMLElement).closest("a, area")) return;
          revealControls();
        }}
      >
        <div className="flex h-full w-full items-center">
          {isMobile ? (
            <div
              className={cn(
                "relative h-full w-full",
                !isWindowFocused &&
                  screenshotProtectionEnabled &&
                  "blur-xl transition-all duration-300",
              )}
              ref={containerRef}
            >
              {pageNumber <= numPages ? (
                <TransformWrapper
                  ref={transformRef}
                  initialScale={1}
                  minScale={1}
                  maxScale={3}
                  centerOnInit
                  limitToBounds
                  doubleClick={{ disabled: true }}
                  wheel={{ disabled: true }}
                  pinch={{ disabled: false }}
                  panning={{ disabled: !isZoomed }}
                  onTransform={handleTransform}
                >
                  <TransformComponent
                    wrapperStyle={{ width: "100%", height: "100%" }}
                    contentStyle={{ width: "100%", height: "100%" }}
                  >
                    {/* Persistent stack: the current page plus its immediate
                        neighbors stay mounted and decoded, so a swipe/next
                        reveals an already-painted page instead of a blank
                        frame. Only the active page is visible. */}
                    <div className="relative h-full w-full">
                      {pages.map((page, index) => {
                        if (Math.abs(index - (pageNumber - 1)) > 1) return null;
                        const active = index === pageNumber - 1;
                        return (
                          <div
                            key={index}
                            aria-hidden={!active}
                            className={cn(
                              "absolute inset-0 flex items-center justify-center",
                              active
                                ? "visible"
                                : "pointer-events-none invisible",
                            )}
                          >
                            {renderPageContent(page, index)}
                          </div>
                        );
                      })}
                    </div>
                  </TransformComponent>
                </TransformWrapper>
              ) : isQuestionSlide ? (
                <div className="flex h-full w-full items-center justify-center">
                  <Question
                    accentColor={brand?.accentColor}
                    feedback={feedback!}
                    viewId={viewId}
                    submittedFeedback={submittedFeedback}
                    setSubmittedFeedback={setSubmittedFeedback}
                    isPreview={isPreview}
                  />
                </div>
              ) : isAccountSlide ? (
                <div className="flex h-full w-full items-center justify-center">
                  <ViewDurationSummary
                    linkId={linkId}
                    viewedPages={viewedPages}
                    viewerEmail={viewerEmail}
                    accountCreated={accountCreated}
                    setAccountCreated={setAccountCreated}
                  />
                </div>
              ) : null}
            </div>
          ) : (
            <div
              className={cn(
                "relative h-full w-full",
                !isWindowFocused &&
                  screenshotProtectionEnabled &&
                  "blur-xl transition-all duration-300",
              )}
              ref={containerRef}
            >
              <div
                ref={scrollContainerRef}
                className="h-full w-full overflow-auto"
                // Let one-finger drags scroll/pan while our pinch handler
                // owns two-finger zoom. Without this the browser's own
                // pinch-zoom fights the scroll container on mobile.
                style={isMobile ? { touchAction: "pan-x pan-y" } : undefined}
              >
                {/* Sizer defines the scrollable layout size at current scale.
                      On mobile at default zoom we vertically center the page
                      so it aligns with the next/prev controls (which sit at
                      vertical-center of the viewport) instead of being pinned
                      to the top — short/landscape pages would otherwise leave
                      a large empty band underneath. */}
                <div
                  className={cn(
                    "mx-auto",
                    isMobile &&
                      scale <= 1 &&
                      "flex min-h-full items-center justify-center",
                  )}
                  style={{
                    // Keep default zoom responsive to viewport changes.
                    // Only lock dimensions when zoomed in to preserve a stable scroll area.
                    width:
                      scale > 1 && scaledWidthPx
                        ? `${scaledWidthPx}px`
                        : "100%",
                    height:
                      scale > 1 && scaledHeightPx
                        ? `${scaledHeightPx}px`
                        : "auto",
                  }}
                >
                  {/* Content is scaled; origin set to top-left so it grows into the sizer */}
                  <div
                    style={{
                      transition: "transform 0.2s ease-out",
                      transformOrigin: "center top",
                      transform: `scale(${scale})`,
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                  >
                    {pageNumber <= numPagesWithAccountCreation && pages
                      ? pages.map((page, index) =>
                          renderPage(page, index, pageNumber - 1 === index),
                        )
                      : null}
                  </div>
                </div>

                {enableQuestion &&
                feedback &&
                pageNumber === numPagesWithFeedback ? (
                  <div
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
                ) : null}

                {showStatsSlideWithAccountCreation &&
                pageNumber === numPagesWithAccountCreation ? (
                  <div
                    className={cn("relative block h-dvh w-full")}
                    style={{ height: "calc(100dvh - 64px)" }}
                  >
                    <ViewDurationSummary
                      linkId={linkId}
                      viewedPages={viewedPages}
                      viewerEmail={viewerEmail}
                      accountCreated={accountCreated}
                      setAccountCreated={setAccountCreated}
                    />
                  </div>
                ) : null}
              </div>
            </div>
          )}

          {!isMobile && pageNumber > 1 && (
            <div className="group absolute left-0 top-0 z-50 flex h-full w-32 items-center justify-start pl-4">
              <button
                onClick={goToPreviousPage}
                className={cn(
                  "rounded-full bg-gray-950/50 p-1 transition-opacity duration-200 hover:bg-gray-950/75",
                  "opacity-50 group-hover:opacity-100",
                )}
              >
                <ChevronLeftIcon className="size-10 text-white" />
              </button>
            </div>
          )}

          {!isMobile && pageNumber < numPagesWithAccountCreation && (
            <div className="group absolute right-0 top-0 z-50 flex h-full w-32 items-center justify-end pr-4">
              <button
                onClick={goToNextPage}
                className={cn(
                  "rounded-full bg-gray-950/50 p-1 transition-opacity duration-200 hover:bg-gray-950/75",
                  "opacity-50 group-hover:opacity-100",
                )}
              >
                <ChevronRightIcon className="size-10 text-white" />
              </button>
            </div>
          )}

          {isMobile ? (
            <MobilePageControls
              pageNumber={pageNumber}
              numPages={numPagesWithAccountCreation}
              isFullscreen={isFullscreen}
              controlsVisible={controlsVisible}
              onPreviousPage={goToPreviousPage}
              onNextPage={goToNextPage}
            />
          ) : null}

          {/* Fullscreen controls. Placed inside the viewport so they
                  rotate with the presentation and land at the presentation's
                  top-right (not the physical screen's) after a quarter turn.
                  They fade with the rest of the overlay after a few seconds.
                  Shown for handheld/pseudo-fullscreen presentations (see
                  `showFullscreenOverlay`); desktop native fullscreen relies on
                  the navbar's exit toggle instead. */}
          {showFullscreenOverlay ? (
            <FullscreenControls
              controlsVisible={controlsVisible}
              showRotate
              onRotate={rotate}
              onExit={toggleFullscreen}
            />
          ) : null}

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
            inactivityThreshold={getTrackingOptions().inactivityThreshold}
            onDismiss={updateActivity}
          />
        </div>
      </div>
    </div>
  );
}
