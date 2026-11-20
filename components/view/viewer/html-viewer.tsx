import { useRouter } from "next/router";

import { useEffect, useRef, useState } from "react";

import { ConfidentialViewOverlay } from "@/ee/features/permissions/components/confidential-view/confidential-view-overlay";

import { useSafePageViewTracker } from "@/lib/tracking/safe-page-view-tracker";
import { getTrackingOptions } from "@/lib/tracking/tracking-config";
import { cn } from "@/lib/utils";
import { HTML_DOCUMENT_IFRAME_SANDBOX } from "@/lib/utils/html-document";

import LoadingSpinner from "@/components/ui/loading-spinner";

import { ScreenProtector } from "../ScreenProtection";
import Nav, { TNavData } from "../nav";
import { AwayPoster } from "./away-poster";

export default function HtmlViewer({
  htmlContent,
  documentName,
  versionNumber,
  screenshotProtectionEnabled,
  confidentialViewEnabled,
  navData,
}: {
  htmlContent: string;
  documentName?: string;
  versionNumber: number;
  screenshotProtectionEnabled: boolean;
  confidentialViewEnabled?: boolean;
  navData: TNavData;
}) {
  const router = useRouter();
  const startTimeRef = useRef(Date.now());
  const [iframeLoaded, setIframeLoaded] = useState<boolean>(false);
  const [isWindowFocused, setIsWindowFocused] = useState<boolean>(true);

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

  const { linkId, documentId, viewId, isPreview, dataroomId } = navData;

  useEffect(() => {
    const removeQueryParams = (queries: string[]) => {
      const currentQuery = { ...router.query };
      const currentPath = router.asPath.split("?")[0];
      queries.forEach((query) => delete currentQuery[query]);

      router.replace(
        { pathname: currentPath, query: currentQuery },
        undefined,
        { shallow: true },
      );
    };

    if (router.query.token) {
      removeQueryParams(["token", "email", "domain", "slug", "linkId"]);
    }
  }, []);

  useEffect(() => {
    const trackingData = {
      linkId,
      documentId,
      viewId,
      pageNumber: 1,
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

  useEffect(() => {
    const handleVisibilityChange = () => {
      const trackingData = {
        linkId,
        documentId,
        viewId,
        pageNumber: 1,
        versionNumber,
        dataroomId,
        isPreview,
      };

      if (document.visibilityState === "visible") {
        resetTrackingState();
        startIntervalTracking(trackingData);
      } else {
        stopIntervalTracking();
        trackPageViewSafely(
          { ...trackingData, duration: getActiveDuration() },
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
      trackPageViewSafely(
        {
          linkId,
          documentId,
          viewId,
          duration: getActiveDuration(),
          pageNumber: 1,
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

  return (
    <>
      <Nav pageNumber={1} numPages={1} navData={navData} />
      <div
        style={{ height: "calc(100dvh - 64px)" }}
        className={cn(
          "relative flex flex-col bg-gray-50 dark:bg-gray-900",
          !isWindowFocused &&
            screenshotProtectionEnabled &&
            "blur-xl transition-all duration-300",
        )}
      >
        {!iframeLoaded && (
          <div
            className="absolute inset-0 z-10 flex items-center justify-center bg-gray-50 dark:bg-gray-900"
            aria-hidden="true"
          >
            <LoadingSpinner className="h-10 w-10 text-gray-500 dark:text-gray-400" />
          </div>
        )}
        <iframe
          srcDoc={htmlContent}
          title={documentName || "HTML document"}
          onLoad={() => setIframeLoaded(true)}
          className="h-full w-full border-0 bg-white"
          sandbox={HTML_DOCUMENT_IFRAME_SANDBOX}
          referrerPolicy="no-referrer"
          allow=""
        />
        {screenshotProtectionEnabled && <ScreenProtector />}
        {confidentialViewEnabled ? <ConfidentialViewOverlay /> : null}
      </div>
      <AwayPoster
        isVisible={isInactive}
        inactivityThreshold={trackingOptions.inactivityThreshold}
        onDismiss={updateActivity}
      />
    </>
  );
}
