import dynamic from "next/dynamic";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import React from "react";

import { Slash } from "lucide-react";
import { ExtendedRecordMap } from "notion-types";
import { parsePageId } from "notion-utils";
import { useQueryState } from "nuqs";
import { NotionRenderer } from "react-notion-x";
// core styles shared by all of react-notion-x (required)
import "react-notion-x/src/styles.css";

import { useSafePageViewTracker } from "@/lib/tracking/safe-page-view-tracker";
import { getTrackingOptions } from "@/lib/tracking/tracking-config";
import { NotionTheme } from "@/lib/types";
import { cn } from "@/lib/utils";
import { createAdaptiveSurfacePalette } from "@/lib/utils/create-adaptive-surface-palette";

import {
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Portal } from "@/components/ui/portal";

import { ScreenProtector } from "../../view/ScreenProtection";
import Nav, { TNavData } from "../../view/nav";
import { AwayPoster } from "./away-poster";

// custom styles for notion
import "@/styles/custom-notion-styles.css";

const Collection = dynamic(() =>
  import("react-notion-x/build/third-party/collection").then(
    (m) => m.Collection,
  ),
);

const Code = dynamic(() =>
  import("react-notion-x/build/third-party/code").then((m) => m.Code),
);

// Obfuscate Notion block IDs in the DOM to hide the original Notion page IDs
const obfuscateNotionIds = (container: HTMLElement) => {
  // Pattern to match Notion-style UUIDs (with or without hyphens)
  const uuidPattern =
    /[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}/gi;

  // Create a map to consistently replace the same ID with the same obfuscated value
  const idMap = new Map<string, string>();
  let counter = 0;

  const getObfuscatedId = (originalId: string): string => {
    const normalizedId = originalId.toLowerCase().replace(/-/g, "");
    if (!idMap.has(normalizedId)) {
      idMap.set(normalizedId, `block-${counter++}`);
    }
    return idMap.get(normalizedId)!;
  };

  // Obfuscate element IDs
  const elementsWithId = container.querySelectorAll("[id]");
  elementsWithId.forEach((el) => {
    const id = el.getAttribute("id");
    if (id && uuidPattern.test(id)) {
      const newId = id.replace(uuidPattern, (match) => getObfuscatedId(match));
      el.setAttribute("id", newId);
    }
    // Reset the pattern lastIndex
    uuidPattern.lastIndex = 0;
  });

  // Obfuscate data-block-id attributes
  const elementsWithBlockId = container.querySelectorAll("[data-block-id]");
  elementsWithBlockId.forEach((el) => {
    const blockId = el.getAttribute("data-block-id");
    if (blockId && uuidPattern.test(blockId)) {
      el.setAttribute("data-block-id", getObfuscatedId(blockId));
    }
    uuidPattern.lastIndex = 0;
  });

  // Obfuscate data-id attributes
  const elementsWithDataId = container.querySelectorAll("[data-id]");
  elementsWithDataId.forEach((el) => {
    const dataId = el.getAttribute("data-id");
    if (dataId && uuidPattern.test(dataId)) {
      el.setAttribute("data-id", getObfuscatedId(dataId));
    }
    uuidPattern.lastIndex = 0;
  });

  // Obfuscate class names that contain Notion IDs
  const allElements = container.querySelectorAll("*");
  allElements.forEach((el) => {
    const classList = el.className;
    if (typeof classList === "string" && uuidPattern.test(classList)) {
      const newClassList = classList.replace(uuidPattern, (match) =>
        getObfuscatedId(match),
      );
      el.className = newClassList;
    }
    uuidPattern.lastIndex = 0;
  });

  // Obfuscate anchor href attributes that contain Notion IDs (skip external links with target)
  const anchors = container.querySelectorAll("a[href]:not([target])");
  anchors.forEach((anchor) => {
    const href = anchor.getAttribute("href");
    if (href && uuidPattern.test(href)) {
      const newHref = href.replace(uuidPattern, (match) =>
        getObfuscatedId(match),
      );
      anchor.setAttribute("href", newHref);
    }
    uuidPattern.lastIndex = 0;
  });
};

