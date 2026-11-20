import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export function MobilePageControls({
  pageNumber,
  numPages,
  isFullscreen,
  controlsVisible,
  onPreviousPage,
  onNextPage,
}: {
  pageNumber: number;
  numPages: number;
  isFullscreen: boolean;
  controlsVisible: boolean;
  onPreviousPage: () => void;
  onNextPage: () => void;
}) {
  if (numPages <= 1) return null;

  return (
    <div
      className={cn(
        "absolute bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full bg-gray-950/50 px-1.5 py-1 text-white shadow-lg backdrop-blur transition-opacity duration-300",
        !isFullscreen || controlsVisible
          ? "opacity-100"
          : "pointer-events-none opacity-0",
      )}
    >
      <button
        onClick={onPreviousPage}
        disabled={pageNumber <= 1}
        aria-label="Previous page"
        className="rounded-full p-1.5 transition-opacity disabled:opacity-30"
      >
        <ChevronLeftIcon className="size-6" />
      </button>
      <span className="min-w-[3.5ch] text-center text-xs font-medium tabular-nums">
        {pageNumber} / {numPages}
      </span>
      <button
        onClick={onNextPage}
        disabled={pageNumber >= numPages}
        aria-label="Next page"
        className="rounded-full p-1.5 transition-opacity disabled:opacity-30"
      >
        <ChevronRightIcon className="size-6" />
      </button>
    </div>
  );
}
