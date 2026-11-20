import { RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";

type UseTouchZoomOptions = {
  /** Element that receives the touch gestures (the scroll/zoom container). */
  containerRef: RefObject<HTMLElement>;
  /** Current zoom scale. */
  scale: number;
  /** Setter for the zoom scale (functional updates supported). */
  setScale: (updater: (prev: number) => number) => void;
  minScale?: number;
  maxScale?: number;
  enabled?: boolean;
};

const distance = (a: Touch, b: Touch) =>
  Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

/**
 * Focal-point-aware two-finger pinch-to-zoom for the continuous vertical viewer.
 *
 * The browser's native pinch-zoom operates on the visual viewport and fights
 * the viewer's own scroll container, so we drive the existing `scale` state
 * directly. Listeners are attached natively with `passive: false` because
 * React's synthetic touch handlers are passive and cannot `preventDefault()`
 * the browser gesture.
 *
 * Position awareness: the content is scaled with `transform-origin: 0 0` inside
 * a sizer that reserves the scaled dimensions, so the scroll area grows in both
 * axes. On each pinch move we record the content point under the finger midpoint
 * and, once the new scale has reflowed (layout effect), we set `scrollLeft` /
 * `scrollTop` so that point stays under the fingers. Without this the page
 * scaled from a fixed origin and snapped back to the top.
 */
export function useTouchZoom({
  containerRef,
  scale,
  setScale,
  minScale = 1,
  maxScale = 3,
  enabled = true,
}: UseTouchZoomOptions) {
  const scaleRef = useRef(scale);
  scaleRef.current = scale;

  const pinchRef = useRef<{ startDistance: number; startScale: number } | null>(
    null,
  );
  // The content point (in unscaled content coordinates) that must stay under
  // the finger midpoint, plus that midpoint relative to the scroll viewport.
  // Captured each move, consumed once by the layout effect after the new scale
  // has reflowed, then cleared so later (button) zoom changes don't reuse it.
  const focalRef = useRef<{
    ux: number;
    uy: number;
    fx: number;
    fy: number;
  } | null>(null);

  const [isPinching, setIsPinching] = useState(false);

  useLayoutEffect(() => {
    const el = containerRef.current;
    const focal = focalRef.current;
    if (!el || !focal) return;
    const maxLeft = el.scrollWidth - el.clientWidth;
    const maxTop = el.scrollHeight - el.clientHeight;
    el.scrollLeft = Math.max(0, Math.min(maxLeft, focal.ux * scale - focal.fx));
    el.scrollTop = Math.max(0, Math.min(maxTop, focal.uy * scale - focal.fy));
    focalRef.current = null;
  }, [scale, containerRef]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !enabled) return;

    const clamp = (value: number) =>
      Math.min(maxScale, Math.max(minScale, value));

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        pinchRef.current = {
          startDistance: distance(e.touches[0], e.touches[1]),
          startScale: scaleRef.current,
        };
        setIsPinching(true);
        e.preventDefault();
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && pinchRef.current) {
        e.preventDefault();
        const a = e.touches[0];
        const b = e.touches[1];
        const rect = el.getBoundingClientRect();
        const fx = (a.clientX + b.clientX) / 2 - rect.left;
        const fy = (a.clientY + b.clientY) / 2 - rect.top;
        const current = scaleRef.current;
        focalRef.current = {
          ux: (el.scrollLeft + fx) / current,
          uy: (el.scrollTop + fy) / current,
          fx,
          fy,
        };
        const ratio = distance(a, b) / pinchRef.current.startDistance;
        const next = clamp(pinchRef.current.startScale * ratio);
        scaleRef.current = next;
        setScale(() => next);
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) {
        pinchRef.current = null;
        setIsPinching(false);
      }
    };

    el.addEventListener("touchstart", onTouchStart, { passive: false });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: false });
    el.addEventListener("touchcancel", onTouchEnd, { passive: false });

    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [containerRef, enabled, minScale, maxScale, setScale]);

  return { isPinching };
}
