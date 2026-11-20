import { useEffect, useRef, useState } from "react";

import { useSafePageViewTracker } from "@/lib/tracking/safe-page-view-tracker";
import { getTrackingOptions } from "@/lib/tracking/tracking-config";
import { cn } from "@/lib/utils";
import { getOfficeViewerEmbedUrl } from "@/lib/utils/office-viewer";

import { ScreenProtector } from "../ScreenProtection";
import Nav, { TNavData } from "../nav";
import { AwayPoster } from "./away-poster";

export default function AdvancedExcelViewer({
  file,
  versionNumber,
  screenshotProtectionEnabled,
  navData,
}: {
  file: string;
  versionNumber: number;
  screenshotProtectionEnabled: boolean;
  navData: TNavData;
}) {
  const { linkId, documentId, viewId, isPreview, dataroomId, brand } = navData;
  const pageNumber = 1;

  const [isWindowFocused, setIsWindowFocused] = useState<boolean>(true);

  // Blur the content whenever the window loses focus (e.g. when the OS
  // screenshot/snipping UI takes over). Only active when protection is enabled.
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

  const startTimeRef = useRef(Date.now());
  const visibilityRef = useRef<boolean>(true);

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

  // Start interval tracking when component mounts
  useEffect(() => {
    const trackingData = {
      linkId,
      documentId,
      viewId,
      pageNumber,
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
    pageNumber,
    versionNumber,
    dataroomId,
    isPreview,
    startIntervalTracking,
    stopIntervalTracking,
  ]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        visibilityRef.current = true;
        resetTrackingState();
        const trackingData = {
          linkId,
          documentId,
          viewId,
          pageNumber,
          versionNumber,
          dataroomId,
          isPreview,
        };
        startIntervalTracking(trackingData);
      } else {
        visibilityRef.current = false;
        stopIntervalTracking();
        const duration = getActiveDuration();
        if (duration > 0) {
          trackPageViewSafely(
            {
              linkId,
              documentId,
              viewId,
              duration,
              pageNumber,
              versionNumber,
              dataroomId,
              isPreview,
            },
            true,
          );
        }
      }
    };

    const handleBeforeUnload = () => {
      stopIntervalTracking();
      const duration = getActiveDuration();
      if (duration > 0) {
        trackPageViewSafely(
          {
            linkId,
            documentId,
            viewId,
            duration,
            pageNumber,
            versionNumber,
            dataroomId,
            isPreview,
          },
          true,
        );
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [
    linkId,
    documentId,
    viewId,
    pageNumber,
    versionNumber,
    dataroomId,
    isPreview,
    trackPageViewSafely,
    resetTrackingState,
    startIntervalTracking,
    stopIntervalTracking,
    getActiveDuration,
  ]);

  return (
    <>
      <Nav type="sheet" navData={navData} />
      <div
        style={{ height: "calc(100dvh - 64px)" }}
        className="relative mx-2 flex h-screen flex-col sm:mx-6 lg:mx-8"
      >
        <iframe
          className={cn(
            "h-full w-full",
            !isWindowFocused &&
              screenshotProtectionEnabled &&
              "blur-xl transition-all duration-300",
          )}
          src={getOfficeViewerEmbedUrl(file)}
        ></iframe>
        <div
          className="absolute bottom-0 left-0 right-0 z-50 h-[26px] bg-gray-950"
          style={{
            background: brand?.accentColor || "rgb(3, 7, 18)",
          }}
        />
        {screenshotProtectionEnabled ? <ScreenProtector /> : null}
      </div>
      <AwayPoster
        isVisible={isInactive}
        inactivityThreshold={getTrackingOptions().inactivityThreshold}
        onDismiss={updateActivity}
      />
    </>
  );
}
