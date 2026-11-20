import { useRouter } from "next/router";

import { useEffect, useRef, useState } from "react";

import { ConfidentialViewOverlay } from "@/ee/features/permissions/components/confidential-view/confidential-view-overlay";
import {
  ReactZoomPanPinchRef,
  TransformComponent,
  TransformWrapper,
} from "react-zoom-pan-pinch";

import { useAutoHideControls } from "@/lib/hooks/use-auto-hide-controls";
import { useDisablePullToRefresh } from "@/lib/hooks/use-disable-pull-to-refresh";
import {
  getContainedImageRect,
  getRotationLayerStyle,
  useFullscreen,
} from "@/lib/hooks/use-fullscreen";
import { useViewerKeyboardShortcuts } from "@/lib/hooks/use-viewer-keyboard-shortcuts";
import { useSafePageViewTracker } from "@/lib/tracking/safe-page-view-tracker";
import { getTrackingOptions } from "@/lib/tracking/tracking-config";
import { WatermarkConfig } from "@/lib/types";
import { cn } from "@/lib/utils";

import { ScreenProtector } from "../ScreenProtection";
import Nav, { TNavData } from "../nav";
import { PoweredBy } from "../powered-by";
import { ViewerThemeColor } from "../viewer-theme-color";
import { SVGWatermark } from "../watermark-svg";
import { AwayPoster } from "./away-poster";
import { FullscreenControls } from "./fullscreen-controls";

import "@/styles/custom-viewer-styles.css";

