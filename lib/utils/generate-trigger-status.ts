import { metadata } from "@trigger.dev/sdk";
import { z } from "zod";

const ZDocumentProgressStatus = z.object({
  progress: z.number(),
  text: z.string(),
});

type TDocumentProgressStatus = z.infer<typeof ZDocumentProgressStatus>;

const ZDocumentProgressMetadata = z.object({
  status: ZDocumentProgressStatus,
});

type TDocumentProgressMetadata = z.infer<typeof ZDocumentProgressMetadata>;

/**
 * Update the status of the convert document task. Wraps the `metadata.set` method.
 */
export function updateStatus(status: TDocumentProgressStatus) {
  // `metadata.set` can be used to update the status of the task
  // as long as `updateStatus` is called within the task's `run` function.
  metadata.set("status", status);
}

/**
 * Parse the status from the metadata.
 */
export function parseStatus(data: unknown): TDocumentProgressStatus {
  return ZDocumentProgressMetadata.parse(data).status;
}
