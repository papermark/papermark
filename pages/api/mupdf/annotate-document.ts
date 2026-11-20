import { NextApiRequest, NextApiResponse } from "next";

import { getFileNameWithPdfExtension, log } from "@/lib/utils";
import {
  type ViewerData,
  type WatermarkConfig,
  buildWatermarkedPdf,
} from "@/lib/utils/watermark-pdf";

// This function can run for a maximum of 300 seconds
export const config = {
  maxDuration: 300,
};

/**
 * Validates a URL to prevent SSRF attacks.
 * Only allows HTTPS requests to the configured distribution hosts.
 */
function validateUrl(urlString: string): URL {
  let parsedUrl: URL;

  // Parse the URL
  try {
    parsedUrl = new URL(urlString);
  } catch (error) {
    throw new Error("Invalid URL format");
  }

  // Validate protocol - only HTTPS allowed
  if (parsedUrl.protocol !== "https:") {
    throw new Error("Only HTTPS URLs are allowed");
  }

  // Get allowed distribution hosts from environment
  const allowedHosts = [
    process.env.NEXT_PRIVATE_UPLOAD_DISTRIBUTION_HOST,
    process.env.NEXT_PRIVATE_UPLOAD_DISTRIBUTION_HOST_US,
  ].filter((host): host is string => !!host);

  if (allowedHosts.length === 0) {
    throw new Error("No distribution hosts configured");
  }

  // Validate hostname against allow-list
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

  const {
    url,
    watermarkConfig,
    viewerData,
    numPages,
    originalFileName,
    fileType = "pdf",
    flatten = false,
  } = req.body as {
    url: string;
    watermarkConfig: WatermarkConfig;
    viewerData: ViewerData;
    numPages: number;
    originalFileName?: string;
    fileType?: "pdf" | "image";
    flatten?: boolean;
  };

  // Validate required fields
  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "Invalid or missing URL" });
  }

  if (!watermarkConfig || typeof watermarkConfig !== "object") {
    return res
      .status(400)
      .json({ error: "Invalid or missing watermark config" });
  }

  if (fileType !== "image" && fileType !== "pdf") {
    return res.status(400).json({ error: "Invalid file type" });
  }

  // Images are always a single page; PDFs need a valid page count.
  const effectiveNumPages = fileType === "image" ? 1 : numPages;

  if (fileType === "pdf") {
    if (
      !effectiveNumPages ||
      typeof effectiveNumPages !== "number" ||
      effectiveNumPages <= 0
    ) {
      return res.status(400).json({ error: "Invalid page count" });
    }

    if (effectiveNumPages > 1000) {
      return res.status(400).json({
        error: "Document too large",
        details: "Maximum 1000 pages supported",
      });
    }
  }

  const startTime = Date.now();

  // Validate URL to prevent SSRF attacks
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
    // Fetch the source file (PDF or image) with timeout
    let response: Response;
    try {
      const fetchStart = Date.now();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 second timeout for fetch

      // Use the validated URL string for the fetch
      response = await fetch(validatedUrl.toString(), {
        signal: controller.signal,
        headers: {
          Accept: fileType === "image" ? "image/*" : "application/pdf",
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      console.log(`Source fetch took ${Date.now() - fetchStart}ms`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log({
        message: `Failed to fetch source file in watermarking process with error: \n\n Error: ${errorMsg}\nURL: ${url}`,
        type: "error",
        mention: true,
      });

      if (errorMsg.includes("aborted")) {
        throw new Error(`Timeout fetching file (exceeded 60s)`);
      }
      throw new Error(`Failed to fetch file: ${errorMsg}`);
    }

    const contentType =
      response.headers.get("content-type") ?? undefined;

    // Convert the response to a buffer
    const bufferStart = Date.now();
    const fileBuffer = await response.arrayBuffer();
    const sizeInMB = fileBuffer.byteLength / 1024 / 1024;
    console.log(
      `Buffer conversion took ${Date.now() - bufferStart}ms, size: ${sizeInMB.toFixed(2)}MB`,
    );

    const pdfBytes = await buildWatermarkedPdf({
      fileBytes: new Uint8Array(fileBuffer),
      fileType,
      watermarkConfig,
      viewerData,
      numPages: effectiveNumPages,
      flatten,
      imageContentType: contentType,
      onProgress: (message) => console.log(message),
    });

    console.log(
      `Total processing time: ${Date.now() - startTime}ms for ${effectiveNumPages} page(s)${flatten ? " (flattened)" : ""}`,
    );

    // Set appropriate headers
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(getFileNameWithPdfExtension(originalFileName))}"`,
    );

    res.status(200).send(Buffer.from(pdfBytes));

    return;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const elapsedTime = Date.now() - startTime;

    // Determine appropriate status code based on error type
    let statusCode = 500;
    let errorType = "Failed to apply watermark";

    if (errorMessage.includes("Timeout") || errorMessage.includes("timeout")) {
      statusCode = 504;
      errorType = "Request timeout";
    } else if (
      errorMessage.includes("too large") ||
      errorMessage.includes("Maximum")
    ) {
      statusCode = 413;
      errorType = "Document too large";
    } else if (
      errorMessage.includes("fetch") ||
      errorMessage.includes("HTTP")
    ) {
      statusCode = 502;
      errorType = "Failed to fetch document";
    } else if (errorMessage.includes("Unsupported image format")) {
      statusCode = 415;
      errorType = "Unsupported image format";
    } else if (errorMessage.includes("Failed to apply watermark")) {
      statusCode = 500;
      errorType = "Watermarking error";
    }

    log({
      message: `${errorType} after ${elapsedTime}ms: ${errorMessage}\n\nDocument: ${originalFileName || "unknown"}\nPages: ${effectiveNumPages}\nURL: ${url?.substring(0, 100)}...`,
      type: "error",
      mention: elapsedTime > 120000, // Only mention if it took more than 2 minutes
    });

    // Return proper error response
    res.status(statusCode).json({
      error: errorType,
      details: errorMessage,
      processingTime: elapsedTime,
    });
    return;
  }
};
