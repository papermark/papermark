import { DocumentStorageType } from "@prisma/client";

import { newId } from "@/lib/id-helper";
import { getPagesCount } from "@/lib/utils/get-page-number-count";
import type {
  MultipartCompleteRequest,
  MultipartGetPartUrlsRequest,
  MultipartInitiateRequest,
} from "@/lib/zod/schemas/multipart";

import { SUPPORTED_DOCUMENT_MIME_TYPES } from "../constants";
import { assertS3Transport } from "./transport";

/**
 * Uploads a file to S3.
 *
 * For S3 uploads:
 * - Files larger than 10MB automatically use multipart upload with pre-signed URLs
 * - Files are uploaded in 10MB chunks with parallel processing (batches of 3)
 * - Provides better performance and reliability for large files
 * - Falls back to single upload for smaller files or on multipart failure
 *
 * @param file - The file to upload
 * @param teamId - The team ID for storage configuration
 * @param docId - Optional document ID (generated if not provided)
 * @returns Upload result with storage type, key, page count, and file size
 */
export const putFile = async ({
  file,
  teamId,
  docId,
}: {
  file: File;
  teamId: string;
  docId?: string;
}): Promise<{
  type: DocumentStorageType | null;
  data: string | null;
  numPages: number | undefined;
  fileSize: number | undefined;
}> => {
  assertS3Transport();

  return putFileInS3({ file, teamId, docId });
};

// Multipart upload threshold: 10MB
const MULTIPART_THRESHOLD = 10 * 1024 * 1024;
const PART_SIZE = 10 * 1024 * 1024; // 10MB chunks

const putFileInS3 = async ({
  file,
  teamId,
  docId,
}: {
  file: File;
  teamId: string;
  docId?: string;
}) => {
  if (!docId) {
    docId = newId("doc");
  }

  // Some formats either have no browser-known MIME (binary GIS/stats) or
  // browsers return inconsistent MIMEs (older Office macro-enabled / binary).
  // Fall back to extension matching for those before rejecting the upload.
  const EXTENSION_FALLBACKS = [
    ".dwg",
    ".dxf",
    ".xlsm",
    ".xlsb",
    ".sav",
    ".shp",
    ".shx",
    ".dbf",
    ".sbn",
    ".sbx",
    ".qix",
    ".cpg",
    ".rar",
    ".tar",
    ".tar.gz",
    ".tgz",
    ".gz",
  ];
  const lowerName = file.name.toLowerCase();
  if (
    !SUPPORTED_DOCUMENT_MIME_TYPES.includes(file.type) &&
    !EXTENSION_FALLBACKS.some((ext) => lowerName.endsWith(ext))
  ) {
    throw new Error(
      "Only PDF, Powerpoint, Word, and Excel, ZIP files are supported",
    );
  }

  // Check if file should use multipart upload
  if (file.size > MULTIPART_THRESHOLD) {
    return await putFileMultipart({ file, teamId, docId });
  } else {
    return await putFileSingle({ file, teamId, docId });
  }
};

// Single file upload (existing logic)
const putFileSingle = async ({
  file,
  teamId,
  docId,
}: {
  file: File;
  teamId: string;
  docId: string;
}) => {
  const presignedResponse = await fetch(
    `${process.env.NEXT_PUBLIC_BASE_URL}/api/file/s3/get-presigned-post-url`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        fileName: file.name,
        contentType: file.type,
        teamId: teamId,
        docId: docId,
      }),
    },
  );

  if (!presignedResponse.ok) {
    throw new Error(
      `Failed to get presigned post url, failed with status code ${presignedResponse.status}`,
    );
  }

  const { url, key, fileName, contentDisposition } =
    (await presignedResponse.json()) as {
      url: string;
      key: string;
      fileName: string;
      contentDisposition: string;
    };

  const response = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": file.type,
      "Content-Disposition": contentDisposition,
    },
    body: file,
  });

  if (!response.ok) {
    throw new Error(
      `Failed to upload file "${file.name}", failed with status code ${response.status}`,
    );
  }

  let numPages: number = 1;
  // get page count for pdf files
  if (file.type === "application/pdf") {
    const body = await file.arrayBuffer();
    numPages = await getPagesCount(body);
  }

  return {
    type: DocumentStorageType.S3_PATH,
    data: key,
    numPages: numPages,
    fileSize: file.size,
  };
};

