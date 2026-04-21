import { AbortTaskRunError, logger, metadata, task } from "@trigger.dev/sdk";
import { get } from "@vercel/edge-config";
import { putFileServer } from "@/lib/files/put-file-server";
import prisma from "@/lib/prisma";
import { log } from "@/lib/utils";
import {
  extractAnnotatedPdfLinks,
  mergePdfEmbeddedLinks,
} from "@/ee/features/conversions/pdf/extract-pdf-widget-links";

type ConvertPdfDirectPayload = {
  documentVersionId: string;
  teamId: string;
  documentId: string;
  signedUrl: string;
  trustedTeam: boolean;
  versionNumber?: number;
};

function setProgress(status: { progress: number; text: string }) {
  metadata.set("status", status);
  try {
    metadata.parent.set("status", status);
  } catch {
    // no parent task
  }
}

function getOptimalScaleFactor(width: number, height: number): number {
  const MAX_PIXEL_DIMENSION = 8000;
  const MAX_TOTAL_PIXELS = 32_000_000;

  // Avoid scale factor 3 exactly due to mupdf 1.26.4 rendering bug with tiling patterns
  let scaleFactor = width >= 1600 ? 2 : 2.95;

  const scaledWidth = width * scaleFactor;
  const scaledHeight = height * scaleFactor;
  const totalPixels = scaledWidth * scaledHeight;

  if (
    scaledWidth > MAX_PIXEL_DIMENSION ||
    scaledHeight > MAX_PIXEL_DIMENSION ||
    totalPixels > MAX_TOTAL_PIXELS
  ) {
    const maxScaleByWidth = MAX_PIXEL_DIMENSION / width;
    const maxScaleByHeight = MAX_PIXEL_DIMENSION / height;
    const maxScaleByTotal = Math.sqrt(MAX_TOTAL_PIXELS / (width * height));
    scaleFactor = Math.min(maxScaleByWidth, maxScaleByHeight, maxScaleByTotal);
    scaleFactor = Math.max(1, Math.floor(scaleFactor * 10) / 10);
  }

  return scaleFactor;
}

