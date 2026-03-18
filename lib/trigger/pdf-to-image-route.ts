import { AbortTaskRunError, logger, task } from "@trigger.dev/sdk/v3";

import { isTrustedTeam } from "@/lib/edge-config/trusted-teams";
import { getFile } from "@/lib/files/get-file";
import prisma from "@/lib/prisma";
import { updateStatus } from "@/lib/utils/generate-trigger-status";

type ConvertPdfToImagePayload = {
  documentId: string;
  documentVersionId: string;
  teamId: string;
  versionNumber?: number;
};

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 5_000;
const CONVERT_PAGE_TIMEOUT_MS = 240_000; // 4 min (endpoint maxDuration is 180s)
const GET_PAGES_TIMEOUT_MS = 120_000; // 2 min

function isTransientError(error: unknown): boolean {
  if (error instanceof AbortTaskRunError) return false;
  if (error instanceof DOMException && error.name === "AbortError") return false;

  const message = error instanceof Error ? error.message : String(error);
  const causeStr =
    error instanceof Error && error.cause ? String(error.cause) : "";

  return (
    message.includes("fetch failed") ||
    message.includes("HeadersTimeoutError") ||
    message.includes("ECONNRESET") ||
    message.includes("ECONNREFUSED") ||
    message.includes("ETIMEDOUT") ||
    causeStr.includes("HeadersTimeoutError") ||
    causeStr.includes("TimeoutError") ||
    causeStr.includes("ECONNRESET")
  );
}

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  {
    maxRetries = MAX_RETRIES,
    baseDelayMs = RETRY_BASE_DELAY_MS,
    timeoutMs,
    label = "fetch",
  }: {
    maxRetries?: number;
    baseDelayMs?: number;
    timeoutMs?: number;
    label?: string;
  } = {},
): Promise<Response> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const fetchOptions: RequestInit = { ...options };
      if (timeoutMs) {
        fetchOptions.signal = AbortSignal.timeout(timeoutMs);
      }

      const response = await fetch(url, fetchOptions);

      if (response.ok || response.status < 500) {
        return response;
      }

      if (attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt - 1);
        logger.warn(`${label}: server error (${response.status}), retrying`, {
          attempt,
          maxRetries,
          delayMs: delay,
        });
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      return response;
    } catch (error) {
      if (error instanceof AbortTaskRunError) throw error;

      if (attempt < maxRetries && isTransientError(error)) {
        const delay = baseDelayMs * Math.pow(2, attempt - 1);
        logger.warn(`${label}: transient error, retrying`, {
          attempt,
          maxRetries,
          delayMs: delay,
          error: error instanceof Error ? error.message : String(error),
          cause:
            error instanceof Error && error.cause
              ? String(error.cause)
              : undefined,
        });
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      throw error;
    }
  }

  throw new Error(`${label}: exhausted all ${maxRetries} retries`);
}

