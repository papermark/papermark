"use client";

import { useCallback, useRef, useState } from "react";

import { cn } from "@/lib/utils";

export type OverlayRedaction = {
  id: string;
  /** Normalized 0-1000 coordinates (matching what's in the DB). */
  x: number;
  y: number;
  width: number;
  height: number;
  status: "PENDING" | "ACCEPTED" | "DECLINED" | "APPLIED" | string;
  category?: string | null;
  source?: string | null;
};

export interface RedactionPageOverlayProps {
  redactions: OverlayRedaction[];
  /** Width of the rendered page image in CSS pixels. */
  pageWidth: number;
  /** Height of the rendered page image in CSS pixels. */
  pageHeight: number;
  /**
   * If provided, enables click-and-drag drawing of a new manual redaction.
   * Called with normalized 0-1000 coordinates when the user finishes a draw.
   */
  onDraw?: (box: {
    x: number;
    y: number;
    width: number;
    height: number;
  }) => void;
  className?: string;
}

/**
 * Renders semi-transparent boxes for each redaction on top of a page image.
 *
 * Accepts optional click-and-drag to draw a new manual redaction box in the
 * same 0-1000 coordinate space that AI detection uses. The caller is
 * responsible for persisting any drawn boxes via POST /items.
 */
export function RedactionPageOverlay({
  redactions,
  pageWidth,
  pageHeight,
  onDraw,
  className,
}: RedactionPageOverlayProps) {
  const layerRef = useRef<HTMLDivElement>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [dragEnd, setDragEnd] = useState<{ x: number; y: number } | null>(null);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!onDraw || !layerRef.current) return;
      const rect = layerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      setDragStart({ x, y });
      setDragEnd({ x, y });
    },
    [onDraw],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!dragStart || !layerRef.current) return;
      const rect = layerRef.current.getBoundingClientRect();
      setDragEnd({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    },
    [dragStart],
  );

  const handleMouseUp = useCallback(() => {
    if (!onDraw || !dragStart || !dragEnd || !layerRef.current) {
      setDragStart(null);
      setDragEnd(null);
      return;
    }
    const rect = layerRef.current.getBoundingClientRect();
    const rw = rect.width || pageWidth || 1;
    const rh = rect.height || pageHeight || 1;

    const xMin = Math.max(0, Math.min(dragStart.x, dragEnd.x));
    const xMax = Math.max(0, Math.max(dragStart.x, dragEnd.x));
    const yMin = Math.max(0, Math.min(dragStart.y, dragEnd.y));
    const yMax = Math.max(0, Math.max(dragStart.y, dragEnd.y));

    const width = xMax - xMin;
    const height = yMax - yMin;

    setDragStart(null);
    setDragEnd(null);

    // Ignore trivial drags (accidental clicks).
    if (width < 6 || height < 6) return;

    onDraw({
      x: (xMin / rw) * 1000,
      y: (yMin / rh) * 1000,
      width: (width / rw) * 1000,
      height: (height / rh) * 1000,
    });
  }, [onDraw, dragStart, dragEnd, pageWidth, pageHeight]);

  const liveDragRect =
    dragStart && dragEnd
      ? {
          x: Math.min(dragStart.x, dragEnd.x),
          y: Math.min(dragStart.y, dragEnd.y),
          width: Math.abs(dragEnd.x - dragStart.x),
          height: Math.abs(dragEnd.y - dragStart.y),
        }
      : null;

  return (
    <div
      ref={layerRef}
      className={cn(
        "pointer-events-auto absolute inset-0 select-none",
        onDraw ? "cursor-crosshair" : "pointer-events-none",
        className,
      )}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      style={{ width: pageWidth, height: pageHeight }}
    >
      {redactions.map((r) => (
        <div
          key={r.id}
          className={cn(
            "absolute border transition-colors",
            r.status === "ACCEPTED" &&
              "border-red-500/60 bg-black/90",
            r.status === "DECLINED" &&
              "border-muted bg-transparent opacity-30",
            r.status === "APPLIED" && "border-transparent bg-black",
            (r.status === "PENDING" || !r.status) &&
              "border-red-500/60 bg-red-500/30",
          )}
          style={{
            left: `${(r.x / 1000) * 100}%`,
            top: `${(r.y / 1000) * 100}%`,
            width: `${(r.width / 1000) * 100}%`,
            height: `${(r.height / 1000) * 100}%`,
          }}
          title={r.category ?? undefined}
        />
      ))}
      {liveDragRect ? (
        <div
          className="absolute border border-primary bg-primary/20"
          style={{
            left: liveDragRect.x,
            top: liveDragRect.y,
            width: liveDragRect.width,
            height: liveDragRect.height,
          }}
        />
      ) : null}
    </div>
  );
}
