import { useEffect, useRef, useState } from "react";
import React from "react";

import { ConfidentialViewOverlay } from "@/ee/features/permissions/components/confidential-view/confidential-view-overlay";
import "@/public/vendor/handsontable/handsontable.full.min.css";
import { Brand, DataroomBrand } from "@prisma/client";

import { useSafePageViewTracker } from "@/lib/tracking/safe-page-view-tracker";
import { getTrackingOptions } from "@/lib/tracking/tracking-config";
import { cn } from "@/lib/utils";

import { Button } from "@/components/ui/button";

import { ScreenProtector } from "../ScreenProtection";
import { TDocumentData } from "../dataroom/dataroom-view";
import Nav, { TNavData } from "../nav";
import { AwayPoster } from "./away-poster";

// Define the type for the JSON data
type RowData = { [key: string]: any };
type SheetData = {
  sheetName: string;
  columnData: string[];
  rowData: RowData[];
};

export default function ExcelViewer({
  versionNumber,
  sheetData,
  screenshotProtectionEnabled,
  confidentialViewEnabled,
  navData,
}: {
  versionNumber: number;
  sheetData: SheetData[];
  screenshotProtectionEnabled: boolean;
  confidentialViewEnabled?: boolean;
  navData: TNavData;
}) {
  const [availableWidth, setAvailableWidth] = useState<number>(200);
  const [availableHeight, setAvailableHeight] = useState<number>(200);
  const [handsontableLoaded, setHandsontableLoaded] = useState<boolean>(false);
  const [selectedSheetIndex, setSelectedSheetIndex] = useState<number>(0);

  const [isWindowFocused, setIsWindowFocused] = useState(true);

  const { linkId, documentId, viewId, isPreview, dataroomId } = navData;

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

  useEffect(() => {
    const script = document.createElement("script");
    script.src =
      "https://cdnjs.cloudflare.com/ajax/libs/handsontable/6.2.2/handsontable.full.min.js";
    script.async = true;
    script.onload = () => {
      setHandsontableLoaded(true);
    };
    script.onerror = () => {
      console.error("Failed to load Handsontable script.");
    };

    document.body.appendChild(script);

    return () => {
      document.body.removeChild(script);
    };
  }, []);

  const hotRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // @ts-ignore - Handsontable import has not types
  const hotInstanceRef = useRef<Handsontable | null>(null);

  const calculateSize = () => {
    if (containerRef.current) {
      const offset = containerRef.current.getBoundingClientRect();
      setAvailableWidth(Math.max(offset.width, 200));
      setAvailableHeight(Math.max(offset.height - 50, 200));
    }
  };

  useEffect(() => {
    const handleResize = () => {
      calculateSize();
    };

    window.addEventListener("resize", handleResize);
    calculateSize();

    return () => window.removeEventListener("resize", handleResize);
  }, []);

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

  // Start interval tracking when component mounts
  useEffect(() => {
    const trackingData = {
      linkId,
      documentId,
      viewId,
      pageNumber: selectedSheetIndex + 1,
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
      if (document.visibilityState === "visible") {
        visibilityRef.current = true;
        resetTrackingState();

        // Restart interval tracking
        const trackingData = {
          linkId,
          documentId,
          viewId,
          pageNumber: selectedSheetIndex + 1,
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
            pageNumber: selectedSheetIndex + 1,
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
    selectedSheetIndex,
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
          pageNumber: selectedSheetIndex + 1,
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
    selectedSheetIndex,
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
    if (handsontableLoaded && sheetData.length) {
      if (hotInstanceRef.current) {
        hotInstanceRef.current.destroy();
      }

      const { columnData, rowData } = sheetData[selectedSheetIndex];

      // @ts-ignore - Handsontable import has not types
      hotInstanceRef.current = new Handsontable(hotRef.current!, {
        data: rowData,
        readOnly: true,
        disableVisualSelection: true,
        comments: false,
        contextMenu: false,
        colHeaders: columnData,
        rowHeaders: true,
        manualColumnResize: true,
        width: availableWidth,
        height: availableHeight,
        rowHeights: 23,
        stretchH: "none",
        viewportRowRenderingOffset: 10,
        viewportColumnRenderingOffset: 2,
        readOnlyCellClassName: "",
        // modifyColWidth: (width: number) => {
        //   if (width > 300) {
        //     return 300;
        //   }
        // },
      });
    }
  }, [
    handsontableLoaded,
    sheetData,
    selectedSheetIndex,
    availableHeight,
    availableWidth,
  ]);

  return (
    <>
      <Nav type="sheet" navData={navData} />
      <div
        style={{ height: "calc(100dvh - 64px)" }}
        className={cn(
          "mx-2 flex h-dvh flex-col sm:mx-6 lg:mx-8",
          !isWindowFocused &&
            screenshotProtectionEnabled &&
            "blur-xl transition-all duration-300",
        )}
        ref={containerRef}
      >
        <div className="" ref={hotRef}></div>
        <div className="flex max-w-fit divide-x divide-gray-200 overflow-x-scroll whitespace-nowrap rounded-b-sm bg-[#f0f0f0] px-1">
          {sheetData.map((sheet, index) => (
            <div className="px-1" key={sheet.sheetName}>
              <Button
                onClick={() => setSelectedSheetIndex(index)}
                className={cn(
                  "mb-1 rounded-none rounded-b-sm bg-[#f0f0f0] font-normal text-gray-950 hover:bg-gray-50",
                  index === selectedSheetIndex &&
                    "bg-white font-medium text-black ring-1 ring-gray-500 hover:bg-white",
                )}
              >
                {sheet.sheetName}
              </Button>
            </div>
          ))}
        </div>
        {screenshotProtectionEnabled ? <ScreenProtector /> : null}
        {confidentialViewEnabled ? <ConfidentialViewOverlay /> : null}
        <AwayPoster
          isVisible={isInactive}
          inactivityThreshold={
            getTrackingOptions().inactivityThreshold || 20000
          }
          onDismiss={updateActivity}
        />
      </div>
    </>
  );
}
