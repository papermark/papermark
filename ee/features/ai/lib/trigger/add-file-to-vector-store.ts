import { logger, metadata, task } from "@trigger.dev/sdk";

import { openai } from "@/ee/features/ai/lib/models/openai";
import { addFileToVectorStoreQueue } from "@/lib/trigger/queues";

import type { AddToVectorStorePayload } from "./types";

/**
 * Add an existing OpenAI file to a vector store
 * This is used when a document has already been processed and we just need to add it
 * to a new vector store (e.g., when adding to a dataroom)
 */
export const addFileToVectorStoreTask = task({
  id: "add-file-to-vector-store",
  retry: { maxAttempts: 3 },
  queue: addFileToVectorStoreQueue,
  run: async (
    payload: AddToVectorStorePayload,
  ): Promise<{ vectorStoreFileId: string }> => {
    const { fileId, vectorStoreId, metadata: fileMetadata } = payload;

    logger.info("Adding file to vector store", {
      fileId,
      vectorStoreId,
      documentId: fileMetadata.documentId,
    });

    metadata.set("status", "indexing");
    metadata.set("step", "Adding to vector store...");
    metadata.set("progress", 80);

    // Add file to vector store with metadata
    const vectorStoreFile = await openai.vectorStores.files.create(
      vectorStoreId,
      {
        file_id: fileId,
        attributes: fileMetadata,
      },
    );

    metadata.set("status", "completed");
    metadata.set("step", "Indexed successfully");
    metadata.set("progress", 100);
    metadata.set("vectorStoreFileId", vectorStoreFile.id);

    logger.info("File added to vector store successfully", {
      fileId,
      vectorStoreFileId: vectorStoreFile.id,
      documentId: fileMetadata.documentId,
    });

    return { vectorStoreFileId: vectorStoreFile.id };
  },
});
