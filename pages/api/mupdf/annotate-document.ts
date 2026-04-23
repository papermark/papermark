import { NextApiRequest, NextApiResponse } from "next";

import { PDF, rgb } from "@libpdf/core";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  getFileNameWithPdfExtension,
  log,
  safeTemplateReplace,
} from "@/lib/utils";

// This function can run for a maximum of 300 seconds
export const config = {
  maxDuration: 300,
};

type AnnotateDocumentErrorType =
  | "Request timeout"
  | "Document too large"
  | "Failed to fetch document"
  | "Invalid request"
  | "Failed to apply watermark";

class AnnotateDocumentError extends Error {
  readonly statusCode: number;
  readonly errorType: AnnotateDocumentErrorType;

  constructor({
    message,
    statusCode,
    errorType,
  }: {
    message: string;
    statusCode: number;
    errorType: AnnotateDocumentErrorType;
  }) {
    super(message);
    this.name = "AnnotateDocumentError";
    this.statusCode = statusCode;
    this.errorType = errorType;
  }
}

const toAnnotateDocumentError = (error: unknown): AnnotateDocumentError => {
  if (error instanceof AnnotateDocumentError) {
    return error;
  }

  const message = error instanceof Error ? error.message : String(error);
  return new AnnotateDocumentError({
    message,
    statusCode: 500,
    errorType: "Failed to apply watermark",
  });
};

const NOTO_SANS_FONT_PATH = path.join(
  process.cwd(),
  "public",
  "fonts",
  "NotoSans-Regular.ttf",
);

let notoSansFontBytesPromise: Promise<Uint8Array> | null = null;

const getNotoSansFontBytes = async () => {
  if (!notoSansFontBytesPromise) {
    notoSansFontBytesPromise = readFile(NOTO_SANS_FONT_PATH)
      .then((fontBuffer) => new Uint8Array(fontBuffer))
      .catch((error) => {
        notoSansFontBytesPromise = null;
        const message = error instanceof Error ? error.message : String(error);
        throw new AnnotateDocumentError({
          message: `Failed to load Noto Sans font: ${message}`,
          statusCode: 400,
          errorType: "Invalid request",
        });
      });
  }

  return notoSansFontBytesPromise;
};

/**
 * Validates a URL to prevent SSRF attacks.
 * Only allows HTTPS requests to the configured distribution hosts.
 */
function validateUrl(urlString: string): URL {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(urlString);
  } catch {
    throw new Error("Invalid URL format");
  }

  if (parsedUrl.protocol !== "https:") {
    throw new Error("Only HTTPS URLs are allowed");
  }

  const allowedHosts = [
    process.env.NEXT_PRIVATE_UPLOAD_DISTRIBUTION_HOST,
    process.env.NEXT_PRIVATE_UPLOAD_DISTRIBUTION_HOST_US,
  ].filter((host): host is string => !!host);

  if (allowedHosts.length === 0) {
    throw new Error("No distribution hosts configured");
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  const isAllowedHost = allowedHosts.some(
    (allowedHost) => hostname === allowedHost.toLowerCase(),
  );

  if (!isAllowedHost) {
    throw new Error(
      "Host not allowed. Only requests to configured distribution hosts are permitted",
    );
  }

  return parsedUrl;
}

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
  email: string;
  date: string;
  ipAddress: string;
  link: string;
  time: string;
}

function getPositionCoordinates(
  position: WatermarkConfig["position"],
  width: number,
  height: number,
  textWidth: number,
  textHeight: number,
): [number, number] {
  const positions: Record<WatermarkConfig["position"], [number, number]> = {
    "top-left": [10, height - textHeight],
    "top-center": [(width - textWidth) / 2, height - textHeight],
    "top-right": [width - textWidth - 10, height - textHeight],
    "middle-left": [10, (height - textHeight) / 2],
    "middle-center": [(width - textWidth) / 2, (height - textHeight) / 2],
    "middle-right": [width - textWidth - 10, (height - textHeight) / 2],
    "bottom-left": [10, 20],
    "bottom-center": [(width - textWidth) / 2, 20],
    "bottom-right": [width - textWidth - 10, 20],
  };

  return positions[position];
}

function calculateResponsiveFontSize(
  pageWidth: number,
  pageHeight: number,
  configuredFontSize: number,
) {
  const baseFontSize =
    Math.min(pageWidth, pageHeight) * (configuredFontSize / 1000);
  return Math.max(8, Math.min(baseFontSize, configuredFontSize));
}

