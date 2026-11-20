import { useEffect, useRef, useState } from "react";

import { useTeam } from "@/context/team-context";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Document, Page, pdfjs } from "react-pdf";

import { useSafePageViewTracker } from "@/lib/tracking/safe-page-view-tracker";
import { getTrackingOptions } from "@/lib/tracking/tracking-config";
import { ensureFileExtension } from "@/lib/utils/get-content-type";

import Nav from "@/components/view/nav";

import { AwayPoster } from "./away-poster";

pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

export default function PDFViewer(props: any) {
  const { isPreview, linkId, documentId, viewId } = props.navData;

  const [numPages, setNumPages] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState<number>(1); // start on first page
  const [loading, setLoading] = useState(true);
  const [pageWidth, setPageWidth] = useState(0);

  const startTimeRef = useRef(Date.now());
  const pageNumberRef = useRef<number>(pageNumber);
  const visibilityRef = useRef<boolean>(true);
  const teamInfo = useTeam();
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

  // Update the previous page number after the effect hook has run
  useEffect(() => {
    pageNumberRef.current = pageNumber;
  }, [pageNumber]);

  // Start interval tracking when component mounts or page changes
  useEffect(() => {
    const trackingData = {
      linkId: linkId,
      documentId: documentId,
      viewId: viewId,
      pageNumber: pageNumberRef.current,
      versionNumber: props.versionNumber,
      isPreview: isPreview,
    };

    startIntervalTracking(trackingData);

    return () => {
      stopIntervalTracking();
    };
  }, [
    pageNumber,
    linkId,
    documentId,
    viewId,
    props.versionNumber,
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
          linkId: linkId,
          documentId: documentId,
          viewId: viewId,
          pageNumber: pageNumberRef.current,
          versionNumber: props.versionNumber,
          isPreview: isPreview,
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
            versionNumber: props.versionNumber,
            isPreview: isPreview,
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
    pageNumber,
    linkId,
    documentId,
    viewId,
    props.versionNumber,
    isPreview,
    trackPageViewSafely,
    resetTrackingState,
    startIntervalTracking,
    stopIntervalTracking,
    getActiveDuration,
  ]);

  useEffect(() => {
    if (numPages > 0) {
      updateNumPages(numPages);
    }
  }, [numPages]); // monitor numPages for changes

  function onDocumentLoadSuccess({
    numPages: nextNumPages,
  }: {
    numPages: number;
  }) {
    setNumPages(nextNumPages);
  }

  // Send the last page view when the user leaves the page
  // duration is measured in milliseconds
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
          versionNumber: props.versionNumber,
          isPreview: isPreview,
          dataroomId: props?.navData?.dataroomId || undefined,
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
    props.versionNumber,
    isPreview,
    trackPageViewSafely,
    stopIntervalTracking,
    getActiveDuration,
  ]);

  function onPageLoadSuccess() {
    setPageWidth(window.innerWidth);
    setLoading(false);
  }

  const options = {
    cMapUrl: "cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "standard_fonts/",
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      switch (event.key) {
        case "ArrowRight":
          goToNextPage();
          break;
        case "ArrowLeft":
          goToPreviousPage();
          break;
        default:
          break;
      }
    };

    // when the component mounts, attach the event listener
    document.addEventListener("keydown", handleKeyDown);

    // when the component unmounts, detach the event listener
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [pageNumber]);

  // Go to next page
  function goToNextPage() {
    if (pageNumber >= numPages!) return;
    setPageNumber((prevPageNumber) => prevPageNumber + 1);
  }

  function goToPreviousPage() {
    if (pageNumber <= 1) return;
    setPageNumber((prevPageNumber) => prevPageNumber - 1);
  }

  async function downloadfile(e: React.MouseEvent<HTMLButtonElement>) {
    try {
      //get file data
      const response = await fetch(props.file);
      const fileData = await response.blob();

      //create <a/> to download the file
      const a = document.createElement("a");
      a.href = window.URL.createObjectURL(fileData);
      a.download = ensureFileExtension({
        name: props.name,
        contentType: "application/pdf",
      });
      document.body.appendChild(a);
      a.click();

      //clean up used resources
      document.body.removeChild(a);
      window.URL.revokeObjectURL(a.href);
    } catch (error) {
      console.error("Error downloading file:", error);
    }
  }

  async function updateNumPages(numPages: number) {
    await fetch(`/api/teams/${teamInfo?.currentTeam?.id}/documents/update`, {
      method: "POST",
      body: JSON.stringify({
        documentId: documentId,
        numPages: numPages,
      }),
      headers: {
        "Content-Type": "application/json",
      },
    });
  }

  return (
    <>
      <Nav
        pageNumber={pageNumber}
        numPages={numPages}
        navData={props.navData}
      />
      <div
        hidden={loading}
        style={{ height: "calc(100vh - 64px)" }}
        className="flex items-center"
      >
        <div
          className={`absolute z-10 flex w-full items-center justify-between px-2`}
        >
          <button
            onClick={goToPreviousPage}
            disabled={pageNumber <= 1}
            className="h-[calc(100vh - 64px)] relative px-2 py-24 text-gray-400 hover:text-gray-50 focus:z-20"
          >
            <span className="sr-only">Previous</span>
            <ChevronLeftIcon className="h-10 w-10" aria-hidden="true" />
          </button>
          <button
            onClick={goToNextPage}
            disabled={pageNumber >= numPages!}
            className="h-[calc(100vh - 64px)] relative px-2 py-24 text-gray-400 hover:text-gray-50 focus:z-20"
          >
            <span className="sr-only">Next</span>
            <ChevronRightIcon className="h-10 w-10" aria-hidden="true" />
          </button>
        </div>

        <div className="mx-auto flex h-full justify-center">
          <Document
            file={props.file}
            onLoadSuccess={onDocumentLoadSuccess}
            options={options}
            renderMode="canvas"
            className=""
          >
            <Page
              className=""
              key={pageNumber}
              pageNumber={pageNumber}
              renderAnnotationLayer={false}
              renderTextLayer={false}
              onLoadSuccess={onPageLoadSuccess}
              onRenderError={() => setLoading(false)}
              width={Math.max(pageWidth * 0.8, 390)}
            />
          </Document>
        </div>
        <AwayPoster
          isVisible={isInactive}
          inactivityThreshold={getTrackingOptions().inactivityThreshold}
          onDismiss={updateActivity}
        />
      </div>
    </>
  );
}
