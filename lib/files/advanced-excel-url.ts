import { DocumentStorageType } from "@prisma/client";

import { ONE_MINUTE } from "@/lib/constants";
import { getFile } from "@/lib/files/get-file";

/**
 * Resolve the URL handed to the Office Online viewer for an advanced-mode
 * sheet. Microsoft fetches it from their own backend, so it needs a short-lived
 * signed URL rather than an authenticated request.
 */
export const getAdvancedExcelFileUrl = async ({
  file,
  storageType,
}: {
  file: string;
  storageType: DocumentStorageType;
}): Promise<string> => {
  // Legacy VERCEL_BLOB versions already store an absolute URL.
  if (file.includes("https://")) {
    return file;
  }

  return getFile({
    data: file,
    type: storageType,
    expiresIn: ONE_MINUTE,
  });
};
