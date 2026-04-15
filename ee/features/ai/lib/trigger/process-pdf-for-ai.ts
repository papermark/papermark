import { logger, metadata, task } from "@trigger.dev/sdk";
import path from "path";

import { openai } from "@/ee/features/ai/lib/models/openai";
import { getFile } from "@/lib/files/get-file";
import prisma from "@/lib/prisma";
import { processPdfForAIQueue } from "@/lib/trigger/queues";

import type { ProcessFilePayload } from "./types";

/**
 * Process a PDF file for AI indexing
 * PDFs can be uploaded directly to OpenAI without conversion
 */
export const processPdfForAITask = task({
  id: "process-pdf-for-ai",
  retry: { maxAttempts: 3 },
  queue: processPdfForAIQueue,
  run: async (payload: ProcessFilePayload): Promise<{ fileId: string }> => {
    const { documentId, documentVersionId, teamId, documentName, filePath, storageType } =
      payload;

    logger.info("Processing PDF for AI", {
      documentId,
      documentVersionId,
      teamId,
    });

    // Check if fileId already exists
    const version = await prisma.documentVersion.findUnique({
      where: { id: documentVersionId },
      select: { fileId: true },
    });

    if (version?.fileId) {
      logger.info("PDF already processed, reusing fileId", {
        documentId,
        fileId: version.fileId,
      });
      return { fileId: version.fileId };
    }

    metadata.set("status", "retrieving");
    metadata.set("step", "Retrieving PDF...");
    metadata.set("progress", 20);

    // Get file URL
    const fileUrl = await getFile({
      type: storageType,
      data: filePath,
      isDownload: true,
    });

    // Fetch file
    const response = await fetch(fileUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch PDF: ${response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const fileName = path.basename(filePath);

    metadata.set("status", "uploading");
    metadata.set("step", "Uploading to OpenAI...");
    metadata.set("progress", 60);

    // Upload to OpenAI Files
    const file = new File([buffer], fileName, { type: "application/pdf" });
    const fileResponse = await openai.files.create({
      file,
      purpose: "assistants",
    });

    // Update document version with fileId
    await prisma.documentVersion.update({
      where: { id: documentVersionId },
      data: { fileId: fileResponse.id },
    });

    logger.info("PDF processed successfully", {
      documentId,
      fileId: fileResponse.id,
    });

    return { fileId: fileResponse.id };
  },
});
