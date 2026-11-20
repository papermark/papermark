import { useEffect } from "react";

type SavedStyles = {
  htmlOverflow: string;
  htmlOverscroll: string;
  bodyOverflow: string;
  bodyOverscroll: string;
  bodyPosition: string;
  bodyTop: string;
  bodyLeft: string;
  bodyRight: string;
  bodyWidth: string;
};

let lockCount = 0;
let saved: SavedStyles | null = null;
let savedScrollY = 0;

const isTouchDevice = () =>
  typeof window !== "undefined" &&
  ("ontouchstart" in window ||
    (navigator.maxTouchPoints ?? 0) > 0 ||
    (typeof window.matchMedia === "function" &&
      window.matchMedia("(pointer: coarse)").matches));

const applyLock = () => {
  const html = document.documentElement;
  const body = document.body;
  saved = {
    htmlOverflow: html.style.overflow,
    htmlOverscroll: html.style.overscrollBehaviorY,
    bodyOverflow: body.style.overflow,
    bodyOverscroll: body.style.overscrollBehaviorY,
    bodyPosition: body.style.position,
    bodyTop: body.style.top,
    bodyLeft: body.style.left,
    bodyRight: body.style.right,
    bodyWidth: body.style.width,
  };
  savedScrollY = window.scrollY;
  // overscroll-behavior alone does not defeat iOS Safari's pull-to-refresh
  // when the body is not the scroll container (the document lives inside an
  // inner overflow-auto div). Making the body structurally non-scrollable via
  // position:fixed leaves pull-to-refresh nothing to pull on. The scroll
  // position is preserved and restored on release.
  html.style.overflow = "hidden";
  html.style.overscrollBehaviorY = "none";
  body.style.overflow = "hidden";
  body.style.overscrollBehaviorY = "none";
  body.style.position = "fixed";
  body.style.top = `-${savedScrollY}px`;
  body.style.left = "0";
  body.style.right = "0";
  body.style.width = "100%";
};

const releaseLock = () => {
  if (!saved) return;
  const html = document.documentElement;
  const body = document.body;
  html.style.overflow = saved.htmlOverflow;
  html.style.overscrollBehaviorY = saved.htmlOverscroll;
  body.style.overflow = saved.bodyOverflow;
  body.style.overscrollBehaviorY = saved.bodyOverscroll;
  body.style.position = saved.bodyPosition;
  body.style.top = saved.bodyTop;
  body.style.left = saved.bodyLeft;
  body.style.right = saved.bodyRight;
  body.style.width = saved.bodyWidth;
  window.scrollTo(0, savedScrollY);
  saved = null;
};

/**
 * Structurally locks `<body>` scroll while mounted so iOS Safari's
 * pull-to-refresh has nothing to pull on. No-op on non-touch devices, where
 * `position: fixed` on the body would break native scrolling.
 *
 * Reference-counted so overlapping callers (e.g. a viewer plus the
 * confidential-view overlay it renders) share one lock; the body is restored
 * only after the last caller unmounts.
 */
export function useDisablePullToRefresh(enabled = true) {
  useEffect(() => {
    if (!enabled || !isTouchDevice()) return;
    lockCount += 1;
    if (lockCount === 1) applyLock();
    return () => {
      lockCount -= 1;
      if (lockCount === 0) releaseLock();
    };
  }, [enabled]);
}