function parseHexColor(hex: string) {
  const normalized = hex.trim();
  const match = normalized.match(/^#?([0-9a-fA-F]{6})$/);

  if (!match) {
    return rgb(0, 0, 0);
  }

  const value = match[1];
  const red = parseInt(value.slice(0, 2), 16) / 255;
  const green = parseInt(value.slice(2, 4), 16) / 255;
  const blue = parseInt(value.slice(4, 6), 16) / 255;

  return rgb(red, green, blue);
}

async function createEmbeddedWatermarkPage(
  targetPdf: PDF,
  watermarkConfig: WatermarkConfig,
  watermarkText: string,
  fontBytes: Uint8Array,
  pageWidth: number,
  pageHeight: number,
) {
  const watermarkPdf = PDF.create();
  const watermarkPage = watermarkPdf.addPage({
    width: pageWidth,
    height: pageHeight,
  });

  const font = watermarkPdf.embedFont(fontBytes);
  const fontSize = calculateResponsiveFontSize(
    pageWidth,
    pageHeight,
    watermarkConfig.fontSize,
  );

  let textWidth: number;
  let textHeight: number;

  try {
    textWidth = font.widthOfTextAtSize(watermarkText, fontSize);
    textHeight = font.heightAtSize(fontSize);
  } catch {
    textWidth = watermarkText.length * fontSize * 0.6;
    textHeight = fontSize * 1.2;
  }

  const drawOptions = {
    size: fontSize,
    font,
    color: parseHexColor(watermarkConfig.color),
    opacity: Math.max(0, Math.min(watermarkConfig.opacity, 1)),
  };

  const getRotateOptions = (x: number, y: number) => ({
    angle: watermarkConfig.rotation,
    origin: {
      x: x + textWidth / 2,
      y: y + textHeight / 2,
    },
  });

  if (watermarkConfig.isTiled) {
    const safeTextWidth = Math.max(textWidth, 1);
    const safeTextHeight = Math.max(textHeight, 1);

    const patternWidth = safeTextWidth / 1.1;
    const patternHeight = safeTextHeight * 15;

    const offsetX = -patternWidth / 4;
    const offsetY = -patternHeight / 4;

    const maxTilesPerRow = Math.ceil(pageWidth / patternWidth) + 1;
    const maxTilesPerColumn = Math.ceil(pageHeight / patternHeight) + 1;

    for (let row = 0; row < maxTilesPerRow; row++) {
      for (let col = 0; col < maxTilesPerColumn; col++) {
        const x = row * patternWidth + offsetX;
        const y = col * patternHeight + offsetY;

        watermarkPage.drawText(watermarkText, {
          ...drawOptions,
          x,
          y,
          rotate: getRotateOptions(x, y),
        });
      }
    }
  } else {
    const [x, y] = getPositionCoordinates(
      watermarkConfig.position,
      pageWidth,
      pageHeight,
      textWidth,
      textHeight,
    );

    watermarkPage.drawText(watermarkText, {
      ...drawOptions,
      x,
      y,
      rotate: getRotateOptions(x, y),
    });
  }

  const serializedWatermarkPdf = await watermarkPdf.save();
  const normalizedWatermarkPdf = await PDF.load(serializedWatermarkPdf);

  return targetPdf.embedPage(normalizedWatermarkPdf, 0);
}

export const annotatePdfWithEmbeddedWatermark = async ({
  pdfBytes,
  watermarkConfig,
  viewerData,
  numPages,
  fontBytes,
}: {
  pdfBytes: Uint8Array;
  watermarkConfig: WatermarkConfig;
  viewerData: ViewerData;
  numPages: number;
  fontBytes?: Uint8Array;
}) => {
  const loadStart = Date.now();
  const pdfDoc = await PDF.load(pdfBytes);
  console.log(`PDF load took ${Date.now() - loadStart}ms`);

  const sourcePageCount = pdfDoc.getPageCount();
  if (numPages > sourcePageCount) {
    throw new AnnotateDocumentError({
      message: `Invalid page count: requested ${numPages}, document has ${sourcePageCount}`,
      statusCode: 400,
      errorType: "Invalid request",
    });
  }

  const pagesToProcess = Math.min(numPages, sourcePageCount);

  const fontLoadStart = Date.now();
  const notoSansFontBytes = fontBytes ?? (await getNotoSansFontBytes());
  console.log(`Noto Sans load took ${Date.now() - fontLoadStart}ms`);

  const rawWatermarkText = safeTemplateReplace(
    watermarkConfig.text,
    viewerData,
  );
  const watermarkText = rawWatermarkText;
  if (!watermarkText.trim()) {
    throw new AnnotateDocumentError({
      message: "Watermark text is empty",
      statusCode: 400,
      errorType: "Invalid request",
    });
  }

  const embeddedWatermarksBySize = new Map<
    string,
    ReturnType<typeof createEmbeddedWatermarkPage>
  >();

  const getEmbeddedWatermarkForSize = (
    pageWidth: number,
    pageHeight: number,
  ) => {
    const sizeKey = `${pageWidth}x${pageHeight}`;

    if (!embeddedWatermarksBySize.has(sizeKey)) {
      embeddedWatermarksBySize.set(
        sizeKey,
        createEmbeddedWatermarkPage(
          pdfDoc,
          watermarkConfig,
          watermarkText,
          notoSansFontBytes,
          pageWidth,
          pageHeight,
        ),
      );
    }

    return embeddedWatermarksBySize.get(sizeKey)!;
  };

  const watermarkStart = Date.now();
  console.log(
    `Watermarking ${pagesToProcess} pages using embedded XObject templates`,
  );

  for (let pageIndex = 0; pageIndex < pagesToProcess; pageIndex++) {
    const page = pdfDoc.getPage(pageIndex);
    if (!page) {
      throw new Error(`Failed to load page ${pageIndex + 1}`);
    }

    const embeddedWatermark = await getEmbeddedWatermarkForSize(
      page.width,
      page.height,
    );

    page.drawPage(embeddedWatermark, {
      x: 0,
      y: 0,
      width: page.width,
      height: page.height,
    });

    if ((pageIndex + 1) % 25 === 0 || pageIndex === pagesToProcess - 1) {
      const progress = (((pageIndex + 1) / pagesToProcess) * 100).toFixed(1);
      console.log(
        `Processed ${pageIndex + 1}/${pagesToProcess} pages (${progress}%)`,
      );
    }
  }

  console.log(`All watermarking took ${Date.now() - watermarkStart}ms`);

  const saveStart = Date.now();
  const annotatedPdf = await pdfDoc.save();
  const finalSizeMB = annotatedPdf.length / 1024 / 1024;
  console.log(
    `PDF save took ${Date.now() - saveStart}ms, final size: ${finalSizeMB.toFixed(2)}MB`,
  );

  return annotatedPdf;
};

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  const authHeader = req.headers.authorization;
  const token = authHeader?.split(" ")[1];

  if (token !== process.env.INTERNAL_API_KEY) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  const { url, watermarkConfig, viewerData, numPages, originalFileName } =
    req.body as {
      url: string;
      watermarkConfig: WatermarkConfig;
      viewerData: ViewerData;
      numPages: number;
      originalFileName?: string;
    };

  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "Invalid or missing URL" });
  }

  if (!watermarkConfig || typeof watermarkConfig !== "object") {
    return res
      .status(400)
      .json({ error: "Invalid or missing watermark config" });
  }

  if (!numPages || typeof numPages !== "number" || numPages <= 0) {
    return res.status(400).json({ error: "Invalid page count" });
  }

  if (numPages > 1000) {
    return res.status(400).json({
      error: "Document too large",
      details: "Maximum 1000 pages supported",
    });
  }

  const startTime = Date.now();

  let validatedUrl: URL;
  try {
    validatedUrl = validateUrl(url);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log({
      message: `URL validation failed: ${errorMsg}\nAttempted URL: ${url}`,
      type: "error",
      mention: false,
    });
    return res.status(400).json({
      error: "Invalid URL",
      details: errorMsg,
    });
  }

  try {
    let response: Response;
    try {
      const fetchStart = Date.now();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000);

      response = await fetch(validatedUrl.toString(), {
        signal: controller.signal,
        headers: {
          Accept: "application/pdf",
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new AnnotateDocumentError({
          message: `HTTP ${response.status}: ${response.statusText}`,
          statusCode: 502,
          errorType: "Failed to fetch document",
        });
      }

      console.log(`PDF fetch took ${Date.now() - fetchStart}ms`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log({
        message: `Failed to fetch PDF in conversion process with error: \n\n Error: ${errorMsg}\nURL: ${url}`,
        type: "error",
        mention: true,
      });

      if (errorMsg.includes("aborted")) {
        throw new AnnotateDocumentError({
          message: "Timeout fetching PDF (exceeded 60s)",
          statusCode: 504,
          errorType: "Request timeout",
        });
      }

      throw new AnnotateDocumentError({
        message: `Failed to fetch PDF: ${errorMsg}`,
        statusCode: 502,
        errorType: "Failed to fetch document",
      });
    }

    const bufferStart = Date.now();
    const pdfBuffer = await response.arrayBuffer();
    const sizeInMB = pdfBuffer.byteLength / 1024 / 1024;
    console.log(
      `Buffer conversion took ${Date.now() - bufferStart}ms, size: ${sizeInMB.toFixed(2)}MB`,
    );

    const annotatedPdf = await annotatePdfWithEmbeddedWatermark({
      pdfBytes: new Uint8Array(pdfBuffer),
      watermarkConfig,
      viewerData,
      numPages,
    });
    const pagesToProcess = numPages;

    console.log(
      `Total processing time: ${Date.now() - startTime}ms for ${pagesToProcess} pages`,
    );

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(getFileNameWithPdfExtension(originalFileName))}"`,
    );

    res.status(200).send(Buffer.from(annotatedPdf));
    return;
  } catch (error) {
    const annotateError = toAnnotateDocumentError(error);
    const elapsedTime = Date.now() - startTime;

    log({
      message: `${annotateError.errorType} after ${elapsedTime}ms: ${annotateError.message}\n\nDocument: ${originalFileName || "unknown"}\nPages: ${numPages}\nURL: ${url?.substring(0, 100)}...`,
      type: "error",
      mention: elapsedTime > 120000,
    });

    res.status(annotateError.statusCode).json({
      error: annotateError.errorType,
      details: annotateError.message,
      processingTime: elapsedTime,
    });
    return;
  }
};

export default handler;
