import {
  PDF,
  type PDFPage,
  type RGB,
  Standard14Font,
  StandardFonts,
  degrees,
  rgb,
} from "@libpdf/core";

import { safeTemplateReplace } from "@/lib/utils";

export interface WatermarkConfig {
  text: string;
  isTiled: boolean;
  position:
    | "top-left"
    | "top-center"
    | "top-right"
    | "middle-left"
    | "middle-center"
    | "middle-right"
    | "bottom-left"
    | "bottom-center"
    | "bottom-right";
  rotation: 0 | 30 | 45 | 90 | 180;
  color: string;
  fontSize: number;
  opacity: number; // 0 to 0.8
}

export interface ViewerData {
  email?: string | null;
  date?: string;
  ipAddress?: string;
  link?: string | null;
  time?: string;
}

// Standard Helvetica is one of the built-in PDF fonts, so it needs no
// embedding. A measurement instance lets us size/position text accurately.
const WATERMARK_FONT = StandardFonts.Helvetica;
const measureFont = Standard14Font.of(StandardFonts.Helvetica);

// Helvetica ascent/descent ratios relative to the full text height returned by
// `heightAtSize` (ascent ≈ 718/1000, descent ≈ 207/1000 → 0.776 / 0.224).
const ASCENT_RATIO = 0.776;
const DESCENT_RATIO = 0.224;

const toRadians = (deg: number): number => (deg * Math.PI) / 180;

