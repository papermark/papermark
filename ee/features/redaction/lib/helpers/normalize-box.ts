import type { RedactionBox } from "../schemas/redaction";

/**
 * Convert a Gemini `box2d` value `[yMin, xMin, yMax, xMax]` (all on a 0-1000 scale)
 * into a `{x, y, width, height}` rectangle on the same 0-1000 scale.
 *
 * The top-left of the box is `(xMin, yMin)` and the bottom-right is `(xMax, yMax)`.
 * We return positive width/height and clamp values so invalid AI output can't
 * produce negative or out-of-range boxes.
 */
export function normalizeBox2d(box2d: number[]): RedactionBox {
  if (!Array.isArray(box2d) || box2d.length !== 4) {
    throw new Error(
      `Invalid box2d: expected [yMin, xMin, yMax, xMax] array of length 4`,
    );
  }

  const [yMinRaw, xMinRaw, yMaxRaw, xMaxRaw] = box2d;

  const clamp = (n: number) => Math.min(1000, Math.max(0, Number(n) || 0));

  const xMin = Math.min(clamp(xMinRaw), clamp(xMaxRaw));
  const xMax = Math.max(clamp(xMinRaw), clamp(xMaxRaw));
  const yMin = Math.min(clamp(yMinRaw), clamp(yMaxRaw));
  const yMax = Math.max(clamp(yMinRaw), clamp(yMaxRaw));

  return {
    x: xMin,
    y: yMin,
    width: xMax - xMin,
    height: yMax - yMin,
  };
}

/**
 * Convert a stored 0-1000 normalized box into absolute PDF point coordinates.
 *
 * PDF coordinates originate at the bottom-left of the page; our stored y
 * is measured from the top-left of the page image (consistent with Gemini
 * output), so we flip the Y axis here.
 */
export function boxToPdfRect(
  box: RedactionBox,
  pageWidth: number,
  pageHeight: number,
): { x: number; y: number; width: number; height: number } {
  const width = (box.width / 1000) * pageWidth;
  const height = (box.height / 1000) * pageHeight;
  const x = (box.x / 1000) * pageWidth;
  const y = pageHeight - ((box.y + box.height) / 1000) * pageHeight;
  return { x, y, width, height };
}