export default function ImageViewer({
  file,
  screenshotProtectionEnabled,
  confidentialViewEnabled,
  versionNumber,
  showPoweredByBanner,
  viewerEmail,
  watermarkConfig,
  ipAddress,
  linkName,
  navData,
}: {
  file: string;
  screenshotProtectionEnabled: boolean;
  confidentialViewEnabled?: boolean;
  versionNumber: number;
  showPoweredByBanner?: boolean;
  viewerEmail?: string;
  watermarkConfig?: WatermarkConfig | null;
  ipAddress?: string;
  linkName?: string;
  navData: TNavData;
}) {
  const router = useRouter();

  const { isMobile, isPreview, linkId, documentId, viewId, dataroomId, brand } =
    navData;

  // Viewer's chosen background color; fills the fullscreen letterbox and tints
  // the browser chrome instead of a hard black.
  const viewerBackgroundColor = brand?.accentColor || "rgb(3, 7, 18)";

  const {
    isFullscreen,
    isPseudoFullscreen,
    toggleFullscreen,
    rotation,
    rotate,
  } = useFullscreen();

  useDisablePullToRefresh(!!isMobile);

  // In fullscreen the overlay controls fade after a few seconds; a tap anywhere
  // reveals them again.
  const { visible: controlsVisible, reveal: revealControls } =
    useAutoHideControls({ active: isFullscreen });

  const numPages = 1;
  const pageNumber = 1;

  const [scale, setScale] = useState<number>(1);
  const [isZoomed, setIsZoomed] = useState<boolean>(false);
  const [isWindowFocused, setIsWindowFocused] = useState(true);

  const startTimeRef = useRef(Date.now());
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const transformRef = useRef<ReactZoomPanPinchRef | null>(null);
  const imageRefs = useRef<HTMLImageElement | null>(null);
  // Natural aspect ratio of the loaded image, used to size the watermark to the
  // visible (object-contain) image rather than the letterboxed element box.
  const imageAspectRef = useRef<number>(0);

  const trackingOptions = getTrackingOptions();
  const {
    trackPageViewSafely,
    resetTrackingState,
    startIntervalTracking,
    stopIntervalTracking,
    getActiveDuration,
    isInactive,
    updateActivity,
  } = useSafePageViewTracker({
    ...trackingOptions,
    externalStartTimeRef: startTimeRef,
  });

  const [imageDimensions, setImageDimensions] = useState<{
    width: number;
    height: number;
  } | null>(null);

  // Desktop drives the CSS `scale`; mobile delegates to react-zoom-pan-pinch
  // for focal-point-correct pinch and pan.
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
    const zoomed = state.scale > 1.05;
    setIsZoomed((prev) => (prev === zoomed ? prev : zoomed));
  };

  useViewerKeyboardShortcuts({
    onZoomIn: handleZoomIn,
    onZoomOut: handleZoomOut,
    onResetZoom: handleResetZoom,
    onToggleFullscreen: toggleFullscreen,
  });

  useEffect(() => {
    const updateImageDimensions = () => {
      let newDimensions: { width: number; height: number } | null = null;

      if (imageRefs.current) {
        newDimensions = {
          width: imageRefs.current.clientWidth,
          height: imageRefs.current.clientHeight,
        };
      }
      setImageDimensions(newDimensions);
    };

    updateImageDimensions();
    // Fullscreen toggles resize the image box via the fill styles, but the new
    // layout isn't ready on the same tick; re-measure next frame so the zoom
    // scroll area (`imageDimensions.width * scale`) matches the rendered width
    // and `transformOrigin: center top` doesn't clip the image's left edge.
    const raf = requestAnimationFrame(updateImageDimensions);
    window.addEventListener("resize", updateImageDimensions);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", updateImageDimensions);
    };
    // `rotation` re-measures after a quarter turn resizes the image box so the
    // watermark stays locked to the rotated image.
    // `isFullscreen`/`isPseudoFullscreen` re-measure when the fill styles change
    // the image box so scaled zoom bounds stay correct.
  }, [scale, rotation, isFullscreen, isPseudoFullscreen]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        resetTrackingState();
        const trackingData = {
          linkId,
          documentId,
          viewId,
          pageNumber: pageNumber,
          versionNumber,
          dataroomId,
          isPreview,
        };
        startIntervalTracking(trackingData);
      } else {
        stopIntervalTracking();
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
            isPreview,
          },
          true,
        );
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [
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
          isPreview,
        },
        true,
      );
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [
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

  // Start interval tracking when component mounts
  useEffect(() => {
    const trackingData = {
      linkId,
      documentId,
      viewId,
      pageNumber: pageNumber,
      versionNumber,
      dataroomId,
      isPreview,
    };
    startIntervalTracking(trackingData);

    return () => {
      stopIntervalTracking();
    };
  }, [
    linkId,
    documentId,
    viewId,
    versionNumber,
    dataroomId,
    isPreview,
    startIntervalTracking,
    stopIntervalTracking,
  ]);

  // Image fit caps. After a quarter turn the image's height axis maps to the
  // physical width, so bound height by `dvw` (and width by `dvh`) to keep it
  // fully visible instead of clipped. Non-rotated behavior is unchanged.
  const rotated = isFullscreen && rotation !== 0;
  const quarterTurn = rotation === 90 || rotation === 270;
  const imgMaxHeight = rotated
    ? quarterTurn
      ? "100dvw"
      : "100dvh"
    : isPseudoFullscreen
      ? "100dvh"
      : "calc(100dvh - 64px)";
  // In fullscreen (no rotation) drive the image off an explicit height so a
  // smaller-than-screen image scales *up* to fill it, instead of only being
  // capped by max-height. `object-contain` plus a `100dvw` width bound keep the
  // aspect ratio and stop a wide image from overflowing sideways.
  const imgHeight = isFullscreen && !rotated ? imgMaxHeight : undefined;
  const imgMaxWidth = rotated
    ? quarterTurn
      ? "100dvh"
      : undefined
    : isFullscreen
      ? "100dvw"
      : undefined;

  const watermarkRect =
    watermarkConfig && imageDimensions
      ? getContainedImageRect(
          imageDimensions.width,
          imageDimensions.height,
          imageAspectRef.current,
        )
      : null;

  const imageContent = (
    <div className="viewer-container relative mx-auto flex w-full justify-center">
      {/* Shrink-wrap the image so the absolutely-positioned watermark anchors
          to the image box, not the letterboxed viewport corner. */}
      <div className="relative w-fit">
        <img
          className="viewer-image-mobile !pointer-events-auto object-contain"
          style={{
            height: imgHeight,
            maxHeight: imgMaxHeight,
            maxWidth: imgMaxWidth,
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          ref={(ref) => {
            imageRefs.current = ref;
            if (ref) {
              ref.onload = () => {
                if (ref.naturalWidth && ref.naturalHeight) {
                  imageAspectRef.current = ref.naturalWidth / ref.naturalHeight;
                }
                setImageDimensions({
                  width: ref.clientWidth,
                  height: ref.clientHeight,
                });
              };
            }
          }}
          src={file}
          alt="Image 1"
        />

        {watermarkConfig && watermarkRect ? (
          <div
            className="pointer-events-none absolute"
            style={{ left: watermarkRect.left, top: watermarkRect.top }}
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
              documentDimensions={{
                width: watermarkRect.width,
                height: watermarkRect.height,
              }}
              pageIndex={0}
            />
          </div>
        ) : null}
      </div>
    </div>
  );

  // In fullscreen a non-zero rotation turns the viewport into a fixed, rotated
  // full-viewport layer; otherwise it just sizes to the available height.
  const viewportStyle = (isFullscreen &&
    getRotationLayerStyle(rotation, viewerBackgroundColor)) || {
    height: isPseudoFullscreen ? "100dvh" : "calc(100dvh - 64px)",
  };

  // Pseudo-fullscreen (iPhone, no native Fullscreen API) hides the navbar, so
  // this overlay is the only way to rotate or exit and must stay regardless of
  // the viewport breakpoint — an iPhone rotated to landscape reports > 640px,
  // which flips `isMobile` to false and would otherwise strand the viewer.
  // Desktop native fullscreen keeps the navbar's exit toggle, so the overlay
  // stays mobile-only there to avoid a duplicate exit button.
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
          numPages={numPages}
          hasWatermark={!!watermarkConfig}
          handleZoomIn={handleZoomIn}
          handleZoomOut={handleZoomOut}
          handleFullscreen={toggleFullscreen}
          isFullscreen={isFullscreen}
          navData={navData}
        />
      )}
      <div
        style={viewportStyle}
        className="relative flex items-center overflow-hidden"
        onClick={(e) => {
          if (!isFullscreen) return;
          if ((e.target as HTMLElement).closest("a, area")) return;
          revealControls();
        }}
      >
        <div
          className={cn(
            "relative h-full w-full",
            !isWindowFocused &&
              screenshotProtectionEnabled &&
              "blur-xl transition-all duration-300",
          )}
          ref={containerRef}
        >
          {isMobile ? (
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
                contentStyle={{
                  width: "100%",
                  height: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {imageContent}
              </TransformComponent>
            </TransformWrapper>
          ) : (
            <div
              ref={scrollContainerRef}
              className="h-full w-full overflow-auto"
            >
              {/* Sizer defines scrollable dimensions at current scale. */}
              <div
                className="mx-auto"
                style={{
                  width:
                    imageDimensions && scale > 1
                      ? `${imageDimensions.width * scale}px`
                      : "100%",
                  height:
                    imageDimensions && scale > 1
                      ? `${imageDimensions.height * scale}px`
                      : "auto",
                }}
              >
                {/* Scaled content */}
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
                  {imageContent}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Fullscreen controls, inside the viewport so they rotate with the
            content and land at the presentation's top-right after a turn. They
            fade after a few seconds; a tap anywhere reveals them again. Shown
            for handheld/pseudo-fullscreen presentations (see
            `showFullscreenOverlay`); desktop native fullscreen relies on the
            navbar's exit toggle instead. */}
        {showFullscreenOverlay ? (
          <FullscreenControls
            controlsVisible={controlsVisible}
            showRotate
            onRotate={rotate}
            onExit={toggleFullscreen}
          />
        ) : null}

        {screenshotProtectionEnabled ? <ScreenProtector /> : null}
        {confidentialViewEnabled ? <ConfidentialViewOverlay /> : null}
        {showPoweredByBanner ? <PoweredBy linkId={linkId} /> : null}
      </div>
      <AwayPoster
        isVisible={isInactive}
        inactivityThreshold={trackingOptions.inactivityThreshold || 60000}
        onDismiss={updateActivity}
      />
    </div>
  );
}
