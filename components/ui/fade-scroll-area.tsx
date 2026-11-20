import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { ScrollArea } from "@/components/ui/scroll-area";

const FADE_THRESHOLD_PX = 10;

/**
 * ScrollArea with top/bottom fade masks that appear when content overflows in
 * that direction (same affordance as the viewer FAQ section), plus an optional
 * always-rendered scrollbar. Pair `showScrollbar` with a right-padded
 * `contentClassName` (at least `pr-2.5`, the scrollbar width) to keep content
 * out of the scrollbar gutter.
 */
export function FadeScrollArea({
  className,
  contentClassName,
  showScrollbar,
  children,
}: {
  className?: string;
  contentClassName?: string;
  showScrollbar?: boolean;
  children: React.ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [showTopFade, setShowTopFade] = useState(false);
  const [showBottomFade, setShowBottomFade] = useState(false);

  useEffect(() => {
    const viewport = rootRef.current?.querySelector<HTMLElement>(
      "[data-radix-scroll-area-viewport]",
    );
    if (!viewport) return;

    const update = () => {
      const { scrollTop, scrollHeight, clientHeight } = viewport;
      setShowTopFade(scrollTop > FADE_THRESHOLD_PX);
      setShowBottomFade(
        scrollTop < scrollHeight - clientHeight - FADE_THRESHOLD_PX,
      );
    };

    update();
    viewport.addEventListener("scroll", update, { passive: true });

    // Re-check when the viewport resizes or its content grows/shrinks
    // (rows load async, filters change the list length).
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    if (viewport.firstElementChild) {
      observer.observe(viewport.firstElementChild);
    }

    return () => {
      viewport.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, []);

  return (
    <div className={cn("relative min-h-0", className)}>
      {/* Radix wraps the viewport content in a `display: table`, which grows to the widest row
          instead of clamping to the viewport, so `truncate` inside rows never engages. */}
      <ScrollArea
        ref={rootRef}
        className="h-full"
        showScrollbar={showScrollbar}
        viewportClassName="[&>*]:!block"
      >
        <div className={contentClassName}>{children}</div>
      </ScrollArea>

      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 z-10 h-8 bg-gradient-to-b from-background via-background/60 to-transparent transition-opacity duration-200",
          showTopFade ? "opacity-100" : "opacity-0",
        )}
      />
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-0 z-10 h-8 bg-gradient-to-t from-background via-background/60 to-transparent transition-opacity duration-200",
          showBottomFade ? "opacity-100" : "opacity-0",
        )}
      />
    </div>
  );
}
