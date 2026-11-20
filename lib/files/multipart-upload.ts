import { newId } from "@/lib/id-helper";
import type {
  MultipartCompleteRequest,
  MultipartGetPartUrlsRequest,
  MultipartInitiateRequest,
} from "@/lib/zod/schemas/multipart";

/**
 * Direct-to-S3 multipart upload with per-part progress reporting.
 *
 * Drives the same `/api/file/s3/multipart` endpoint that
 * `lib/files/put-file.ts` already uses for the single-file modal flow, but
 * exposes a streaming `onProgress` callback so the bulk upload zone can keep
 * its byte-level progress UI when the TUS function path is bypassed for
 * large files.
 *
 * Three reasons for a separate helper instead of extending `putFile`:
 * - Need XHR `xhr.upload.onprogress` to surface per-part bytes.
 * - Caller (UploadZone) already has `numPages` precomputed — re-running
 *   `getPagesCount` here would duplicate the PDF parse for every batch.
 * - Caller signals upload failure into per-file rejected lists, so a single
 *   throw fits its existing error handler without a fallback dance.
 */

const PART_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_PARALLEL_PARTS = 5;
const MULTIPART_ENDPOINT = "/api/file/s3/multipart";

export type MultipartUploadResult = {
  /** S3 object key — what `documentData.key` should be set to. */
  key: string;
  /** Slugified file name returned by the multipart endpoint. */
  fileName: string;
  fileType: string;
  numPages: number;
  fileSize: number;
};

export type MultipartUploadParams = {
  file: File;
  teamId: string;
  numPages: number;
  /** Pre-existing doc id; one is generated when omitted. */
  docId?: string;
  /** Override the `File`'s detected MIME (e.g. Firefox-fixed type). */
  contentType?: string;
  onProgress?: (bytesUploaded: number, bytesTotal: number) => void;
  signal?: AbortSignal;
};

/** Threshold above which UploadZone should prefer multipart over TUS. */
export const MULTIPART_SIZE_THRESHOLD = 100 * 1024 * 1024;

export async function multipartUpload({
  file,
  teamId,
  numPages,
  docId,
  contentType,
  onProgress,
  signal,
}: MultipartUploadParams): Promise<MultipartUploadResult> {
  const resolvedDocId = docId ?? newId("doc");
  const resolvedContentType = contentType ?? file.type;
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "";

  const initiateBody: MultipartInitiateRequest = {
    action: "initiate",
    fileName: file.name,
    contentType: resolvedContentType,
    teamId,
    docId: resolvedDocId,
  };

  const initiateResponse = await fetch(`${baseUrl}${MULTIPART_ENDPOINT}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(initiateBody),
    signal,
  });

  if (!initiateResponse.ok) {
    throw new Error(
      `Failed to initiate multipart upload (${initiateResponse.status})`,
    );
  }

  const { uploadId, key, fileName } = (await initiateResponse.json()) as {
    uploadId: string;
    key: string;
    fileName: string;
  };

  const partUrlsBody: MultipartGetPartUrlsRequest = {
    action: "get-part-urls",
    fileName: file.name,
    contentType: resolvedContentType,
    teamId,
    docId: resolvedDocId,
    uploadId,
    fileSize: file.size,
    partSize: PART_SIZE,
  };

  const partUrlsResponse = await fetch(`${baseUrl}${MULTIPART_ENDPOINT}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(partUrlsBody),
    signal,
  });

  if (!partUrlsResponse.ok) {
    throw new Error(
      `Failed to get multipart part URLs (${partUrlsResponse.status})`,
    );
  }

  const { urls } = (await partUrlsResponse.json()) as {
    urls: { partNumber: number; url: string }[];
  };

  // Aggregate progress across concurrently-uploading parts. Each part's XHR
  // reports its own loaded bytes; we sum every part's latest snapshot to
  // derive the file's total bytesUploaded.
  const partBytes = new Map<number, number>();
  const reportProgress = () => {
    if (!onProgress) return;
    let total = 0;
    for (const v of partBytes.values()) total += v;
    if (total > file.size) total = file.size;
    onProgress(total, file.size);
  };

  const uploadPart = ({
    partNumber,
    url,
  }: {
    partNumber: number;
    url: string;
  }) =>
    new Promise<{ PartNumber: number; ETag: string }>((resolve, reject) => {
      const start = (partNumber - 1) * PART_SIZE;
      const end = Math.min(start + PART_SIZE, file.size);
      const chunk = file.slice(start, end);

      const xhr = new XMLHttpRequest();
      xhr.open("PUT", url, true);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          partBytes.set(partNumber, e.loaded);
          reportProgress();
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          const etag = xhr.getResponseHeader("ETag");
          if (!etag) {
            reject(new Error(`Missing ETag in response for part ${partNumber}`));
            return;
          }
          // Force part to its full chunk size — onprogress can stop short of
          // 100% on some browsers/networks even when the upload succeeded.
          partBytes.set(partNumber, chunk.size);
          reportProgress();
          resolve({ PartNumber: partNumber, ETag: etag });
        } else {
          reject(
            new Error(
              `Failed to upload part ${partNumber} (status ${xhr.status})`,
            ),
          );
        }
      };
      xhr.onerror = () =>
        reject(new Error(`Network error while uploading part ${partNumber}`));
      xhr.onabort = () =>
        reject(new Error(`Upload of part ${partNumber} was aborted`));

      if (signal) {
        if (signal.aborted) {
          xhr.abort();
        } else {
          signal.addEventListener("abort", () => xhr.abort(), { once: true });
        }
      }

      xhr.send(chunk);
    });

  const parts: { PartNumber: number; ETag: string }[] = [];
  for (let i = 0; i < urls.length; i += MAX_PARALLEL_PARTS) {
    const batch = urls.slice(i, i + MAX_PARALLEL_PARTS);
    const batchResults = await Promise.all(batch.map(uploadPart));
    parts.push(...batchResults);
  }

  const completeBody: MultipartCompleteRequest = {
    action: "complete",
    fileName: file.name,
    contentType: resolvedContentType,
    teamId,
    docId: resolvedDocId,
    uploadId,
    parts,
  };

  const completeResponse = await fetch(`${baseUrl}${MULTIPART_ENDPOINT}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(completeBody),
    signal,
  });

  if (!completeResponse.ok) {
    throw new Error(
      `Failed to complete multipart upload (${completeResponse.status})`,
    );
  }

  // Final flush in case the last part didn't fire 100% before resolving.
  if (onProgress) onProgress(file.size, file.size);

  return {
    key,
    fileName,
    fileType: resolvedContentType,
    numPages,
    fileSize: file.size,
  };
}
