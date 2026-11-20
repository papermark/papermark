import { useRouter } from "next/router";

import { useEffect, useMemo, useRef, useState } from "react";

import { ExternalLink } from "lucide-react";

import { useSafePageViewTracker } from "@/lib/tracking/safe-page-view-tracker";
import { getTrackingOptions } from "@/lib/tracking/tracking-config";

import { Button } from "@/components/ui/button";
import LoadingSpinner from "@/components/ui/loading-spinner";

import Nav, { TNavData } from "./nav";
import { AwayPoster } from "./viewer/away-poster";

interface LinkPreviewProps {
  linkUrl: string;
  linkName: string;
  navData: TNavData;
  versionNumber: number;
  /**
   * When true, the URL has been validated server-side against the
   * Edge-Config-backed allowlist and may be rendered directly inside a
   * sandboxed iframe. Trusting this flag is safe because it can only be set
   * by the views API after consulting the allowlist.
   */
  isEmbeddable?: boolean;
}

export default function LinkPreview({
  linkUrl,
  linkName,
  navData,
  versionNumber,
  isEmbeddable = false,
}: LinkPreviewProps) {
  const router = useRouter();
  const startTimeRef = useRef(Date.now());
  const visibilityRef = useRef<boolean>(true);
  const [iframeLoaded, setIframeLoaded] = useState<boolean>(false);

  const domain = useMemo(() => {
    if (!linkUrl) return "";

    try {
      const url = new URL(linkUrl);
      return url.hostname.replace("www.", "");
    } catch (e) {
      // If URL parsing fails, try to extract domain from string
      const match = linkUrl.match(/https?:\/\/([^\/]+)/);
      if (match) {
        return match[1].replace("www.", "");
      }
      return linkUrl.length > 50 ? linkUrl.substring(0, 50) + "..." : linkUrl;
    }
  }, [linkUrl]);

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
    // Remove token and email query parameters on component mount
    const removeQueryParams = (queries: string[]) => {
      const currentQuery = { ...router.query };
      const currentPath = router.asPath.split("?")[0];
      queries.map((query) => delete currentQuery[query]);

      router.replace(
        {
          pathname: currentPath,
          query: currentQuery,
        },
        undefined,
        { shallow: true },
      );
    };

    if (router.query.token) {
      removeQueryParams(["token", "email", "domain", "slug", "linkId"]);
    }
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        visibilityRef.current = true;
        resetTrackingState();

        // Restart interval tracking
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
      } else {
        visibilityRef.current = false;
        stopIntervalTracking();

        // Track final duration using activity-aware calculation
        const duration = getActiveDuration();
        trackPageViewSafely(
          {
            linkId,
            documentId,
            viewId,
            duration,
            pageNumber: 1,
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

  const handleLinkClick = () => {
    // Track the link click (non-blocking)
    if (!isPreview && viewId && linkUrl) {
      fetch("/api/record_click", {
        method: "POST",
        body: JSON.stringify({
          timestamp: new Date().toISOString(),
          sessionId: viewId,
          linkId,
          documentId,
          viewId,
          pageNumber: "1",
          href: linkUrl,
          versionNumber,
          dataroomId,
        }),
        headers: {
          "Content-Type": "application/json",
        },
      }).catch(console.error);
    }

    window.open(linkUrl, "_blank", "noopener,noreferrer");
    return;
  };

  if (isEmbeddable && linkUrl) {
    return (
      <>
        <Nav pageNumber={1} numPages={1} navData={navData} />
        <div
          style={{ height: "calc(100dvh - 64px)" }}
          className="relative flex flex-col bg-gray-50 dark:bg-gray-900"
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
            src={linkUrl}
            title={linkName || domain || "Embedded content"}
            onLoad={() => setIframeLoaded(true)}
            className="h-full w-full border-0"
            // Permissions Policy: deny everything not required for a passive
            // viewer. We intentionally do not grant camera, microphone,
            // geolocation, clipboard, payment, USB, MIDI, etc. — even
            // allowlisted hosts shouldn't be able to access these from
            // inside Papermark without an explicit opt-in.
            allow="fullscreen 'self'"
            allowFullScreen
            // Send no referrer so the embedded host cannot learn anything
            // about the Papermark viewer URL (link id, document id, query
            // params, etc.).
            referrerPolicy="no-referrer"
            // Sandbox the frame to the minimum capabilities required to
            // render an interactive embed:
            //   - allow-scripts: required to actually run the embed.
            //   - allow-same-origin: required so the embed can read its
            //     own cookies / storage on the host's origin (without it,
            //     XHR, fetch and storage all break).
            //   - allow-forms: lets users submit forms (e.g. login on the
            //     embedded host).
            //   - allow-popups: a click on a link inside the embed may
            //     open a new tab (e.g. external help links).
            // Notably omitted (each of these expand the blast radius):
            //   - allow-top-navigation*: prevents the embed from
            //     navigating Papermark's top-level window away.
            //   - allow-popups-to-escape-sandbox: any popup the embed
            //     opens inherits the sandbox restrictions instead of
            //     becoming an unrestricted window.
            //   - allow-modals: blocks alert/confirm/prompt and other
            //     modal hijacks.
            //   - allow-downloads: block drive-by downloads from the
            //     embedded origin.
            //   - allow-presentation, allow-pointer-lock,
            //     allow-orientation-lock: not needed and easy to abuse.
            //   - allow-storage-access-by-user-activation: keep the
            //     embed's cookie scope strictly first-party.
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            loading="lazy"
          />
        </div>
        <AwayPoster
          isVisible={isInactive}
          inactivityThreshold={trackingOptions.inactivityThreshold}
          onDismiss={updateActivity}
        />
      </>
    );
  }

  return (
    <>
      <Nav pageNumber={1} numPages={1} navData={navData} />
      <div
        style={{ height: "calc(100dvh - 64px)" }}
        className="relative flex flex-col items-center justify-center bg-gray-50 dark:bg-gray-900"
      >
        <div className="flex flex-col items-center space-y-6 p-8 text-center">
          <div className="rounded-full bg-gray-100 p-6 dark:bg-gray-800">
            <ExternalLink className="h-12 w-12 text-gray-600 dark:text-gray-300" />
          </div>
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
            {domain || linkName || "External Link"}
          </h2>
          <p className="max-w-md text-sm text-gray-500 dark:text-gray-400">
            You&apos;re leaving Papermark. If you trust this link, click to
            continue.
          </p>
          {linkUrl ? (
            <a
              href={linkUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block cursor-pointer break-all text-sm font-medium text-blue-600 underline transition-colors hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleLinkClick();
              }}
            >
              {linkUrl}
            </a>
          ) : (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Link URL not available
            </p>
          )}
          <Button
            onClick={handleLinkClick}
            className="w-full max-w-md space-x-2"
            size="lg"
            disabled={!linkUrl}
          >
            <ExternalLink className="h-4 w-4" />
            <span>Continue to {domain || "link"}</span>
          </Button>
        </div>
      </div>
      <AwayPoster
        isVisible={isInactive}
        inactivityThreshold={trackingOptions.inactivityThreshold}
        onDismiss={updateActivity}
      />
    </>
  );
}
