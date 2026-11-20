import { useEffect, useRef } from "react";

type ViewerKeyboardShortcutsOptions = {
  enabled?: boolean;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onResetZoom?: () => void;
  onToggleFullscreen?: () => void;
};

type ViewerPageKeyboardShortcutsOptions = {
  enabled?: boolean;
  orientation: "horizontal" | "vertical";
  onPreviousPage: () => void;
  onNextPage: () => void;
};

const isTextInputTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable
  );
};

const hasModifierKey = (event: KeyboardEvent) =>
  event.altKey || event.metaKey || event.ctrlKey || event.shiftKey;

export function useViewerKeyboardShortcuts({
  enabled = true,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  onToggleFullscreen,
}: ViewerKeyboardShortcutsOptions) {
  const callbacksRef = useRef({
    onZoomIn,
    onZoomOut,
    onResetZoom,
    onToggleFullscreen,
  });

  callbacksRef.current = {
    onZoomIn,
    onZoomOut,
    onResetZoom,
    onToggleFullscreen,
  };

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTextInputTarget(event.target)) return;

      const {
        onZoomIn,
        onZoomOut,
        onResetZoom,
        onToggleFullscreen,
      } = callbacksRef.current;

      if (event.metaKey || event.ctrlKey) {
        if (event.key === "=" || event.key === "+") {
          if (!onZoomIn) return;
          event.preventDefault();
          onZoomIn();
          return;
        }

        if (event.key === "-") {
          if (!onZoomOut) return;
          event.preventDefault();
          onZoomOut();
          return;
        }

        if (event.key === "0") {
          if (!onResetZoom) return;
          event.preventDefault();
          onResetZoom();
        }
        return;
      }

      if (event.key === "f" || event.key === "F") {
        if (!onToggleFullscreen) return;
        event.preventDefault();
        onToggleFullscreen();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enabled]);
}

export function useViewerPageKeyboardShortcuts({
  enabled = true,
  orientation,
  onPreviousPage,
  onNextPage,
}: ViewerPageKeyboardShortcutsOptions) {
  const callbacksRef = useRef({
    onPreviousPage,
    onNextPage,
  });

  callbacksRef.current = {
    onPreviousPage,
    onNextPage,
  };

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      // A nested widget (e.g. a Radix menu) may have already consumed the arrow
      // key for its own navigation; don't also page the document.
      if (event.defaultPrevented) return;
      if (isTextInputTarget(event.target)) return;
      if (hasModifierKey(event)) return;

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        event.stopPropagation();
        callbacksRef.current.onPreviousPage();
        return;
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        event.stopPropagation();
        callbacksRef.current.onNextPage();
        return;
      }

      if (orientation !== "vertical") return;

      if (event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        callbacksRef.current.onPreviousPage();
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        event.stopPropagation();
        callbacksRef.current.onNextPage();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [enabled, orientation]);
}