export const convertPdfToImageRoute = task({
  id: "convert-pdf-to-image-route",
  run: async (payload: ConvertPdfToImagePayload) => {
    const { documentVersionId, teamId, documentId, versionNumber } = payload;

    updateStatus({ progress: 0, text: "Initializing..." });

    // 1. get file url from document version
    const documentVersion = await prisma.documentVersion.findUnique({
      where: {
        id: documentVersionId,
      },
      select: {
        file: true,
        storageType: true,
        numPages: true,
      },
    });

    // if documentVersion is null, log error and abort
    if (!documentVersion) {
      logger.error("File not found", { payload });
      updateStatus({ progress: 0, text: "Document not found" });
      throw new AbortTaskRunError("Document version not found");
    }

    logger.info("Document version", { documentVersion });
    updateStatus({ progress: 10, text: "Retrieving file..." });

    // 2. get signed url from file
    const signedUrl = await getFile({
      type: documentVersion.storageType,
      data: documentVersion.file,
    });

    logger.info("Retrieved signed url", { signedUrl });

    if (!signedUrl) {
      logger.error("Failed to get signed url", { payload });
      updateStatus({ progress: 0, text: "Failed to retrieve document" });
      throw new AbortTaskRunError("Failed to get signed URL for document");
    }

    let numPages = documentVersion.numPages;

    // skip if the numPages are already defined
    if (!numPages || numPages === 1) {
      // 3. send file to api/convert endpoint in a task and get back number of pages
      logger.info("Sending file to api/get-pages endpoint");

      try {
        const response = await fetchWithRetry(
          `${process.env.NEXT_PUBLIC_BASE_URL}/api/mupdf/get-pages`,
          {
            method: "POST",
            body: JSON.stringify({ url: signedUrl }),
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${process.env.INTERNAL_API_KEY}`,
            },
          },
          { timeoutMs: GET_PAGES_TIMEOUT_MS, label: "get-pages" },
        );

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          logger.error("Failed to get number of pages", {
            signedUrl,
            status: response.status,
            error: errorData,
            payload,
          });
          updateStatus({ progress: 0, text: "Failed to get number of pages" });
          throw new AbortTaskRunError(
            `Failed to get number of pages (status: ${response.status})`,
          );
        }

        const { numPages: numPagesResult } = (await response.json()) as {
          numPages: number;
        };

        logger.info("Received number of pages", { numPagesResult });

        if (numPagesResult < 1) {
          logger.error("Failed to get number of pages", { payload });
          updateStatus({ progress: 0, text: "Failed to get number of pages" });
          throw new AbortTaskRunError(
            "Failed to get number of pages - invalid page count",
          );
        }

        numPages = numPagesResult;
      } catch (error: unknown) {
        if (error instanceof AbortTaskRunError) {
          throw error;
        }

        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        const errorCause =
          error instanceof Error && error.cause ? error.cause : undefined;

        logger.error("Failed to fetch page count", {
          error: errorMessage,
          cause: errorCause,
          payload,
        });
        updateStatus({ progress: 0, text: "Failed to retrieve page count" });
        throw new AbortTaskRunError(
          `Failed to fetch page count: ${errorMessage}`,
        );
      }
    }

    // Check once if this team is trusted (skips keyword checks for all pages)
    const trustedTeam = await isTrustedTeam(teamId);

    updateStatus({ progress: 20, text: "Converting document..." });

    // 4. iterate through pages and upload to blob in a task
    let currentPage = 0;
    let conversionWithoutError = true;
    for (var i = 0; i < numPages; ++i) {
      if (!conversionWithoutError) {
        break;
      }

      // increment currentPage
      currentPage = i + 1;
      logger.info(`Converting page ${currentPage}`, {
        currentPage,
        numPages,
      });

      try {
        const response = await fetchWithRetry(
          `${process.env.NEXT_PUBLIC_BASE_URL}/api/mupdf/convert-page`,
          {
            method: "POST",
            body: JSON.stringify({
              documentVersionId: documentVersionId,
              pageNumber: currentPage,
              url: signedUrl,
              teamId: teamId,
              trustedTeam: trustedTeam,
            }),
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${process.env.INTERNAL_API_KEY}`,
            },
          },
          {
            timeoutMs: CONVERT_PAGE_TIMEOUT_MS,
            label: `convert-page-${currentPage}`,
          },
        );

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));

          if (response.status === 400 && errorData.error?.includes("blocked")) {
            logger.error("Document blocked", {
              pageNumber: currentPage,
              matchedUrl: errorData.matchedUrl,
              matchedKeyword: errorData.matchedKeyword,
              payload,
            });

            updateStatus({
              progress: 0,
              text: `Document couldn't be processed`,
            });

            throw new AbortTaskRunError("Document processing blocked");
          }

          throw new Error(
            `Failed to convert page ${currentPage} (status: ${response.status})`,
          );
        }

        const { documentPageId } = (await response.json()) as {
          documentPageId: string;
        };

        logger.info(`Created document page for page ${currentPage}:`, {
          documentPageId,
          payload,
        });
      } catch (error: unknown) {
        if (error instanceof AbortTaskRunError) {
          throw error;
        }

        conversionWithoutError = false;
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        const errorCause =
          error instanceof Error && error.cause ? error.cause : undefined;

        logger.error("Failed to convert page", {
          pageNumber: currentPage,
          error: errorMessage,
          cause: errorCause,
          payload,
        });
      }

      updateStatus({
        progress: (currentPage / numPages) * 100,
        text: `${currentPage} / ${numPages} pages processed`,
      });
    }

    if (!conversionWithoutError) {
      logger.error("Failed to process pages", { payload });
      updateStatus({
        progress: (currentPage / numPages) * 100,
        text: `Error processing page ${currentPage} of ${numPages}`,
      });
      throw new AbortTaskRunError(
        `Failed to process page ${currentPage} of ${numPages}`,
      );
    }

    // 5. after all pages are uploaded, update document version to hasPages = true
    await prisma.documentVersion.update({
      where: {
        id: documentVersionId,
      },
      data: {
        numPages: numPages,
        hasPages: true,
        isPrimary: true,
      },
      select: {
        id: true,
        hasPages: true,
        isPrimary: true,
      },
    });

    logger.info("Enabling pages");
    updateStatus({
      progress: 90,
      text: "Enabling pages...",
    });

    if (versionNumber) {
      // after all pages are uploaded, update all other versions to be not primary
      await prisma.documentVersion.updateMany({
        where: {
          documentId: documentId,
          versionNumber: {
            not: versionNumber,
          },
        },
        data: {
          isPrimary: false,
        },
      });
    }

    logger.info("Revalidating link");
    updateStatus({
      progress: 95,
      text: "Revalidating link...",
    });

    // initialize link revalidation for all the document's links
    await fetch(
      `${process.env.NEXTAUTH_URL}/api/revalidate?secret=${process.env.REVALIDATE_TOKEN}&documentId=${documentId}`,
    );

    updateStatus({
      progress: 100,
      text: "Processing complete",
    });

    logger.info("Processing complete");
    return {
      success: true,
      message: "Successfully converted PDF to images",
      totalPages: numPages,
    };
  },
});
