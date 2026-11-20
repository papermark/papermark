import { z } from "zod";

const ZDocumentProgressStatus = z.object({
  progress: z.number(),
  text: z.string(),
});

export type TDocumentProgressStatus = z.infer<typeof ZDocumentProgressStatus>;

const ZDocumentProgressMetadata = z.object({
  status: ZDocumentProgressStatus,
});

export function parseStatus(data: unknown): TDocumentProgressStatus {
  return ZDocumentProgressMetadata.parse(data).status;
}
