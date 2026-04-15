import { logger, metadata, task } from "@trigger.dev/sdk";

import prisma from "@/lib/prisma";
import { processDocumentForAIQueue } from "@/lib/trigger/queues";

import { addFileToVectorStoreTask } from "./add-file-to-vector-store";
import { processExcelForAITask } from "./process-excel-for-ai";
import { processImageForAITask } from "./process-image-for-ai";
import { processPdfForAITask } from "./process-pdf-for-ai";
import {
  EXCEL_CONTENT_TYPES,
  IMAGE_CONTENT_TYPES,
  PDF_CONTENT_TYPES,
  SUPPORTED_AI_CONTENT_TYPES,
  type ProcessDocumentPayload,
} from "./types";

/**
 * Main orchestrator task for processing documents for AI
 * Routes to appropriate subtask based on content type, then adds to vector store
 */
export const processDocumentForAITask = task({
  id: "process-document-for-ai",
  retry: { maxAttempts: 3 },
  queue: processDocumentForAIQueue,
  run: async (
    payload: ProcessDocumentPayload,
  ): Promise<{ vectorStoreFileId: string; fileId: string }> => {
    const {
      documentId,
      documentVersionId,
      teamId,
      vectorStoreId,
      documentName,
      filePath,
      storageType,
      contentType,
      metadata: fileMetadata,
    } = payload;

    logger.info("Starting document processing for AI", {
      documentId,
      documentVersionId,
      teamId,
      contentType,
    });

    // Initialize metadata for real-time tracking
    metadata.set("status", "pending");
    metadata.set("documentName", documentName);
    metadata.set("documentId", documentId);
    metadata.set("step", "Initializing...");
    metadata.set("progress", 0);

    // Validate content type
    if (!SUPPORTED_AI_CONTENT_TYPES.includes(contentType)) {
      metadata.set("status", "failed");
      metadata.set("step", "Unsupported file type");
      metadata.set("error", `Unsupported content type: ${contentType}`);
      throw new Error(`Unsupported content type: ${contentType}`);
    }

    // Check if fileId already exists
    const version = await prisma.documentVersion.findUnique({
      where: { id: documentVersionId },
      select: { fileId: true },
    });

    let fileId = version?.fileId;

    // Process document if no fileId exists
    if (!fileId) {
      metadata.set("status", "processing");
      metadata.set("step", "Processing document...");
      metadata.set("progress", 10);

      // Route to appropriate processing task based on content type
      if (PDF_CONTENT_TYPES.includes(contentType)) {
        const result = await processPdfForAITask.triggerAndWait({
          documentId,
          documentVersionId,
          teamId,
          documentName,
          filePath,
          storageType,
          contentType,
        });

        if (!result.ok) {
          metadata.set("status", "failed");
          metadata.set("step", "PDF processing failed");
          metadata.set("error", "Failed to process PDF");
          throw new Error("Failed to process PDF");
        }

        fileId = result.output.fileId;
      } else if (EXCEL_CONTENT_TYPES.includes(contentType)) {
        const result = await processExcelForAITask.triggerAndWait({
          documentId,
          documentVersionId,
          teamId,
          documentName,
          filePath,
          storageType,
          contentType,
        });

        if (!result.ok) {
          metadata.set("status", "failed");
          metadata.set("step", "Excel processing failed");
          metadata.set("error", "Failed to process Excel file");
          throw new Error("Failed to process Excel file");
        }

        fileId = result.output.fileId;
      } else if (IMAGE_CONTENT_TYPES.includes(contentType)) {
        const result = await processImageForAITask.triggerAndWait({
          documentId,
          documentVersionId,
          teamId,
          documentName,
          filePath,
          storageType,
          contentType,
        });

        if (!result.ok) {
          metadata.set("status", "failed");
          metadata.set("step", "Image processing failed");
          metadata.set("error", "Failed to process image");
          throw new Error("Failed to process image");
        }

        fileId = result.output.fileId;
      }
    } else {
      logger.info("Document already processed, reusing fileId", {
        documentId,
        fileId,
      });
      metadata.set("step", "Using existing processed file...");
      metadata.set("progress", 50);
    }

    if (!fileId) {
      metadata.set("status", "failed");
      metadata.set("step", "Processing failed");
      metadata.set("error", "No file ID returned from processing");
      throw new Error("No file ID returned from processing");
    }

    metadata.set("fileId", fileId);

    // Add file to vector store
    metadata.set("status", "indexing");
    metadata.set("step", "Adding to vector store...");
    metadata.set("progress", 80);

    const vsResult = await addFileToVectorStoreTask.triggerAndWait({
      fileId,
      vectorStoreId,
      metadata: fileMetadata,
    });

    if (!vsResult.ok) {
      metadata.set("status", "failed");
      metadata.set("step", "Failed to add to vector store");
      metadata.set("error", "Failed to add file to vector store");
      throw new Error("Failed to add file to vector store");
    }

    const { vectorStoreFileId } = vsResult.output;

    // Update document version with vectorStoreFileId
    await prisma.documentVersion.update({
      where: { id: documentVersionId },
      data: { vectorStoreFileId },
    });

    metadata.set("status", "completed");
    metadata.set("step", "Indexed successfully");
    metadata.set("progress", 100);
    metadata.set("vectorStoreFileId", vectorStoreFileId);

    logger.info("Document processed and indexed successfully", {
      documentId,
      fileId,
      vectorStoreFileId,
    });

    return { vectorStoreFileId, fileId };
  },
});
