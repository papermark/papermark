import { useCallback, useEffect, useRef, useState } from "react";

import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { DocumentPreviewData } from "@/lib/types/document-preview";
import { cn } from "@/lib/utils";

import { Button } from "@/components/ui/button";

const PRELOAD_RADIUS = 5;

interface PreviewPagesViewerProps {
  documentData: DocumentPreviewData;
  onClose: () => void;
  pagesApiEndpoint?: string;
}

export function PreviewPagesViewer({
  documentData,
  onClose,
  pagesApiEndpoint,
}: PreviewPagesViewerProps) {
  const [currentPage, setCurrentPage] = useState(1);
  const [imageCache, setImageCache] = useState<{ [key: number]: boolean }>({});
  const [imageLoaded, setImageLoaded] = useState(imageCache[1] || false);
  const [pages, setPages] = useState(documentData.pages ?? []);
  const pagesRef = useRef(pages);
  const pendingRef = useRef<Set<number>>(new Set());
  const generationRef = useRef(0);

  const { numPages, documentName, isVertical } = documentData;

  useEffect(() => {
    pagesRef.current = pages;
  }, [pages]);

  useEffect(() => {
    setPages(documentData.pages ?? []);
    pagesRef.current = documentData.pages ?? [];
    pendingRef.current = new Set();
    generationRef.current += 1;
  }, [documentData.pages]);

  const ensurePagesLoaded = useCallback(
    async (centerPage: number) => {
      if (!pagesApiEndpoint) return;

      const generation = generationRef.current;
      const currentPages = pagesRef.current;
      const start = Math.max(1, centerPage - PRELOAD_RADIUS);
      const end = Math.min(numPages, centerPage + PRELOAD_RADIUS);
      const needed: number[] = [];

      for (let i = start; i <= end; i++) {
        if (
          !currentPages[i - 1]?.file &&
          !pendingRef.current.has(i) &&
          i <= currentPages.length
        ) {
          needed.push(i);
        }
      }

      if (needed.length === 0) return;

      needed.forEach((pn) => pendingRef.current.add(pn));

      try {
        const response = await fetch(pagesApiEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pageNumbers: needed }),
        });

        if (generationRef.current !== generation) return;

        if (response.ok) {
          const data = await response.json();
          setPages((prev) => {
            const updated = [...prev];
            for (const fetchedPage of data.pages) {
              const idx = fetchedPage.pageNumber - 1;
              if (idx >= 0 && idx < updated.length && updated[idx]) {
                updated[idx] = {
                  ...updated[idx],
                  file: fetchedPage.file,
                };
              }
            }
            return updated;
          });
        }
      } finally {
        if (generationRef.current === generation) {
          needed.forEach((pn) => pendingRef.current.delete(pn));
        }
      }
    },
    [pagesApiEndpoint, numPages],
  );

  useEffect(() => {
    ensurePagesLoaded(currentPage);
  }, [currentPage, ensurePagesLoaded]);

  const goToNextPage = useCallback(() => {
    if (currentPage < numPages) {
      setCurrentPage(currentPage + 1);
      setImageLoaded(imageCache[currentPage + 1] || false);
    }
  }, [currentPage, numPages, imageCache]);

  const goToPreviousPage = useCallback(() => {
    if (currentPage > 1) {
      setCurrentPage(currentPage - 1);
      setImageLoaded(imageCache[currentPage - 1] || false);
    }
  }, [currentPage, numPages, imageCache]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowLeft":
          goToPreviousPage();
          break;
        case "ArrowRight":
          goToNextPage();
          break;
        case "Escape":
          onClose();
          break;
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [goToPreviousPage, goToNextPage, onClose]);

  if (!pages || pages.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <p className="text-gray-400">No pages available for preview</p>
      </div>
    );
  }

  const currentPageData = pages[currentPage - 1];

  const handleImageLoad = () => {
    setImageLoaded(true);
    setImageCache((prev) => ({ ...prev, [currentPage]: true }));
  };

  if (!currentPageData) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <p className="text-gray-400">Page not found</p>
      </div>
    );
  }

  const hasFileUrl = !!currentPageData.file;

  return (
    <div className="relative h-full w-full overflow-hidden">
      {/* Navigation Controls */}
      <div className="absolute left-4 top-4 z-50">
        <div className="flex items-center gap-2 rounded-lg bg-black/20 px-3 py-2 text-white">
          <span className="text-sm">
            Page {currentPage} of {numPages}
          </span>
        </div>
      </div>

      {/* Document Title */}
      <div className="absolute left-1/2 top-4 z-50 -translate-x-1/2">
        <div className="rounded-lg bg-black/20 px-3 py-2 text-white">
          <span className="text-sm font-medium">{documentName}</span>
        </div>
      </div>

      {/* Previous Page Button */}
      <Button
        variant="ghost"
        size="icon"
        onClick={goToPreviousPage}
        disabled={currentPage <= 1}
        className={cn(
          "absolute left-4 top-1/2 z-40 h-12 w-12 -translate-y-1/2 rounded-full bg-black/20 text-white hover:bg-black/40",
          currentPage <= 1 && "cursor-not-allowed opacity-50",
        )}
      >
        <ChevronLeftIcon className="h-6 w-6" />
      </Button>

      {/* Next Page Button */}
      <Button
        variant="ghost"
        size="icon"
        onClick={goToNextPage}
        disabled={currentPage >= numPages}
        className={cn(
          "absolute right-4 top-1/2 z-40 h-12 w-12 -translate-y-1/2 rounded-full bg-black/20 text-white hover:bg-black/40",
          currentPage >= numPages && "cursor-not-allowed opacity-50",
        )}
      >
        <ChevronRightIcon className="h-6 w-6" />
      </Button>

      {/* Page Content */}
      <div className="flex h-full w-full items-center justify-center p-4">
        <div className="relative max-h-full max-w-full">
          {(!imageLoaded || !hasFileUrl) && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
            </div>
          )}

          {hasFileUrl && (
            <img
              src={currentPageData.file!}
              alt={`Page ${currentPage}`}
              className={cn(
                "max-h-[calc(100vh-120px)] max-w-full object-contain transition-opacity duration-200",
                imageLoaded ? "opacity-100" : "opacity-0",
              )}
              onLoad={handleImageLoad}
              onError={() => {
                setImageLoaded(false);
                setImageCache((prev) => ({ ...prev, [currentPage]: false }));

                const idx = currentPage - 1;
                const current = pagesRef.current;
                if (idx >= 0 && idx < current.length && current[idx]) {
                  const updated = [...current];
                  updated[idx] = { ...updated[idx], file: "" };
                  pagesRef.current = updated;
                  setPages(updated);
                }
                pendingRef.current.delete(currentPage);
                ensurePagesLoaded(currentPage);
              }}
              draggable={false}
              onContextMenu={(e) => e.preventDefault()}
            />
          )}
        </div>
      </div>

      {/* Bottom Navigation */}
      <div className="absolute bottom-4 left-1/2 z-50 -translate-x-1/2">
        <div className="flex items-center gap-2 rounded-lg bg-black/20 px-4 py-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={goToPreviousPage}
            disabled={currentPage <= 1}
            className="h-8 px-3 text-white hover:bg-white/10"
          >
            Previous
          </Button>

          <span className="text-sm text-white">
            {currentPage} / {numPages}
          </span>

          <Button
            variant="ghost"
            size="sm"
            onClick={goToNextPage}
            disabled={currentPage >= numPages}
            className="h-8 px-3 text-white hover:bg-white/10"
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
