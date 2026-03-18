import { NextApiRequest, NextApiResponse } from "next";

import { DocumentPage } from "@prisma/client";
import { get } from "@vercel/edge-config";
import { waitUntil } from "@vercel/functions";
import * as mupdf from "mupdf";

import { putFileServer } from "@/lib/files/put-file-server";
import prisma from "@/lib/prisma";
import { log } from "@/lib/utils";

// This function can run for a maximum of 120 seconds
export const config = {
  maxDuration: 180,
};

export default async (req: NextApiRequest, res: NextApiResponse) => {
  // check if post method
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  // Extract the API Key from the Authorization header
  const authHeader = req.headers.authorization;
  const token = authHeader?.split(" ")[1]; // Assuming the format is "Bearer [token]"

  // Check if the API Key matches
  if (token !== process.env.INTERNAL_API_KEY) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  const { documentVersionId, pageNumber, url, teamId, trustedTeam } =
    req.body as {
      documentVersionId: string;
      pageNumber: number;
      url: string;
      teamId: string;
      trustedTeam?: boolean;
    };

  try {
    // Fetch the PDF data with a 120s timeout to avoid indefinite hangs on slow storage
    let response: Response;
    try {
      response = await fetch(url, {
        signal: AbortSignal.timeout(120_000),
      });
    } catch (error) {
      log({
        message: `Failed to fetch PDF in conversion process with error: \n\n Error: ${error} \n\n \`Metadata: {teamId: ${teamId}, documentVersionId: ${documentVersionId}, pageNumber: ${pageNumber}}\``,
        type: "error",
        mention: true,
      });
      throw new Error(`Failed to fetch pdf on document page ${pageNumber}`);
    }

    // Convert the response to a buffer
    const pdfData = await response.arrayBuffer();
    // Create a MuPDF instance
    var doc = new mupdf.PDFDocument(pdfData);
    console.log("Original document size:", pdfData.byteLength);

    const page = doc.loadPage(pageNumber - 1); // 0-based page index
    // get the bounds of the page for orientation and scaling
    const bounds = page.getBounds();
    const [ulx, uly, lrx, lry] = bounds;
    const widthInPoints = Math.abs(lrx - ulx);
    const heightInPoints = Math.abs(lry - uly);

    // Validate document dimensions
    if (widthInPoints <= 0 || heightInPoints <= 0) {
      throw new Error(
        `Invalid page dimensions: ${widthInPoints} × ${heightInPoints} points`,
      );
    }

    // Log original dimensions for debugging
    console.log(
      `Original page dimensions: ${widthInPoints} × ${heightInPoints} points (${(widthInPoints / 72).toFixed(1)}" × ${(heightInPoints / 72).toFixed(1)}")`,
    );

    if (pageNumber === 1) {
      // get the orientation of the document and update document version
      const isVertical = heightInPoints > widthInPoints;

      await prisma.documentVersion.update({
        where: { id: documentVersionId },
        data: { isVertical },
      });
    }

    // Calculate optimal scale factor based on document dimensions and memory constraints
    const getOptimalScaleFactor = (width: number, height: number): number => {
      // Maximum reasonable pixel dimensions to prevent memory issues
      const MAX_PIXEL_DIMENSION = 8000;
      const MAX_TOTAL_PIXELS = 32_000_000; // ~32MP to stay within memory limits

      // Start with default scaling logic
      // Note: Avoid scale factor 3 exactly due to mupdf 1.26.4 rendering bug with tiling patterns
      let scaleFactor = width >= 1600 ? 2 : 2.95;

      // Check if scaled dimensions would exceed limits
      const scaledWidth = width * scaleFactor;
      const scaledHeight = height * scaleFactor;
      const totalPixels = scaledWidth * scaledHeight;

      // Reduce scale factor if dimensions are too large
      if (
        scaledWidth > MAX_PIXEL_DIMENSION ||
        scaledHeight > MAX_PIXEL_DIMENSION ||
        totalPixels > MAX_TOTAL_PIXELS
      ) {
        // Calculate maximum safe scale factor
        const maxScaleByWidth = MAX_PIXEL_DIMENSION / width;
        const maxScaleByHeight = MAX_PIXEL_DIMENSION / height;
        const maxScaleByTotal = Math.sqrt(MAX_TOTAL_PIXELS / (width * height));

        scaleFactor = Math.min(
          maxScaleByWidth,
          maxScaleByHeight,
          maxScaleByTotal,
        );

        // Ensure minimum scale factor of 1
        scaleFactor = Math.max(1, Math.floor(scaleFactor * 10) / 10); // Round down to 1 decimal

        console.log(
          `Large document detected. Reduced scale factor from ${width >= 1600 ? 2 : 2.95} to ${scaleFactor}`,
        );
      }

      return scaleFactor;
    };

    const scaleFactor = getOptimalScaleFactor(widthInPoints, heightInPoints);
    const doc_to_screen = mupdf.Matrix.scale(scaleFactor, scaleFactor);

    console.log("Scale factor:", scaleFactor);
    console.log(
      "Final dimensions:",
      `${widthInPoints * scaleFactor} × ${heightInPoints * scaleFactor}`,
    );

    // get links
    const links = page.getLinks();
    const embeddedLinks = links.map((link) => {
      const coords = link.getBounds().join(",");

      // Check if this is an internal link (GoTo action for TOC, etc.)
      if (!link.isExternal()) {
        try {
          // Resolve internal link to page number (0-indexed from mupdf)
          const targetPage = doc.resolveLink(link);
          if (targetPage >= 0) {
            return {
              href: `#page=${targetPage + 1}`, // Convert to 1-indexed for frontend
              coords,
              isInternal: true,
              targetPage: targetPage + 1,
            };
          }
        } catch (e) {
          console.log("Failed to resolve internal link:", e);
        }
        // Fallback for unresolvable internal links
        return { href: "", coords, isInternal: true };
      }

      // External URI link
      return { href: link.getURI(), coords, isInternal: false };
    });

    // Check embedded links for blocked keywords (skip for trusted teams)
    if (embeddedLinks.length > 0 && !trustedTeam) {
      try {
        const keywords = await get("keywords");
        if (Array.isArray(keywords) && keywords.length > 0) {
          for (const link of embeddedLinks) {
            if (link.href) {
              const matchedKeyword = keywords.find(
                (keyword) =>
                  typeof keyword === "string" &&
                  link.href.toLowerCase().includes(keyword.toLowerCase()),
              );

              if (matchedKeyword) {
                waitUntil(
                  log({
                    message: `Document processing blocked: ${matchedKeyword} \n\n \`Metadata: {teamId: ${teamId}, documentVersionId: ${documentVersionId}, pageNumber: ${pageNumber}}\``,
                    type: "error",
                    mention: true,
                  }),
                );
                res.status(400).json({
                  error: "Document processing blocked",
                  matchedUrl: link.href,
                  matchedKeyword: matchedKeyword,
                  pageNumber: pageNumber,
                });
                return;
              }
            }
          }
        }
      } catch (error) {
        // Log error but continue processing if check fails
        console.log("Failed to check keywords:", error);
      }
    }

    // Will be updated if we use a reduced scale factor
    let actualScaleFactor = scaleFactor;

    const metadata = {
      originalWidth: widthInPoints,
      originalHeight: heightInPoints,
      width: widthInPoints * actualScaleFactor,
      height: heightInPoints * actualScaleFactor,
      scaleFactor: actualScaleFactor,
    };

    // Estimate memory usage before creating pixmap
    const finalWidth = Math.floor(widthInPoints * scaleFactor);
    const finalHeight = Math.floor(heightInPoints * scaleFactor);
    const estimatedMemoryMB = (finalWidth * finalHeight * 3) / (1024 * 1024); // RGB = 3 bytes per pixel

    console.log(
      `Estimated memory usage: ${estimatedMemoryMB.toFixed(1)}MB for ${finalWidth} × ${finalHeight} pixels`,
    );

    // Warn if memory usage is high
    if (estimatedMemoryMB > 200) {
      console.warn(
        `High memory usage expected: ${estimatedMemoryMB.toFixed(1)}MB. Consider reducing document size.`,
      );
    }

    console.time("toPixmap");
    let scaledPixmap;
    try {
      scaledPixmap = page.toPixmap(
        doc_to_screen,
        mupdf.ColorSpace.DeviceRGB,
        false,
        true,
      );
    } catch (error) {
      // If pixmap creation fails, try with a smaller scale factor
      console.error(
        "Pixmap creation failed, attempting with reduced scale factor:",
        error,
      );
      const reducedScaleFactor = Math.max(1, scaleFactor * 0.5);
      console.log(`Retrying with reduced scale factor: ${reducedScaleFactor}`);

      const reduced_doc_to_screen = mupdf.Matrix.scale(
        reducedScaleFactor,
        reducedScaleFactor,
      );
      scaledPixmap = page.toPixmap(
        reduced_doc_to_screen,
        mupdf.ColorSpace.DeviceRGB,
        false,
        true,
      );

      // Update metadata with actual scale factor used
      actualScaleFactor = reducedScaleFactor;
      metadata.width = widthInPoints * actualScaleFactor;
      metadata.height = heightInPoints * actualScaleFactor;
      metadata.scaleFactor = actualScaleFactor;
      console.log(
        "Successfully created pixmap with reduced scale factor:",
        actualScaleFactor,
      );
    }
    console.timeEnd("toPixmap");

    console.time("compare");
    console.time("asPNG");
    const pngBuffer = scaledPixmap.asPNG(); // as PNG
    console.timeEnd("asPNG");
    console.time("asJPEG");
    const jpegBuffer = scaledPixmap.asJPEG(80, false); // as JPEG
    console.timeEnd("asJPEG");

    const pngSize = pngBuffer.byteLength;
    const jpegSize = jpegBuffer.byteLength;

    let chosenBuffer;
    let chosenFormat;
    if (pngSize < jpegSize) {
      chosenBuffer = pngBuffer;
      chosenFormat = "png";
    } else {
      chosenBuffer = jpegBuffer;
      chosenFormat = "jpeg";
    }

    console.log("Chosen format:", chosenFormat);

    console.timeEnd("compare");

    let buffer = Buffer.from(chosenBuffer);

    // get docId from url with starts with "doc_" with regex
    const match = url.match(/(doc_[^\/]+)\//);
    const docId = match ? match[1] : undefined;

    const { type, data } = await putFileServer({
      file: {
        name: `page-${pageNumber}.${chosenFormat}`,
        type: `image/${chosenFormat}`,
        buffer: buffer,
      },
      teamId: teamId,
      docId: docId,
    });

    buffer = Buffer.alloc(0); // free memory
    chosenBuffer = Buffer.alloc(0); // free memory
    scaledPixmap.destroy(); // free memory
    page.destroy(); // free memory

    if (!data || !type) {
      throw new Error(`Failed to upload document page ${pageNumber}`);
    }

    let documentPage: DocumentPage | null = null;

    // Check if a documentPage with the same pageNumber and versionId already exists
    const existingPage = await prisma.documentPage.findUnique({
      where: {
        pageNumber_versionId: {
          pageNumber: pageNumber,
          versionId: documentVersionId,
        },
      },
    });

    if (!existingPage) {
      // Only create a new documentPage if it doesn't already exist
      documentPage = await prisma.documentPage.create({
        data: {
          versionId: documentVersionId,
          pageNumber: pageNumber,
          file: data,
          storageType: type,
          pageLinks: embeddedLinks,
          metadata: metadata,
        },
      });
    } else {
      documentPage = existingPage;
    }

    // Send the images as a response
    res.status(200).json({ documentPageId: documentPage.id });
    return;
  } catch (error) {
    log({
      message: `Failed to convert page with error: \n\n Error: ${error} \n\n \`Metadata: {teamId: ${teamId}, documentVersionId: ${documentVersionId}, pageNumber: ${pageNumber}}\``,
      type: "error",
      mention: true,
    });
    throw error;
  }
};
