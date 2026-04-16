import { vertex } from "@/ee/features/ai/lib/models/google";
import { logger, metadata, task } from "@trigger.dev/sdk";
import { generateObject } from "ai";

import { getFile } from "@/lib/files/get-file";
import prisma from "@/lib/prisma";

import {
  buildCustomTermsMessage,
  REDACTION_SYSTEM_PROMPT,
} from "../helpers/detection-prompt";
import { normalizeBox2d } from "../helpers/normalize-box";
import { pMap } from "../helpers/p-limit";
import {
  DetectedRedactionsSchema,
  type DetectedRedaction,
} from "../schemas/redaction";
import { detectRedactionsQueue } from "./queues";

export type DetectRedactionsPayload = {
  jobId: string;
  documentId: string;
  documentVersionId: string;
  teamId: string;
  /** Optional list of extra terms the uploader wants redacted */
  customTerms?: string[];
};

const PAGE_CONCURRENCY = 5;
const MODEL_ID = "gemini-2.5-flash";

/**
 * AI-powered redaction detection task.
 *
 * For each page in the document version (already rasterized during the
 * original upload pipeline), calls Gemini via the Vercel AI SDK's
 * `generateObject` to get structured bounding boxes of PII and custom-term
 * matches, then persists them as `DocumentRedaction` rows with
 * status = PENDING so the uploader can review/accept them.
 */
export const detectRedactionsTask = task({
  id: "detect-redactions",
  retry: { maxAttempts: 3 },
  queue: detectRedactionsQueue,
  run: async (payload: DetectRedactionsPayload) => {
    const { jobId, documentId, documentVersionId, teamId, customTerms } =
      payload;

    logger.info("Starting redaction detection", {
      jobId,
      documentId,
      documentVersionId,
      teamId,
      customTermCount: customTerms?.length ?? 0,
    });

    // Mark the job as DETECTING.
    await prisma.documentRedactionJob.update({
      where: { id: jobId },
      data: { status: "DETECTING", errorMessage: null },
    });

    metadata
      .set("status", "detecting")
      .set("step", "Loading document pages...")
      .set("progress", 0)
      .set("pagesProcessed", 0)
      .set("totalPages", 0)
      .set("redactionsFound", 0);

    try {
      const pages = await prisma.documentPage.findMany({
        where: { versionId: documentVersionId },
        orderBy: { pageNumber: "asc" },
        select: {
          pageNumber: true,
          file: true,
          storageType: true,
        },
      });

      if (pages.length === 0) {
        logger.warn("No rasterized pages found for document version", {
          documentVersionId,
        });
        await prisma.documentRedactionJob.update({
          where: { id: jobId },
          data: { status: "REVIEW" },
        });
        metadata.set("status", "review").set("progress", 100);
        return { pagesProcessed: 0, redactionsFound: 0 };
      }

      metadata.set("totalPages", pages.length);

      const customTermsMessage = buildCustomTermsMessage(customTerms ?? []);

      let pagesProcessed = 0;
      let totalRedactionsFound = 0;

      const perPageResults = await pMap(
        pages,
        async (page) => {
          const detected = await detectRedactionsForPage({
            page,
            customTermsMessage,
          });

          if (detected.length > 0) {
            await prisma.documentRedaction.createMany({
              data: detected.map((r) => {
                const box = normalizeBox2d(r.box2d);
                return {
                  jobId,
                  pageNumber: page.pageNumber,
                  x: box.x,
                  y: box.y,
                  width: box.width,
                  height: box.height,
                  detectedText: r.detectedText?.slice(0, 1000) ?? null,
                  category: r.category,
                  confidence: r.confidence,
                  source: "AI",
                  status: "PENDING",
                };
              }),
            });
          }

          pagesProcessed += 1;
          totalRedactionsFound += detected.length;

          metadata
            .set("pagesProcessed", pagesProcessed)
            .set("redactionsFound", totalRedactionsFound)
            .set(
              "progress",
              Math.round((pagesProcessed / pages.length) * 100),
            )
            .set(
              "step",
              `Scanned ${pagesProcessed} of ${pages.length} pages...`,
            );

          return detected.length;
        },
        { concurrency: PAGE_CONCURRENCY },
      );

      await prisma.documentRedactionJob.update({
        where: { id: jobId },
        data: { status: "REVIEW" },
      });

      metadata
        .set("status", "review")
        .set("step", "Detection complete")
        .set("progress", 100);

      logger.info("Redaction detection complete", {
        jobId,
        pagesProcessed,
        redactionsFound: totalRedactionsFound,
      });

      return {
        pagesProcessed,
        redactionsFound: totalRedactionsFound,
        perPage: perPageResults,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      logger.error("Redaction detection failed", { jobId, error: errorMessage });

      await prisma.documentRedactionJob.update({
        where: { id: jobId },
        data: { status: "FAILED", errorMessage },
      });

      metadata.set("status", "failed").set("step", errorMessage);

      throw error;
    }
  },
});

type PageRef = {
  pageNumber: number;
  file: string;
  storageType: "VERCEL_BLOB" | "S3_PATH";
};

async function detectRedactionsForPage({
  page,
  customTermsMessage,
}: {
  page: PageRef;
  customTermsMessage: string | null;
}): Promise<DetectedRedaction[]> {
  const imageUrl = await getFile({
    type: page.storageType,
    data: page.file,
    isDownload: true,
  });

  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch page image (page ${page.pageNumber}): ${response.status} ${response.statusText}`,
    );
  }
  const imageBuffer = Buffer.from(await response.arrayBuffer());

  const userContent: Array<
    | { type: "text"; text: string }
    | { type: "image"; image: Buffer }
  > = [];

  if (customTermsMessage) {
    userContent.push({ type: "text", text: customTermsMessage });
  }

  userContent.push({
    type: "text",
    text: `Analyze page ${page.pageNumber} of this document. Return every region that should be redacted using the provided schema. Coordinates MUST be normalized to a 0-1000 scale and use the box2d format [yMin, xMin, yMax, xMax]. If nothing is sensitive, return an empty array.`,
  });
  userContent.push({ type: "image", image: imageBuffer });

  const result = await generateObject({
    model: vertex(MODEL_ID),
    system: REDACTION_SYSTEM_PROMPT,
    schema: DetectedRedactionsSchema,
    temperature: 0.2,
    messages: [
      {
        role: "user",
        content: userContent,
      },
    ],
  });

  return result.object?.redactions ?? [];
}
