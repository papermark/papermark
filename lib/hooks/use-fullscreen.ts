import { CSSProperties, useCallback, useEffect, useState } from "react";

type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};

const getNativeFullscreenElement = () => {
  if (typeof document === "undefined") return null;
  const doc = document as FullscreenDocument;
  return document.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
};

const supportsNativeFullscreen = () => {
  if (typeof document === "undefined") return false;
  const el = document.documentElement as FullscreenElement;
  return (
    typeof el.requestFullscreen === "function" ||
    typeof el.webkitRequestFullscreen === "function"
  );
};

/**
 * Cross-platform viewer fullscreen.
 *
 * Desktop, Android Chrome and iPadOS support the native Fullscreen API, so we
 * use it there. iPhone Safari/Chrome (all iOS browsers are WebKit) do not
 * implement the API for non-video elements — `requestFullscreen` is undefined —
 * so the button previously did nothing. There we fall back to a CSS
 * "pseudo-fullscreen": the caller expands the viewer to fill the viewport
 * (`position: fixed`, `100dvh`) and hides its own chrome. `isFullscreen`
 * reflects either mode so the UI can render a single toggle.
 */
/** Quarter-turn rotation applied to the content while presenting fullscreen. */
export type Rotation = 0 | 90 | 180 | 270;

/**
 * Fixed, full-viewport layer style for a rotated presentation. Rotating the
 * *content* (rather than relying on the device) lets a viewer hold the phone
 * upright with orientation lock on and still see a slide landscape, without the
 * browser chrome that appears when the device itself is turned.
 *
 * For quarter turns the width/height are swapped (`100dvh` x `100dvw`) so the
 * rotated box fills the physical viewport; the black background covers the
 * letterbox bands.
 */
export function getRotationLayerStyle(
  rotation: Rotation,
  backgroundColor = "black",
): CSSProperties | null {
  if (rotation === 0) return null;
  const quarter = rotation === 90 || rotation === 270;
  return {
    position: "fixed",
    top: "50%",
    left: "50%",
    width: quarter ? "100dvh" : "100dvw",
    height: quarter ? "100dvw" : "100dvh",
    transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
    transformOrigin: "center center",
    backgroundColor,
    zIndex: 60,
  };
}

/**
 * Map a physical (screen-space) swipe delta into the rotated content's own
 * coordinate frame so horizontal navigation keeps working after a quarter turn.
 * CSS `rotate(r)` maps content -> screen by R(r); the inverse R(-r) recovers the
 * content-space delta from the observed screen delta.
 */
export function unrotateDelta(
  dx: number,
  dy: number,
  rotation: Rotation,
): { dx: number; dy: number } {
  switch (rotation) {
    case 0:
      return { dx, dy };
    case 90:
      return { dx: dy, dy: -dx };
    case 180:
      return { dx: -dx, dy: -dy };
    case 270:
      return { dx: -dy, dy: dx };
    default: {
      const _exhaustive: never = rotation;
      return { dx, dy };
    }
  }
}

/**
 * `object-contain` keeps an image's aspect ratio and centers it inside its
 * element box. In fullscreen the box is stretched taller/wider than the visible
 * image by the fill-height and max-width caps, so the measured `clientWidth`/
 * `clientHeight` overstates the document. Given the element box and the image's
 * aspect ratio, return the visible image rect and its centering offset so
 * overlays (e.g. the watermark) cover the document exactly and scale uniformly
 * with it instead of drifting into the letterbox bands.
 */
export function getContainedImageRect(
  boxWidth: number,
  boxHeight: number,
  aspectRatio: number,
): { width: number; height: number; left: number; top: number } {
  if (!boxWidth || !boxHeight || !aspectRatio) {
    return { width: boxWidth, height: boxHeight, left: 0, top: 0 };
  }
  const boxAspect = boxWidth / boxHeight;
  let width = boxWidth;
  let height = boxHeight;
  if (aspectRatio > boxAspect) {
    height = boxWidth / aspectRatio;
  } else {
    width = boxHeight * aspectRatio;
  }
  return {
    width,
    height,
    left: (boxWidth - width) / 2,
    top: (boxHeight - height) / 2,
  };
}

export function useFullscreen() {
  const [isNativeFullscreen, setIsNativeFullscreen] = useState(false);
  const [isPseudoFullscreen, setIsPseudoFullscreen] = useState(false);
  const [rotation, setRotation] = useState<Rotation>(0);

  useEffect(() => {
    const sync = () => setIsNativeFullscreen(!!getNativeFullscreenElement());
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("webkitfullscreenchange", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      document.removeEventListener("webkitfullscreenchange", sync);
    };
  }, []);

  // Escape exits pseudo-fullscreen (native fullscreen handles Escape itself).
  useEffect(() => {
    if (!isPseudoFullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsPseudoFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isPseudoFullscreen]);

  const isFullscreen = isNativeFullscreen || isPseudoFullscreen;

  // Rotation is a fullscreen-only presentation affordance; drop it whenever we
  // leave fullscreen so re-entering always starts upright.
  useEffect(() => {
    if (!isFullscreen) setRotation(0);
  }, [isFullscreen]);

  // A single control that toggles the presentation between upright and one
  // quarter turn. The geometry helpers stay general (any multiple of 90) so a
  // future multi-step control needs no rework here.
  const rotate = useCallback(() => {
    setRotation((prev) => (prev === 0 ? 90 : 0));
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (isPseudoFullscreen) {
      setIsPseudoFullscreen(false);
      return;
    }

    if (!supportsNativeFullscreen()) {
      setIsPseudoFullscreen(true);
      return;
    }

    const doc = document as FullscreenDocument;
    if (getNativeFullscreenElement()) {
      (doc.exitFullscreen ?? doc.webkitExitFullscreen)?.call(document);
      return;
    }

    const el = document.documentElement as FullscreenElement;
    const request = el.requestFullscreen ?? el.webkitRequestFullscreen;
    const result = request?.call(el);
    // Some browsers reject the promise when the gesture is not trusted; fall
    // back to pseudo-fullscreen so the button always does something.
    if (result && typeof (result as Promise<void>).catch === "function") {
      (result as Promise<void>).catch(() => setIsPseudoFullscreen(true));
    }
  }, [isPseudoFullscreen]);

  return {
    isFullscreen,
    isPseudoFullscreen,
    toggleFullscreen,
    rotation,
    rotate,
  };
}