// Multipart file upload for large files
const putFileMultipart = async ({
  file,
  teamId,
  docId,
}: {
  file: File;
  teamId: string;
  docId: string;
}) => {
  try {
    // Step 1: Initiate multipart upload
    const initiateResponse = await fetch(
      `${process.env.NEXT_PUBLIC_BASE_URL}/api/file/s3/multipart`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "initiate",
          fileName: file.name,
          contentType: file.type,
          teamId: teamId,
          docId: docId,
        } satisfies MultipartInitiateRequest),
      },
    );

    if (!initiateResponse.ok) {
      throw new Error(
        `Failed to initiate multipart upload, status: ${initiateResponse.status}`,
      );
    }

    const { uploadId, key, fileName } = await initiateResponse.json();

    // Step 2: Get pre-signed URLs for parts
    const partUrlsResponse = await fetch(
      `${process.env.NEXT_PUBLIC_BASE_URL}/api/file/s3/multipart`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "get-part-urls",
          fileName: file.name,
          contentType: file.type,
          teamId: teamId,
          docId: docId,
          uploadId: uploadId,
          fileSize: file.size,
          partSize: PART_SIZE,
        } satisfies MultipartGetPartUrlsRequest),
      },
    );

    if (!partUrlsResponse.ok) {
      throw new Error(
        `Failed to get part URLs, status: ${partUrlsResponse.status}`,
      );
    }

    const { urls } = await partUrlsResponse.json();

    // Step 3: Upload parts in parallel (batches of 3)
    const uploadPart = async ({
      partNumber,
      url,
    }: {
      partNumber: number;
      url: string;
    }) => {
      const start = (partNumber - 1) * PART_SIZE;
      const end = Math.min(start + PART_SIZE, file.size);
      const chunk = file.slice(start, end);

      const response = await fetch(url, {
        method: "PUT",
        body: chunk,
      });

      if (!response.ok) {
        throw new Error(
          `Failed to upload part ${partNumber}, status: ${response.status}`,
        );
      }

      const etag = response.headers.get("ETag");
      if (!etag) {
        throw new Error(`Missing ETag in response for part ${partNumber}`);
      }

      return { PartNumber: partNumber, ETag: etag };
    };

    // Upload parts in batches to avoid overwhelming the connection
    const batchSize = 5;
    const parts: Array<{ PartNumber: number; ETag: string }> = [];

    for (let i = 0; i < urls.length; i += batchSize) {
      const batch = urls.slice(i, i + batchSize);
      const batchResults = await Promise.all(batch.map(uploadPart));
      parts.push(...batchResults);
    }

    // Step 4: Complete multipart upload
    const completeResponse = await fetch(
      `${process.env.NEXT_PUBLIC_BASE_URL}/api/file/s3/multipart`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "complete",
          fileName: file.name,
          contentType: file.type,
          teamId: teamId,
          docId: docId,
          uploadId: uploadId,
          parts: parts,
        } satisfies MultipartCompleteRequest),
      },
    );

    if (!completeResponse.ok) {
      throw new Error(
        `Failed to complete multipart upload, status: ${completeResponse.status}`,
      );
    }

    let numPages: number = 1;
    // get page count for pdf files
    if (file.type === "application/pdf") {
      const body = await file.arrayBuffer();
      numPages = await getPagesCount(body);
    }

    return {
      type: DocumentStorageType.S3_PATH,
      data: key,
      numPages: numPages,
      fileSize: file.size,
    };
  } catch (error) {
    console.error("Multipart upload failed:", error);
    // Fallback to single upload on error
    console.log("Falling back to single upload...");
    return await putFileSingle({ file, teamId, docId });
  }
};