export const convertPdfDirectTask = task({
  id: "convert-pdf-direct",
  machine: { preset: "large-1x" },
  retry: { maxAttempts: 2 },
  run: async (payload: ConvertPdfDirectPayload) => {
    const mupdf = await import("mupdf");

    const {
      documentVersionId,
      teamId,
      documentId,
      signedUrl,
      trustedTeam,
      versionNumber,
    } = payload;

    setProgress({ progress: 5, text: "Downloading document..." });
    logger.info("Starting direct PDF conversion", {
      documentVersionId,
      teamId,
    });

    // Download the PDF once
    let response: Response;
    try {
      response = await fetch(signedUrl);
    } catch (error) {
      log({
        message: `Failed to fetch PDF for direct conversion: ${error}\n\n\`Metadata: {teamId: ${teamId}, documentVersionId: ${documentVersionId}}\``,
        type: "error",
        mention: true,
      });
      throw new AbortTaskRunError("Failed to fetch PDF");
    }

    if (!response.ok) {
      throw new AbortTaskRunError(
        `Failed to fetch PDF: HTTP ${response.status}`,
      );
    }

    let pdfData: ArrayBuffer | null = await response.arrayBuffer();
    const fileSizeMB = pdfData.byteLength / (1024 * 1024);
    logger.info("PDF downloaded", { sizeMB: fileSizeMB.toFixed(1) });

    setProgress({ progress: 15, text: "Loading document..." });

    const doc = new mupdf.PDFDocument(pdfData);
    // Release JS ArrayBuffer — mupdf has its own copy in WASM heap
    pdfData = null;

    const numPages = doc.countPages();
    logger.info("Document loaded", { numPages });

    // Load blocked keywords once
    let blockedKeywords: string[] = [];
    if (!trustedTeam) {
      try {
        const keywords = await get("keywords");
        if (Array.isArray(keywords)) {
          blockedKeywords = keywords.filter(
            (k): k is string => typeof k === "string",
          );
        }
      } catch (error) {
        logger.warn("Failed to load blocked keywords", { error });
      }
    }

    setProgress({ progress: 20, text: "Converting pages..." });

    const docIdMatch = signedUrl.match(/(doc_[^\/]+)\//);
    const docId = docIdMatch ? docIdMatch[1] : undefined;

    let conversionError: string | null = null;

    for (let i = 0; i < numPages; i++) {
      const pageNumber = i + 1;

      try {
        const page = doc.loadPage(i);
        const bounds = page.getBounds();
        const [ulx, uly, lrx, lry] = bounds;
        const widthInPoints = Math.abs(lrx - ulx);
        const heightInPoints = Math.abs(lry - uly);

        if (widthInPoints <= 0 || heightInPoints <= 0) {
          throw new Error(
            `Invalid page dimensions: ${widthInPoints} × ${heightInPoints}`,
          );
        }

        if (pageNumber === 1) {
          await prisma.documentVersion.update({
            where: { id: documentVersionId },
            data: { isVertical: heightInPoints > widthInPoints },
          });
        }

        const scaleFactor = getOptimalScaleFactor(widthInPoints, heightInPoints);
        const doc_to_screen = mupdf.Matrix.scale(scaleFactor, scaleFactor);

        // Extract links
        const links = page.getLinks();
        let embeddedLinks = links.map((link) => {
          const coords = link.getBounds().join(",");

          if (!link.isExternal()) {
            try {
              const targetPage = doc.resolveLink(link);
              if (targetPage >= 0) {
                return {
                  href: `#page=${targetPage + 1}`,
                  coords,
                  isInternal: true,
                  targetPage: targetPage + 1,
                };
              }
            } catch {
              // skip unresolvable internal links
            }
            return { href: "", coords, isInternal: true };
          }

          return { href: link.getURI(), coords, isInternal: false };
        });

        if (page.isPDF()) {
          embeddedLinks = mergePdfEmbeddedLinks(
            embeddedLinks,
            extractAnnotatedPdfLinks(doc, page),
          );
        }

        // Check for blocked keywords in links
        if (embeddedLinks.length > 0 && blockedKeywords.length > 0) {
          for (const link of embeddedLinks) {
            if (link.href) {
              const matched = blockedKeywords.find((kw) =>
                link.href.toLowerCase().includes(kw.toLowerCase()),
              );
              if (matched) {
                log({
                  message: `Document processing blocked: ${matched}\n\n\`Metadata: {teamId: ${teamId}, documentVersionId: ${documentVersionId}, pageNumber: ${pageNumber}}\``,
                  type: "error",
                  mention: true,
                });
                doc.destroy();
                throw new AbortTaskRunError("Document processing blocked");
              }
            }
          }
        }

        // Render page to pixmap
        let actualScaleFactor = scaleFactor;
        let scaledPixmap;
        try {
          scaledPixmap = page.toPixmap(
            doc_to_screen,
            mupdf.ColorSpace.DeviceRGB,
            false,
            true,
          );
        } catch (error) {
          const reduced = Math.max(1, scaleFactor * 0.5);
          logger.warn(`Pixmap failed at scale ${scaleFactor}, retrying at ${reduced}`, {
            pageNumber,
            error: String(error),
          });
          const reduced_matrix = mupdf.Matrix.scale(reduced, reduced);
          scaledPixmap = page.toPixmap(
            reduced_matrix,
            mupdf.ColorSpace.DeviceRGB,
            false,
            true,
          );
          actualScaleFactor = reduced;
        }

        const pageMetadata = {
          originalWidth: widthInPoints,
          originalHeight: heightInPoints,
          width: widthInPoints * actualScaleFactor,
          height: heightInPoints * actualScaleFactor,
          scaleFactor: actualScaleFactor,
        };

        // Pick smaller of PNG vs JPEG
        const pngBuffer = scaledPixmap.asPNG();
        const jpegBuffer = scaledPixmap.asJPEG(80, false);
        const [chosenBuffer, chosenFormat] =
          pngBuffer.byteLength < jpegBuffer.byteLength
            ? [pngBuffer, "png" as const]
            : [jpegBuffer, "jpeg" as const];

        const buffer = Buffer.from(chosenBuffer);

        // Free rendering resources before upload
        scaledPixmap.destroy();
        page.destroy();

        // Upload the page image
        const { type, data } = await putFileServer({
          file: {
            name: `page-${pageNumber}.${chosenFormat}`,
            type: `image/${chosenFormat}`,
            buffer,
          },
          teamId,
          docId,
        });

        if (!type || !data) {
          throw new Error(`Failed to upload page ${pageNumber}`);
        }

        // Create document page record (skip if already exists)
        const existingPage = await prisma.documentPage.findUnique({
          where: {
            pageNumber_versionId: {
              pageNumber,
              versionId: documentVersionId,
            },
          },
        });

        if (!existingPage) {
          await prisma.documentPage.create({
            data: {
              versionId: documentVersionId,
              pageNumber,
              file: data,
              storageType: type,
              pageLinks: embeddedLinks,
              metadata: pageMetadata,
            },
          });
        }

        logger.info(`Page ${pageNumber}/${numPages} converted`);
      } catch (error) {
        if (error instanceof AbortTaskRunError) throw error;

        conversionError = `Failed page ${pageNumber}: ${error instanceof Error ? error.message : String(error)}`;
        logger.error(conversionError, { pageNumber });
        log({
          message: `Failed to convert page (direct): \n\n Error: ${conversionError} \n\n \`Metadata: {teamId: ${teamId}, documentVersionId: ${documentVersionId}, pageNumber: ${pageNumber}}\``,
          type: "error",
          mention: true,
        });
        break;
      }

      setProgress({
        progress: 20 + (pageNumber / numPages) * 70,
        text: `${pageNumber} / ${numPages} pages processed`,
      });
    }

    // Cleanup mupdf document
    doc.destroy();

    if (conversionError) {
      throw new AbortTaskRunError(conversionError);
    }

    // Update document version
    setProgress({ progress: 90, text: "Enabling pages..." });

    await prisma.documentVersion.update({
      where: { id: documentVersionId },
      data: { numPages, hasPages: true, isPrimary: true },
    });

    if (versionNumber) {
      await prisma.documentVersion.updateMany({
        where: {
          documentId,
          versionNumber: { not: versionNumber },
        },
        data: { isPrimary: false },
      });
    }

    setProgress({ progress: 95, text: "Revalidating..." });

    await fetch(
      `${process.env.NEXTAUTH_URL}/api/revalidate?secret=${process.env.REVALIDATE_TOKEN}&documentId=${documentId}`,
    );

    setProgress({ progress: 100, text: "Processing complete" });
    logger.info("Direct PDF conversion complete", { numPages });

    return {
      success: true,
      message: "Successfully converted PDF to images",
      totalPages: numPages,
    };
  },
});
