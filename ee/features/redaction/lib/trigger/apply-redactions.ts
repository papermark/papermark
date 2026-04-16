import { PDF, rgb } from "@libpdf/core";
import { AbortTaskRunError, logger, metadata, task } from "@trigger.dev/sdk";

import { ONE_HOUR } from "@/lib/constants";
import { getFile } from "@/lib/files/get-file";
import { putFileServer } from "@/lib/files/put-file-server";
import prisma from "@/lib/prisma";
import { convertPdfToImageRoute } from "@/lib/trigger/pdf-to-image-route";
import { conversionQueueName } from "@/lib/utils/trigger-utils";

import { boxToPdfRect } from "../helpers/normalize-box";
import { applyRedactionsQueue } from "./queues";

export type ApplyRedactionsPayload = {
  jobId: string;
};

/**
 * Apply accepted redactions to the PDF and create a new DocumentVersion.
 *
 * This task is non-destructive: the original PDF + version are always
 * preserved. The redacted PDF becomes a new `DocumentVersion` with
 * `isPrimary = true`, and the previous primary version is demoted.
 * Unredacting is as simple as flipping `isPrimary` back.
 */
export const applyRedactionsTask = task({
  id: "apply-redactions",
  retry: { maxAttempts: 2 },
  queue: applyRedactionsQueue,
  run: async (payload: ApplyRedactionsPayload) => {
    const { jobId } = payload;

    logger.info("Applying redactions", { jobId });

    metadata
      .set("status", "applying")
      .set("step", "Loading document...")
      .set("progress", 0);

    // Flip status to APPLYING.
    await prisma.documentRedactionJob.update({
      where: { id: jobId },
      data: { status: "APPLYING", errorMessage: null },
    });

    try {
      const job = await prisma.documentRedactionJob.findUnique({
        where: { id: jobId },
        select: {
          id: true,
          documentId: true,
          documentVersionId: true,
          teamId: true,
          documentVersion: {
            select: {
              id: true,
              file: true,
              originalFile: true,
              storageType: true,
              type: true,
              contentType: true,
              numPages: true,
              versionNumber: true,
              fileSize: true,
            },
          },
          document: {
            select: { name: true, teamId: true },
          },
          redactions: {
            where: { status: "ACCEPTED" },
            select: {
              pageNumber: true,
              x: true,
              y: true,
              width: true,
              height: true,
            },
          },
        },
      });

      if (!job) {
        throw new AbortTaskRunError(`Redaction job ${jobId} not found`);
      }

      const version = job.documentVersion;
      if (!version) {
        throw new AbortTaskRunError(
          `Source document version not found for job ${jobId}`,
        );
      }

      if (job.redactions.length === 0) {
        logger.warn("No accepted redactions to apply, marking complete", {
          jobId,
        });
        await prisma.documentRedactionJob.update({
          where: { id: jobId },
          data: { status: "APPLIED" },
        });
        metadata.set("status", "applied").set("progress", 100);
        return { redactionsApplied: 0 };
      }

      metadata.set("step", "Downloading source PDF...").set("progress", 10);

      const signedUrl = await getFile({
        type: version.storageType,
        data: version.file,
        expiresIn: ONE_HOUR,
      });
      const resp = await fetch(signedUrl);
      if (!resp.ok) {
        throw new Error(
          `Failed to fetch source PDF: ${resp.status} ${resp.statusText}`,
        );
      }
      const pdfBytes = new Uint8Array(await resp.arrayBuffer());

      metadata.set("step", "Burning redactions into PDF...").set("progress", 40);

      const redactedBytes = await burnRedactionsIntoPdf({
        pdfBytes,
        redactions: job.redactions,
      });

      metadata.set("step", "Uploading redacted PDF...").set("progress", 70);

      const teamId = job.teamId;
      const documentName = job.document.name || "document.pdf";
      const redactedFileName = buildRedactedFilename(documentName);

      const uploaded = await putFileServer({
        file: {
          name: redactedFileName,
          type: "application/pdf",
          buffer: Buffer.from(redactedBytes),
        },
        teamId,
        docId: undefined,
        restricted: true,
      });

      if (!uploaded.type || !uploaded.data) {
        throw new Error("Failed to upload redacted PDF");
      }
      // Narrow into non-null locals so the transaction closure below keeps
      // the narrowing (TS doesn't widen through async callbacks).
      const uploadedType = uploaded.type;
      const uploadedData = uploaded.data;

      metadata.set("step", "Creating new document version...").set("progress", 85);

      // Create a new DocumentVersion. Bump versionNumber and mark primary.
      // Keep originalFile pointing at the pre-redaction version.
      const highestVersion = await prisma.documentVersion.findFirst({
        where: { documentId: job.documentId },
        orderBy: { versionNumber: "desc" },
        select: { versionNumber: true },
      });
      const nextVersionNumber = (highestVersion?.versionNumber ?? 0) + 1;

      // Demote existing primaries FIRST, then create the new redacted
      // version as the only primary. Also back-link the job to the new
      // version so `DocumentRedactionJob.resultingVersionId` identifies it.
      const newVersion = await prisma.$transaction(async (tx) => {
        await tx.documentVersion.updateMany({
          where: { documentId: job.documentId, isPrimary: true },
          data: { isPrimary: false },
        });

        const created = await tx.documentVersion.create({
          data: {
            documentId: job.documentId,
            versionNumber: nextVersionNumber,
            file: uploadedData,
            originalFile: version.originalFile ?? version.file,
            type: version.type ?? "pdf",
            contentType: version.contentType ?? "application/pdf",
            storageType: uploadedType,
            numPages: version.numPages,
            isPrimary: true,
            isVertical: false,
            fileSize: BigInt(redactedBytes.byteLength),
            // Self-reference to the pre-redaction version. Non-null value
            // here is the canonical signal that a version is a redacted one.
            redactedFromVersionId: version.id,
          },
        });

        // Back-link the job -> resulting version so both sides can navigate.
        await tx.documentRedactionJob.update({
          where: { id: jobId },
          data: { resultingVersionId: created.id },
        });

        return created;
      });

      // Point the Document.file at the redacted file.
      await prisma.document.update({
        where: { id: job.documentId },
        data: {
          file: uploadedData,
          storageType: uploadedType,
        },
      });

      metadata.set("step", "Re-rasterizing pages...").set("progress", 92);

      // Look up the team's plan so we pick the correct conversion queue.
      const team = await prisma.team.findUnique({
        where: { id: teamId },
        select: { plan: true },
      });

      await convertPdfToImageRoute.trigger(
        {
          documentId: job.documentId,
          documentVersionId: newVersion.id,
          teamId,
          versionNumber: newVersion.versionNumber,
        },
        {
          idempotencyKey: `${teamId}-${newVersion.id}-redaction`,
          tags: [
            `team_${teamId}`,
            `document_${job.documentId}`,
            `version:${newVersion.id}`,
            `redaction_job:${jobId}`,
          ],
          queue: conversionQueueName(team?.plan ?? "free"),
          concurrencyKey: teamId,
        },
      );

      // Mark all accepted redactions as APPLIED and the job as APPLIED.
      await prisma.$transaction([
        prisma.documentRedaction.updateMany({
          where: { jobId, status: "ACCEPTED" },
          data: { status: "APPLIED" },
        }),
        prisma.documentRedactionJob.update({
          where: { id: jobId },
          data: { status: "APPLIED" },
        }),
      ]);

      metadata
        .set("status", "applied")
        .set("step", "Redactions applied")
        .set("progress", 100);

      logger.info("Redactions applied", {
        jobId,
        newVersionId: newVersion.id,
        redactionsApplied: job.redactions.length,
      });

      return {
        newVersionId: newVersion.id,
        redactionsApplied: job.redactions.length,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      logger.error("Failed to apply redactions", { jobId, error: errorMessage });

      await prisma.documentRedactionJob.update({
        where: { id: jobId },
        data: { status: "FAILED", errorMessage },
      });

      metadata.set("status", "failed").set("step", errorMessage);

      throw error;
    }
  },
});

type RedactionRect = {
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * Draw opaque black rectangles over each redaction region using @libpdf/core.
 *
 * Note: this produces a VISUAL redaction. The underlying text operators are
 * not removed from the content stream, so downstream tools could still
 * extract the original text. For most data-room redaction workflows this is
 * acceptable (see the notes in the plan file). Full content-stream redaction
 * is a future enhancement on top of @libpdf/core's lower-level API.
 */
async function burnRedactionsIntoPdf({
  pdfBytes,
  redactions,
}: {
  pdfBytes: Uint8Array;
  redactions: RedactionRect[];
}): Promise<Uint8Array> {
  const pdf = await PDF.load(pdfBytes);

  // Group redactions by page for efficiency.
  const byPage = new Map<number, RedactionRect[]>();
  for (const r of redactions) {
    const list = byPage.get(r.pageNumber) ?? [];
    list.push(r);
    byPage.set(r.pageNumber, list);
  }

  const black = rgb(0, 0, 0);

  for (const [pageNumber, rects] of byPage.entries()) {
    const page = pdf.getPage(pageNumber - 1);
    if (!page) continue;

    const pageWidth = page.width;
    const pageHeight = page.height;

    for (const r of rects) {
      const rect = boxToPdfRect(
        { x: r.x, y: r.y, width: r.width, height: r.height },
        pageWidth,
        pageHeight,
      );

      // Clamp to page just in case the client/AI produced a slightly
      // out-of-range box.
      const clampedX = Math.max(0, Math.min(pageWidth, rect.x));
      const clampedY = Math.max(0, Math.min(pageHeight, rect.y));
      const clampedW = Math.max(
        0,
        Math.min(pageWidth - clampedX, rect.width),
      );
      const clampedH = Math.max(
        0,
        Math.min(pageHeight - clampedY, rect.height),
      );

      if (clampedW <= 0 || clampedH <= 0) continue;

      page.drawRectangle({
        x: clampedX,
        y: clampedY,
        width: clampedW,
        height: clampedH,
        color: black,
        opacity: 1,
      });
    }
  }

  return pdf.save();
}

function buildRedactedFilename(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, "-");
  const withoutExt = trimmed.replace(/\.[^.]+$/, "");
  return `${withoutExt || "document"}-redacted.pdf`;
}