export const NotionPage = ({
  recordMap,
  versionNumber,
  theme,
  screenshotProtectionEnabled,
  textSelectionEnabled,
  navData,
}: {
  recordMap: ExtendedRecordMap;
  versionNumber: number;
  theme?: NotionTheme | null;
  screenshotProtectionEnabled: boolean;
  textSelectionEnabled: boolean;
  navData: TNavData;
}) => {
  const { isPreview, linkId, documentId, viewId, brand } = navData;
  const navPalette = createAdaptiveSurfacePalette(brand?.brandColor);
  const [pageNumber, setPageNumber] = useState<number>(1); // start on first page
  const [loading, setLoading] = useState<boolean>(false);
  const [subPageId, setSubPageId] = useQueryState("pageid", {
    history: "push",
    scroll: true,
  });
  const [subTitle, setSubTitle] = useState<string>("");
  const [title, setTitle] = useState<string>("");

  const [isWindowFocused, setIsWindowFocused] = useState(true);

  const [recordMapState, setRecordMapState] =
    useState<ExtendedRecordMap>(recordMap);

  const notionContainerRef = useRef<HTMLDivElement>(null);

  // Create a cache object to store fetched recordMaps
  const recordMapCache = useRef<{ [key: string]: ExtendedRecordMap }>({});

  const startTimeRef = useRef(Date.now());
  const pageNumberRef = useRef<number>(pageNumber);
  const visibilityRef = useRef<boolean>(true);
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

  // Start interval tracking when component mounts
  useEffect(() => {
    const trackingData = {
      linkId: linkId,
      documentId: documentId,
      viewId: viewId,
      pageNumber: pageNumberRef.current,
      versionNumber: versionNumber,
      isPreview: isPreview,
      dataroomId: navData?.dataroomId || undefined,
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
    isPreview,
    startIntervalTracking,
    stopIntervalTracking,
  ]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        visibilityRef.current = true;
        startTimeRef.current = Date.now(); // Reset start time when page becomes visible
        resetTrackingState();

        // Restart interval tracking
        const trackingData = {
          linkId: linkId,
          documentId: documentId,
          viewId: viewId,
          pageNumber: pageNumberRef.current,
          versionNumber: versionNumber,
          isPreview: isPreview,
          dataroomId: navData?.dataroomId || undefined,
        };
        startIntervalTracking(trackingData);
      } else {
        visibilityRef.current = false;
        stopIntervalTracking();

        // Track final duration using activity-aware calculation
        const duration = getActiveDuration();
        trackPageViewSafely(
          {
            linkId: linkId,
            documentId: documentId,
            viewId: viewId,
            duration: duration,
            pageNumber: pageNumberRef.current,
            versionNumber: versionNumber,
            isPreview: isPreview,
            dataroomId: navData?.dataroomId || undefined,
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
    isPreview,
    navData,
    trackPageViewSafely,
    resetTrackingState,
    startIntervalTracking,
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

  const fetchSubPage = useCallback(
    async (pageId: string | null) => {
      if (pageId) {
        if (recordMapCache.current[pageId]) {
          const currentRecordMap = recordMapCache.current[pageId];
          setRecordMapState(currentRecordMap);
          const firstBlockId = Object.keys(currentRecordMap.block)[0];
          const firstBlock = currentRecordMap.block[firstBlockId];
          const blockValue = firstBlock?.value as Record<string, any>;
          setSubTitle(
            blockValue?.properties?.title?.[0]?.[0] || "Untitled",
          );
          window.scrollTo({ top: 0, behavior: "smooth" });
          return;
        }

        setLoading(true);
        try {
          const response = await fetch("/api/file/notion", {
            method: "POST",
            body: JSON.stringify({ pageId }),
            headers: {
              "Content-Type": "application/json",
            },
          });
          const newRecordMap = await response.json();
          recordMapCache.current[pageId] = newRecordMap;
          setRecordMapState(newRecordMap);
          const firstBlockId = Object.keys(newRecordMap.block)[0];
          const firstBlock = newRecordMap.block[firstBlockId];
          const blockValue = firstBlock?.value as Record<string, any>;
          setSubTitle(
            blockValue?.properties?.title?.[0]?.[0] || "Untitled",
          );
          window.scrollTo({ top: 0, behavior: "smooth" });
        } catch (error) {
          console.error("Error fetching subpage:", error);
        } finally {
          setLoading(false);
        }
      } else {
        setRecordMapState(recordMap);
        const firstBlockId = Object.keys(recordMap.block)[0];
        const firstBlock = recordMap.block[firstBlockId];
        const blockValue = firstBlock?.value as Record<string, any>;
        setTitle(blockValue?.properties?.title?.[0]?.[0] || "Untitled");
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    },
    [recordMap],
  );

  useEffect(() => {
    fetchSubPage(subPageId);
  }, [subPageId, fetchSubPage]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      stopIntervalTracking();
      const duration = getActiveDuration();
      trackPageViewSafely(
        {
          linkId: linkId,
          documentId: documentId,
          viewId: viewId,
          duration: duration,
          pageNumber: pageNumberRef.current,
          versionNumber: versionNumber,
          isPreview: isPreview,
          dataroomId: navData?.dataroomId || undefined,
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
    isPreview,
    trackPageViewSafely,
    stopIntervalTracking,
    getActiveDuration,
  ]);

  // // Function to calculate scroll percentage
  // const calculateScrollPercentage = () => {
  //   const scrollableHeight =
  //     document.documentElement.scrollHeight - window.innerHeight;
  //   const currentScrollPosition = window.scrollY;
  //   return (currentScrollPosition / scrollableHeight) * 100;
  // };

  // // Function to handle scroll events
  // const handleScroll = () => {
  //   const scrollPercent = calculateScrollPercentage();
  //   setMaxScrollPercentage((prevMax) => Math.max(prevMax, scrollPercent));

  //   const data = {
  //     x: window.scrollX,
  //     y: window.scrollY,
  //     scrollPercentage: scrollPercent,
  //     type: "scroll",
  //   };

  //   // TODO: Store data for later use with heatmap.js
  // };

  // useEffect(() => {
  //   // Add scroll event listener
  //   window.addEventListener("scroll", handleScroll);

  //   // Remove event listener on cleanup
  //   return () => {
  //     window.removeEventListener("scroll", handleScroll);
  //   };
  // }, [maxScrollPercentage]);

  // Add a function to handle smooth scrolling to elements
  const scrollToHashElement = useCallback(() => {
    const hash = window.location.hash;
    if (hash) {
      // Remove the # from the hash
      const elementId = hash.slice(1);

      // Create observer to watch for position changes
      const observer = new MutationObserver((mutations, obs) => {
        const element = document.getElementById(elementId);
        if (element) {
          // Get current position
          const rect = element.getBoundingClientRect();
          const absoluteTop = window.scrollY + rect.top; // Account for header

          window.scrollTo({
            top: absoluteTop,
            behavior: "smooth",
          });
        }
      });

      // Start observing the document with the configured parameters
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
      });

      // Always observe for at least 2 seconds to catch any layout shifts
      setTimeout(() => {
        const element = document.getElementById(elementId);
        if (element) {
          const rect = element.getBoundingClientRect();
          const absoluteTop = window.scrollY + rect.top;
          window.scrollTo({
            top: absoluteTop,
            behavior: "smooth",
          });
        }
        observer.disconnect();
      }, 2000);
    }
  }, []);

  // Handle initial load and hash changes
  useEffect(() => {
    scrollToHashElement();

    window.addEventListener("hashchange", scrollToHashElement);
    return () => {
      window.removeEventListener("hashchange", scrollToHashElement);
    };
  }, [scrollToHashElement]);

  const PageLinkComponent = useMemo(
    () =>
      function PageLink({
        href,
        className,
        children,
        style,
      }: {
        href?: string;
        className?: string;
        children?: React.ReactNode;
        style?: React.CSSProperties;
        [key: string]: any;
      }) {
        const handleClick = (e: React.MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
          if (!href) return;

          const pageId =
            parsePageId(href, { uuid: false }) ??
            href.split("/").pop()?.split("?")[0]?.split("#")[0];

          if (pageId) {
            setSubPageId(pageId);
          }
        };

        return (
          <a
            className={className}
            style={style}
            href={href}
            onClick={handleClick}
          >
            {children}
          </a>
        );
      },
    [setSubPageId],
  );

  const notionComponents = useMemo(
    () => ({
      Collection,
      Code,
      PageLink: PageLinkComponent,
    }),
    [PageLinkComponent],
  );

  // Obfuscate Notion IDs in the DOM after rendering
  useEffect(() => {
    if (!notionContainerRef.current) return;

    const timeoutId = setTimeout(() => {
      if (notionContainerRef.current) {
        obfuscateNotionIds(notionContainerRef.current);
      }
    }, 100);

    let debounceTimer: ReturnType<typeof setTimeout>;
    const observer = new MutationObserver(() => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (notionContainerRef.current) {
          obfuscateNotionIds(notionContainerRef.current);
        }
      }, 50);
    });

    observer.observe(notionContainerRef.current, {
      childList: true,
      subtree: true,
      attributes: false,
    });

    return () => {
      clearTimeout(timeoutId);
      clearTimeout(debounceTimer);
      observer.disconnect();
    };
  }, [recordMapState]);

  if (!recordMap) {
    return null;
  }

  return (
    <div className="bg-white">
      <Nav type="notion" navData={navData} />

      <Portal
        containerId="view-breadcrump-portal"
        className="flex items-center gap-1.5"
      >
        <>
          <BreadcrumbItem>
            <BreadcrumbLink
              className="cursor-pointer underline underline-offset-4"
              onClick={() => setSubPageId(null)}
              style={{
                color: navPalette.textColor,
              }}
            >
              {title}
            </BreadcrumbLink>
          </BreadcrumbItem>
          {subPageId ? (
            <>
              <BreadcrumbSeparator>
                <Slash />
              </BreadcrumbSeparator>
              <BreadcrumbItem>
                <BreadcrumbPage
                  className="font-medium"
                  style={{
                    color: navPalette.textColor,
                  }}
                >
                  {subTitle}
                </BreadcrumbPage>
              </BreadcrumbItem>
            </>
          ) : null}
        </>
      </Portal>

      {loading && <div>Loading...</div>}

      <div
        ref={notionContainerRef}
        className={cn(
          !isWindowFocused &&
            screenshotProtectionEnabled &&
            "blur-xl transition-all duration-300",
          textSelectionEnabled && "notion-text-selection-enabled",
        )}
      >
        <NotionRenderer
          recordMap={recordMapState}
          fullPage={true}
          darkMode={theme ? theme === "dark" : false}
          disableHeader={true}
          components={notionComponents}
        />
      </div>
      {screenshotProtectionEnabled ? <ScreenProtector /> : null}
      <AwayPoster
        isVisible={isInactive}
        inactivityThreshold={getTrackingOptions().inactivityThreshold}
        onDismiss={updateActivity}
      />
    </div>
  );
};
