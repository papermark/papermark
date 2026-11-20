import { useEffect, useState } from "react";

/**
 * Returns the viewport `top` (in px) a right-hand viewer panel (AI chat / Q&A)
 * should use so it sits flush beneath the top bar while it's visible and grows
 * to full height as the top bar scrolls out of view.
 *
 * It tracks the bottom edge of the element tagged with `data-viewer-top-bar`.
 * On views where the top bar never scrolls away (document viewers use an inner
 * scroll region) the value stays at the bar height; on window-scrolling views
 * (dataroom home) it shrinks toward 0 as the bar leaves the viewport.
 */
export function useViewerPanelTop(fallback = 64) {
  const [top, setTop] = useState(fallback);

  useEffect(() => {
    let frame = 0;

    const measure = () => {
      const el = document.querySelector<HTMLElement>("[data-viewer-top-bar]");
      const bottom = el ? el.getBoundingClientRect().bottom : fallback;
      setTop(Math.max(0, bottom));
    };

    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [fallback]);

  return top;
}