/** Convert a `#RGB`/`#RRGGBB` hex string to a LibPDF RGB color. */
function hexToLibColor(hex: string): RGB {
  let value = hex.replace(/^#/, "");
  if (value.length === 3) {
    value = value
      .split("")
      .map((c) => c + c)
      .join("");
  }
  const int = parseInt(value, 16);
  if (Number.isNaN(int)) return rgb(0, 0, 0);
  return rgb(
    ((int >> 16) & 255) / 255,
    ((int >> 8) & 255) / 255,
    (int & 255) / 255,
  );
}

/**
 * Rotate a point around a pivot by `angleRad` (counter-clockwise, matching the
 * PDF coordinate system where the y-axis points up).
 */
function rotatePoint(
  px: number,
  py: number,
  pivotX: number,
  pivotY: number,
  angleRad: number,
): { x: number; y: number } {
  const dx = px - pivotX;
  const dy = py - pivotY;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  return {
    x: pivotX + dx * cos - dy * sin,
    y: pivotY + dx * sin + dy * cos,
  };
}

/**
 * Replace Unicode characters that can't be encoded in the WinAnsi character
 * set used by the standard Helvetica font.
 */
export function sanitizeWatermarkText(text: string): string {
  const replacements: { [key: string]: string } = {
    // Turkish characters
    İ: "I",
    ı: "i",
    ğ: "g",
    Ğ: "G",
    ü: "u",
    Ü: "U",
    ş: "s",
    Ş: "S",
    ç: "c",
    Ç: "C",
    ö: "o",
    Ö: "O",
    // German characters
    ß: "ss",
    ä: "a",
    Ä: "A",
    ë: "e",
    Ë: "E",
    // French characters
    à: "a",
    À: "A",
    é: "e",
    É: "E",
    è: "e",
    È: "E",
    ê: "e",
    Ê: "E",
    ù: "u",
    Ù: "U",
    ô: "o",
    Ô: "O",
    // Spanish characters
    ñ: "n",
    Ñ: "N",
    á: "a",
    Á: "A",
    í: "i",
    Í: "I",
    ó: "o",
    Ó: "O",
    ú: "u",
    Ú: "U",
    // Common symbols
    "€": "EUR",
    "£": "GBP",
    "¥": "JPY",
    "©": "(c)",
    "®": "(R)",
    "™": "TM",
    "…": "...",
    "–": "-",
    "—": "-",
    "\u201C": '"',
    "\u201D": '"',
    "\u2018": "'",
    "\u2019": "'",
    "•": "*",
  };

  let sanitized = text;
  for (const [original, replacement] of Object.entries(replacements)) {
    sanitized = sanitized.replace(new RegExp(original, "g"), replacement);
  }
  // Replace any remaining non-WinAnsi characters (outside Latin-1 range)
  sanitized = sanitized.replace(/[^\u0000-\u00FF]/g, "?");
  return sanitized;
}

/**
 * Mirror the responsive font sizing used by the on-screen SVG watermark
 * (`components/view/watermark-svg.tsx`) so the downloaded document matches the
 * preview the viewer saw.
 */
function calculateFontSize(
  config: WatermarkConfig,
  width: number,
  height: number,
): number {
  const baseFontSize = Math.min(width, height) * (config.fontSize / 1000);
  return Math.max(8, Math.min(baseFontSize, config.fontSize));
}

/**
 * Given a target centre point and the text metrics, return the baseline-left
 * coordinate LibPDF expects so that the (rotated) text is centred on the
 * point. LibPDF rotates the glyphs counter-clockwise around the supplied
 * baseline-left point, so we shift back along the text direction by half the
 * width and "down" (in the glyph frame) to the baseline.
 */
function baselineForCenteredText(
  centerX: number,
  centerY: number,
  textWidth: number,
  ascent: number,
  descent: number,
  angleRad: number,
): { x: number; y: number } {
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const dirX = cos;
  const dirY = sin;
  const perpX = -sin;
  const perpY = cos;
  const vShift = (ascent - descent) / 2;
  return {
    x: centerX - (textWidth / 2) * dirX - vShift * perpX,
    y: centerY - (textWidth / 2) * dirY - vShift * perpY,
  };
}

/**
 * Draw the watermark onto a single page by writing it directly into the page
 * content stream (LibPDF `drawText`). Because the watermark is part of the
 * page content — not a separate annotation or optional-content layer — there
 * is no removable layer to toggle or delete.
 *
 * The placement logic is a direct port of the on-screen SVG watermark
 * (`components/view/watermark-svg.tsx`) so the download matches the preview:
 *  - Single watermarks are anchored exactly like the SVG (`textAnchor` +
 *    `dominantBaseline`) and rotated around that anchor.
 *  - Tiled watermarks reuse the SVG pattern dimensions (`length * fontSize *
 *    0.6` wide, `fontSize * 10` tall) and the same rotation pivot (page
 *    top-left) so tiling density and angle line up with the preview.
 */
export function insertWatermark(
  page: PDFPage,
  config: WatermarkConfig,
  viewerData: ViewerData,
): void {
  const width = page.width;
  const height = page.height;

  const rawWatermarkText = safeTemplateReplace(
    config.text,
    viewerData as Record<string, any>,
  );
  const watermarkText = sanitizeWatermarkText(rawWatermarkText);
  if (!watermarkText) return;

  const fontSize = calculateFontSize(config, width, height);
  const color = hexToLibColor(config.color);
  const angleRad = toRadians(config.rotation);

  let textWidth: number;
  let fullHeight: number;
  try {
    textWidth = measureFont.widthOfTextAtSize(watermarkText, fontSize);
    fullHeight = measureFont.heightAtSize(fontSize);
  } catch {
    textWidth = watermarkText.length * fontSize * 0.6;
    fullHeight = fontSize;
  }
  const ascent = fullHeight * ASCENT_RATIO;
  const descent = fullHeight * DESCENT_RATIO;

  const draw = (x: number, y: number) => {
    page.drawText(watermarkText, {
      x,
      y,
      size: fontSize,
      font: WATERMARK_FONT,
      color,
      opacity: config.opacity,
      rotate: degrees(config.rotation),
    });
  };

  if (config.isTiled) {
    // Match the SVG <pattern> dimensions so tiling density is identical to the
    // on-screen preview. The SVG estimates the text width as
    // `length * fontSize * 0.6`; reuse that estimate for spacing.
    const estimatedTextWidth = Math.max(
      watermarkText.length * fontSize * 0.6,
      fontSize,
    );
    const spacingX = estimatedTextWidth;
    const spacingY = fontSize * 10;

    // The SVG pattern is rotated around the user-space origin, i.e. the
    // top-left of the page. In PDF coordinates that is (0, height).
    const pivotX = 0;
    const pivotY = height;

    const diagonal = Math.sqrt(width * width + height * height);
    const cols = Math.ceil(diagonal / spacingX) + 2;
    const rows = Math.ceil(diagonal / spacingY) + 2;

    // Guard against pathological tile counts (very small font + long text).
    const MAX_TILES = 20000;
    let drawn = 0;
    const margin = Math.max(spacingX, spacingY);

    for (let i = -cols; i <= cols && drawn < MAX_TILES; i++) {
      for (let j = -rows; j <= rows && drawn < MAX_TILES; j++) {
        // Tile centre in the unrotated (SVG-like) space. The SVG draws the
        // text at (patternWidth/2, patternHeight/4) within each tile.
        const centerSvgX = i * spacingX + spacingX / 2;
        const centerSvgY = j * spacingY + spacingY / 4;
        // Convert from SVG (y-down, origin top-left) to PDF (y-up).
        const centerX = centerSvgX;
        const centerY = height - centerSvgY;

        const rotated = rotatePoint(centerX, centerY, pivotX, pivotY, angleRad);

        if (
          rotated.x < -margin ||
          rotated.x > width + margin ||
          rotated.y < -margin ||
          rotated.y > height + margin
        ) {
          continue;
        }

        const baseline = baselineForCenteredText(
          rotated.x,
          rotated.y,
          textWidth,
          ascent,
          descent,
          angleRad,
        );
        draw(baseline.x, baseline.y);
        drawn++;
      }
    }
    return;
  }

  // --- Single (non-tiled) watermark -----------------------------------------
  // Reproduce the SVG anchor point + alignment, then rotate around it.
  const { position } = config;

  // Anchor point in SVG coordinates (y-down, origin top-left).
  let anchorSvgX: number;
  if (position.includes("left")) {
    anchorSvgX = fontSize / 2;
  } else if (position.includes("right")) {
    anchorSvgX = width - fontSize / 2;
  } else {
    anchorSvgX = width / 2;
  }

  let anchorSvgY: number;
  if (position.includes("top")) {
    anchorSvgY = fontSize;
  } else if (position.includes("bottom")) {
    anchorSvgY = height - fontSize;
  } else {
    anchorSvgY = height / 2;
  }

  const pivotX = anchorSvgX;
  const pivotY = height - anchorSvgY; // to PDF (y-up)

  // Baseline-left of the text in the unrotated frame, honouring the SVG
  // `textAnchor` (start/middle/end) and `dominantBaseline`
  // (hanging/middle/auto).
  let baselineX: number;
  if (position.includes("left")) {
    baselineX = pivotX; // textAnchor="start"
  } else if (position.includes("right")) {
    baselineX = pivotX - textWidth; // textAnchor="end"
  } else {
    baselineX = pivotX - textWidth / 2; // textAnchor="middle"
  }

  let baselineY: number;
  if (position.includes("top")) {
    // dominantBaseline="hanging": glyph top sits at the anchor.
    baselineY = pivotY - ascent;
  } else if (position.includes("bottom")) {
    // dominantBaseline="auto": baseline sits at the anchor.
    baselineY = pivotY;
  } else {
    // dominantBaseline="middle": vertical centre sits at the anchor.
    baselineY = pivotY - (ascent - descent) / 2;
  }

  const rotated = rotatePoint(baselineX, baselineY, pivotX, pivotY, angleRad);
  draw(rotated.x, rotated.y);
}

export interface BuildWatermarkedPdfOptions {
  /** Raw bytes of the source file (PDF or image). */
  fileBytes: Uint8Array;
  /** Whether the source is a PDF or an image. */
  fileType: "pdf" | "image";
  watermarkConfig: WatermarkConfig;
  viewerData: ViewerData;
  /** Number of pages (PDF only). Images are always a single page. */
  numPages: number;
  /**
   * When true, any form / annotation / optional-content layers in the source
   * document are flattened so they can't be toggled or removed (the watermark
   * itself is already merged into the page content stream).
   */
  flatten?: boolean;
  /** Content type of the image (image inputs only, unused — kept for API compatibility). */
  imageContentType?: string;
  /** Optional progress/diagnostics hook. */
  onProgress?: (message: string) => void;
}

/**
 * Turn a PDF or image into a watermarked PDF using LibPDF.
 *
 * The watermark is drawn directly into each page's content stream (so it
 * cannot be removed as an annotation/layer) and, when `flatten` is set, any
 * existing form/annotation/optional-content layers are flattened too. This is
 * fully serverless-friendly — there is no page rasterisation.
 */
export async function buildWatermarkedPdf({
  fileBytes,
  fileType,
  watermarkConfig,
  viewerData,
  flatten = false,
  onProgress,
}: BuildWatermarkedPdfOptions): Promise<Uint8Array> {
  let pdf: PDF;
  let pages: PDFPage[];

  if (fileType === "image") {
    pdf = PDF.create();
    let image;
    try {
      image = pdf.embedImage(fileBytes);
    } catch (error) {
      throw new Error(
        `Unsupported image format for watermarking: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    // Scale large images down so the watermark font-size cap (1000pt) doesn't
    // shrink the watermark; the full-resolution image still embeds losslessly.
    const MAX_IMAGE_PAGE_DIMENSION = 1000;
    const longestSide = Math.max(image.widthInPoints, image.heightInPoints);
    const scale =
      longestSide > MAX_IMAGE_PAGE_DIMENSION
        ? MAX_IMAGE_PAGE_DIMENSION / longestSide
        : 1;
    const widthPt = image.widthInPoints * scale;
    const heightPt = image.heightInPoints * scale;
    const page = pdf.addPage({ width: widthPt, height: heightPt });
    page.drawImage(image, { x: 0, y: 0, width: widthPt, height: heightPt });
    pages = [page];
  } else {
    pdf = await PDF.load(fileBytes);
    pages = pdf.getPages();
  }

  for (let i = 0; i < pages.length; i++) {
    insertWatermark(pages[i], watermarkConfig, viewerData);
    if ((i + 1) % 25 === 0) {
      onProgress?.(`Watermarked ${i + 1}/${pages.length} pages`);
    }
  }

  if (flatten) {
    // Flatten forms, annotations, and optional-content layers so nothing can
    // be toggled/removed. Best-effort: never fail the download over this.
    try {
      pdf.flattenAll();
      onProgress?.("Flattened form/annotation/layer content");
    } catch (error) {
      onProgress?.(
        `flattenAll failed, falling back to form flatten: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      try {
        pdf.getForm()?.flatten();
      } catch {
        // No form / unsupported – ignore.
      }
    }
  }

  return await pdf.save();
}
