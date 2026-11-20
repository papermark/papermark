import { logger, task } from "@trigger.dev/sdk";

import {
  getTeamStorageConfigById,
  type StorageConfig,
} from "@/ee/features/storage/config";
import { ItemType } from "@prisma/client";
import {
  InvocationType,
  InvokeCommand,
  type LambdaClient,
} from "@aws-sdk/client-lambda";

import { buildBulkDownloadStructure } from "@/lib/dataroom/build-bulk-download-structure";
import { collectDescendantIds } from "@/lib/dataroom/build-folder-hierarchy";
import { sendDownloadReadyEmail } from "@/lib/emails/send-download-ready-email";
import { getLambdaClientForTeam } from "@/lib/files/aws-client";
import { parseS3PresignedUrl } from "@/lib/files/bulk-download-presign";
import { notifyDocumentDownload } from "@/lib/integrations/slack/events";
import prisma from "@/lib/prisma";
import { downloadJobStore } from "@/lib/redis-download-job-store";
import { constructLinkUrl } from "@/lib/utils/link-url";

// Maximum files per batch (Lambda payload limit)
const MAX_FILES_PER_BATCH = 500;
// Maximum size for a single ZIP file (500MB to stay within Lambda's 15min timeout)
// Lambda needs time to: read from S3 + apply watermarks + create ZIP + upload to S3
const MAX_ZIP_SIZE_BYTES = 500 * 1024 * 1024;
// Estimated size for files where size info is missing
const UNKNOWN_FILE_SIZE_ESTIMATE = 10 * 1024 * 1024;
// Threshold above which we don't store the per-document list in downloadMetadata
const DOCUMENT_LIST_METADATA_THRESHOLD = 100;

/**
 * Generate a UTC timestamp in the format: "20260202T131428Z"
 * @returns Formatted UTC timestamp
 */
function generateTimestamp(): string {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

/**
 * Generate a zip filename.
 * Full dataroom: "Dataroom Name-20260202T131428Z[-001]"
 * Folder download: "Dataroom Name-FolderName-20260202T131428Z[-001]"
 */
function generateZipFileName(
  dataroomName: string,
  timestamp: string,
  partNumber?: number,
  folderName?: string,
): string {
  const paddedPart = partNumber?.toString().padStart(3, "0") ?? "";
  const base = folderName
    ? `${dataroomName}-${folderName}-${timestamp}`
    : `${dataroomName}-${timestamp}`;

  return `${base}${paddedPart ? `-${paddedPart}` : ""}`;
}

export type BulkDownloadFolderStructure = {
  [key: string]: {
    name: string;
    path: string;
    files: {
      name: string;
      key: string;
      type?: string;
      numPages?: number;
      needsWatermark?: boolean;
      size?: number; // File size in bytes
    }[];
  };
};

/**
 * When `sourceContext` is provided the task fetches dataroom folders,
 * documents and permissions itself, builds the folder structure, persists
 * download views and emits the Slack notification. This is the path used by
 * the viewer-facing folder/bulk download endpoints so the API can return a
 * jobId immediately without doing heavy DB work under the request timeout.
 *
 * When `folderStructure` + `fileKeys` are provided directly (legacy path
 * used by the team admin endpoint) the task skips that work and runs the
 * Lambda batching/zip pipeline against the supplied structure.
 */
export type BulkDownloadPayload = {
  jobId: string;
  dataroomId: string;
  dataroomName: string;
  teamId: string;
  // Source bucket is optional – when absent, the task resolves it from the
  // team's storage config. The new viewer endpoints skip this fetch in the
  // request path so the API can return a jobId immediately.
  sourceBucket?: string;
  // Optional pre-built folder structure (admin path)
  folderStructure?: BulkDownloadFolderStructure;
  fileKeys?: string[];
  // Optional context that lets the task build the folder structure itself
  sourceContext?: {
    type: "bulk" | "folder";
    folderId?: string;
    linkId: string;
    viewId: string;
    viewerId?: string;
    viewerEmail?: string;
    groupId?: string;
    permissionGroupId?: string;
    verified: boolean;
    enableWatermark: boolean;
    notifySlack: boolean;
  };
  watermarkConfig?: {
    enabled: boolean;
    config?: any;
    viewerData?: {
      email?: string | null;
      date?: string;
      time?: string;
      link?: string | null;
      ipAddress?: string;
    };
  };
  viewId?: string;
  viewerId?: string;
  viewerEmail?: string;
  linkId?: string;
  userId?: string;
  emailNotification?: boolean;
  emailAddress?: string;
  folderName?: string;
};

export const bulkDownloadTask = task({
  id: "bulk-download",
  retry: { maxAttempts: 2 },
  machine: { preset: "small-1x" },
  run: async (payload: BulkDownloadPayload) => {
    const {
      jobId,
      dataroomId,
      dataroomName,
      teamId,
      watermarkConfig,
      emailNotification,
      emailAddress,
      sourceContext,
    } = payload;

    let sourceBucket = payload.sourceBucket;

    let folderStructure = payload.folderStructure;
    let fileKeys = payload.fileKeys;
    let folderName = payload.folderName;

    logger.info("Starting bulk download task", {
      jobId,
      dataroomId,
      dataroomName,
      mode: sourceContext ? "build" : "prebuilt",
      preBuiltFileCount: fileKeys?.length ?? 0,
    });

    // Generate timestamp once for all parts of this download
    const downloadTimestamp = generateTimestamp();

    try {
      // Resolve the team's storage config and Lambda client ONCE for the
      // whole task (used by every batch). `getLambdaClientForTeam` also
      // looks up the config, but they run in parallel so the wall-clock
      // cost is a single round-trip rather than `O(batches)` of them.
      const [storageConfig, lambdaClient] = await Promise.all([
        getTeamStorageConfigById(teamId),
        getLambdaClientForTeam(teamId),
      ]);
      const resolvedSourceBucket = sourceBucket ?? storageConfig.bucket;

      // If the API didn't pre-build the folder structure, do it here while
      // the job is still in PENDING (so the UI keeps showing "Preparing...").
      if (sourceContext) {
        const built = await buildDownloadContext({
          jobId,
          dataroomId,
          dataroomName,
          teamId,
          sourceContext,
        });

        folderStructure = built.folderStructure;
        fileKeys = built.fileKeys;
        if (sourceContext.type === "folder" && built.folderName) {
          folderName = built.folderName;
        }
      }

      if (!folderStructure || !fileKeys) {
        throw new Error("Missing folderStructure/fileKeys for bulk download");
      }

      if (fileKeys.length === 0) {
        logger.warn("No files to download – marking job as failed", { jobId });
        await downloadJobStore.updateJob(jobId, {
          status: "FAILED",
          error: "No files available to download",
        });
        return { success: false, jobId, downloadUrls: [] };
      }

      // Now that we know the real total, flip to PROCESSING with an
      // accurate totalFiles so the UI can render meaningful progress.
      await downloadJobStore.updateJob(jobId, {
        status: "PROCESSING",
        phase: "ZIPPING",
        processedFiles: 0,
        progress: 0,
        totalFiles: fileKeys.length,
      });

      // Calculate total size from folder structure for batch decisions
      const totalPayloadSize = Object.values(folderStructure).reduce(
        (sum, folder) =>
          sum +
          folder.files.reduce((fSum, file) => fSum + (file.size || 0), 0),
        0,
      );
      const filesWithKnownSize = Object.values(folderStructure).reduce(
        (count, folder) =>
          count + folder.files.filter((f) => f.key && (f.size || 0) > 0).length,
        0,
      );
      const filesWithUnknownSize = fileKeys.length - filesWithKnownSize;
      const hasReliableSizeInfo = totalPayloadSize > 0;

      // For small datarooms, process in a single batch (check both count AND size)
      const fitsInSingleBatch =
        fileKeys.length <= MAX_FILES_PER_BATCH &&
        (!hasReliableSizeInfo || totalPayloadSize <= MAX_ZIP_SIZE_BYTES);

      if (fitsInSingleBatch) {
        logger.info("Processing as single batch", {
          jobId,
          fileCount: fileKeys.length,
          totalSizeMB: Math.round(totalPayloadSize / (1024 * 1024)),
          filesWithKnownSize,
          filesWithUnknownSize,
        });

        const result = await processDownloadBatch({
          lambdaClient,
          storageConfig,
          folderStructure,
          fileKeys,
          sourceBucket: resolvedSourceBucket,
          watermarkConfig,
          dataroomName,
          zipPartNumber: 1,
          totalParts: 1,
          zipFileName: generateZipFileName(
            dataroomName,
            downloadTimestamp,
            undefined,
            folderName,
          ),
        });

        // Update job with completed status
        const completedJob = await downloadJobStore.updateJob(jobId, {
          status: "COMPLETED",
          processedFiles: fileKeys.length,
          progress: 100,
          downloadUrls: [result.downloadUrl],
          downloadS3Keys: result.s3KeyInfo ? [result.s3KeyInfo] : undefined,
          completedAt: new Date().toISOString(),
          expiresAt: new Date(
            Date.now() + 3 * 24 * 60 * 60 * 1000,
          ).toISOString(), // 3 days
        });

        if (emailNotification && emailAddress && completedJob) {
          await sendEmailNotification({
            emailAddress,
            dataroomName,
            jobId,
            teamId,
            dataroomId,
            expiresAt: completedJob.expiresAt,
            linkId: payload.linkId,
          });
        }

        logger.info("Bulk download task completed successfully", {
          jobId,
          downloadUrls: [result.downloadUrl],
        });

        return {
          success: true,
          jobId,
          downloadUrls: [result.downloadUrl],
        };
      }

      // For large datarooms, split into batches
      logger.info("Processing as multiple batches", {
        jobId,
        fileCount: fileKeys.length,
        totalSizeMB: Math.round(totalPayloadSize / (1024 * 1024)),
        filesWithKnownSize,
        filesWithUnknownSize,
        unknownSizeEstimateMB: Math.round(
          UNKNOWN_FILE_SIZE_ESTIMATE / (1024 * 1024),
        ),
        maxFilesPerBatch: MAX_FILES_PER_BATCH,
        maxSizePerBatch: `${MAX_ZIP_SIZE_BYTES / (1024 * 1024)}MB`,
      });

      // Split files into batches
      const batches = splitFilesIntoBatches(folderStructure, fileKeys);
      const totalBatches = batches.length;
      const downloadUrls: string[] = [];
      const downloadS3Keys: { bucket: string; key: string; region: string }[] =
        [];

      logger.info("Created file batches", {
        jobId,
        totalBatches,
        batchDetails: batches.map((b, i) => ({
          batch: i + 1,
          files: b.fileKeys.length,
          knownSizeFiles: b.knownSizeFiles,
          unknownSizeFiles: b.unknownSizeFiles,
          knownSizeBytes: b.knownSizeBytes,
          knownSizeMB: Math.round(b.knownSizeBytes / (1024 * 1024)),
          estimatedSizeMB: Math.round(b.estimatedSizeBytes / (1024 * 1024)),
        })),
      });

      // Process each batch sequentially (to avoid Lambda concurrency issues)
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const batchNumber = i + 1;

        logger.info(`Processing batch ${batchNumber}/${totalBatches}`, {
          jobId,
          batchNumber,
          fileCount: batch.fileKeys.length,
          knownSizeMB: Math.round(batch.knownSizeBytes / (1024 * 1024)),
          estimatedSizeMB: Math.round(
            batch.estimatedSizeBytes / (1024 * 1024),
          ),
        });

        try {
          const result = await processDownloadBatch({
            lambdaClient,
            storageConfig,
            folderStructure: batch.folderStructure,
            fileKeys: batch.fileKeys,
            sourceBucket: resolvedSourceBucket,
            watermarkConfig,
            dataroomName,
            zipPartNumber: batchNumber,
            totalParts: totalBatches,
            zipFileName: generateZipFileName(
              dataroomName,
              downloadTimestamp,
              batchNumber,
              folderName,
            ),
          });

          downloadUrls.push(result.downloadUrl);
          if (result.s3KeyInfo) {
            downloadS3Keys.push(result.s3KeyInfo);
          }

          // Calculate progress
          const processedFiles = batches
            .slice(0, batchNumber)
            .reduce((sum, b) => sum + b.fileKeys.length, 0);
          const progress = Math.round((batchNumber / totalBatches) * 100);

          // Update job progress
          await downloadJobStore.updateJob(jobId, {
            processedFiles,
            progress,
          });

          logger.info(`Batch ${batchNumber} completed`, {
            jobId,
            batchNumber,
            downloadUrl: result.downloadUrl,
            progress,
          });
        } catch (batchError) {
          logger.error(`Batch ${batchNumber} failed`, {
            jobId,
            batchNumber,
            error:
              batchError instanceof Error
                ? batchError.message
                : String(batchError),
          });
          throw batchError;
        }
      }

      // Update job with completed status
      const completedJob = await downloadJobStore.updateJob(jobId, {
        status: "COMPLETED",
        processedFiles: fileKeys.length,
        progress: 100,
        downloadUrls,
        downloadS3Keys: downloadS3Keys.length > 0 ? downloadS3Keys : undefined,
        completedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(), // 3 days
      });

      if (emailNotification && emailAddress && completedJob) {
        await sendEmailNotification({
          emailAddress,
          dataroomName,
          jobId,
          teamId,
          dataroomId,
          expiresAt: completedJob.expiresAt,
          linkId: payload.linkId,
        });
      }

      logger.info("Bulk download task completed successfully", {
        jobId,
        totalBatches,
        downloadUrls,
      });

      return {
        success: true,
        jobId,
        downloadUrls,
      };
    } catch (error) {
      const isPermissionFailure = error instanceof DownloadNotPermittedError;
      const userMessage = isPermissionFailure
        ? error.userMessage
        : error instanceof Error
          ? error.message
          : String(error);

      logger.error("Bulk download task failed", {
        jobId,
        permissionFailure: isPermissionFailure,
        error: error instanceof Error ? error.message : String(error),
      });

      // Update job status to failed
      await downloadJobStore.updateJob(jobId, {
        status: "FAILED",
        error: userMessage,
      });

      // Permission failures aren't transient: don't waste a retry on them.
      if (isPermissionFailure) {
        return { success: false, jobId, downloadUrls: [] };
      }

      throw error;
    }
  },
});

interface ProcessDownloadBatchParams {
  lambdaClient: LambdaClient;
  storageConfig: StorageConfig;
  folderStructure: BulkDownloadFolderStructure;
  fileKeys: string[];
  sourceBucket: string;
  watermarkConfig?: BulkDownloadPayload["watermarkConfig"];
  dataroomName: string;
  zipPartNumber: number;
  totalParts: number;
  zipFileName: string;
  expirationHours?: number;
}

interface ProcessDownloadBatchResult {
  downloadUrl: string;
  s3KeyInfo?: { bucket: string; key: string; region: string };
}

async function processDownloadBatch({
  lambdaClient,
  storageConfig,
  folderStructure,
  fileKeys,
  sourceBucket,
  watermarkConfig,
  dataroomName,
  zipPartNumber,
  totalParts,
  zipFileName,
  expirationHours = 72,
}: ProcessDownloadBatchParams): Promise<ProcessDownloadBatchResult> {
  const command = new InvokeCommand({
    FunctionName: storageConfig.lambdaFunctionName,
    InvocationType: InvocationType.RequestResponse,
    Payload: JSON.stringify({
      sourceBucket,
      fileKeys,
      folderStructure,
      watermarkConfig: watermarkConfig || { enabled: false },
      zipPartNumber,
      totalParts,
      dataroomName,
      zipFileName,
      expirationHours,
    }),
  });

  const response = await lambdaClient.send(command);

  if (!response.Payload) {
    throw new Error("Lambda response payload is undefined or empty");
  }

  const decodedPayload = new TextDecoder().decode(response.Payload);
  const payload = JSON.parse(decodedPayload);

  if (payload.errorMessage) {
    throw new Error(`Lambda error: ${payload.errorMessage}`);
  }

  const body = JSON.parse(payload.body);

  let s3KeyInfo: { bucket: string; key: string; region: string } | undefined;
  try {
    s3KeyInfo = parseS3PresignedUrl(body.downloadUrl);
  } catch {
    // Non-fatal: fall back to stored presigned URL
  }

  return { downloadUrl: body.downloadUrl, s3KeyInfo };
}

interface FileBatch {
  folderStructure: BulkDownloadFolderStructure;
  fileKeys: string[];
  knownSizeBytes: number;
  estimatedSizeBytes: number;
  knownSizeFiles: number;
  unknownSizeFiles: number;
}

interface FileInfo {
  key: string;
  folderPath: string;
  size: number;
  file: BulkDownloadFolderStructure[string]["files"][number];
}

function splitFilesIntoBatches(
  folderStructure: BulkDownloadFolderStructure,
  fileKeys: string[],
): FileBatch[] {
  const batches: FileBatch[] = [];

  // Build a list of files with their info
  const filesWithInfo: FileInfo[] = [];
  const fileKeysSet = new Set(fileKeys);
  for (const [path, folder] of Object.entries(folderStructure)) {
    for (const file of folder.files) {
      if (file.key && fileKeysSet.has(file.key)) {
        filesWithInfo.push({
          key: file.key,
          folderPath: path,
          size: file.size || 0, // Default to 0 if size unknown
          file,
        });
      }
    }
  }

  // Check if we have size information for most files
  const filesWithSize = filesWithInfo.filter((f) => f.size > 0);
  const hasSizeInfo = filesWithSize.length > filesWithInfo.length * 0.5; // At least 50% have size

  if (hasSizeInfo) {
    // Size-based batching
    let currentBatch: FileInfo[] = [];
    let currentBatchSize = 0;

    for (const fileInfo of filesWithInfo) {
      const fileSize = fileInfo.size || UNKNOWN_FILE_SIZE_ESTIMATE; // Estimate for unknown sizes

      // If adding this file would exceed limit, start a new batch
      // Also enforce max file count per batch to avoid Lambda payload limits
      if (
        currentBatch.length > 0 &&
        (currentBatchSize + fileSize > MAX_ZIP_SIZE_BYTES ||
          currentBatch.length >= MAX_FILES_PER_BATCH)
      ) {
        batches.push(buildBatchFromFiles(currentBatch, folderStructure));
        currentBatch = [];
        currentBatchSize = 0;
      }

      currentBatch.push(fileInfo);
      currentBatchSize += fileSize;
    }

    // Don't forget the last batch
    if (currentBatch.length > 0) {
      batches.push(buildBatchFromFiles(currentBatch, folderStructure));
    }
  } else {
    // Fallback to count-based batching if no size info
    for (let i = 0; i < filesWithInfo.length; i += MAX_FILES_PER_BATCH) {
      const batchFiles = filesWithInfo.slice(i, i + MAX_FILES_PER_BATCH);
      batches.push(buildBatchFromFiles(batchFiles, folderStructure));
    }
  }

  return batches;
}

function buildBatchFromFiles(
  files: FileInfo[],
  folderStructure: BulkDownloadFolderStructure,
): FileBatch {
  const batchFolderStructure: BulkDownloadFolderStructure = {};
  const batchFileKeys: string[] = [];
  let knownSizeBytes = 0;
  let estimatedSizeBytes = 0;
  let knownSizeFiles = 0;
  let unknownSizeFiles = 0;

  for (const fileInfo of files) {
    batchFileKeys.push(fileInfo.key);
    if (fileInfo.size > 0) {
      knownSizeBytes += fileInfo.size;
      estimatedSizeBytes += fileInfo.size;
      knownSizeFiles += 1;
    } else {
      estimatedSizeBytes += UNKNOWN_FILE_SIZE_ESTIMATE;
      unknownSizeFiles += 1;
    }

    // Initialize folder if not exists in batch
    if (!batchFolderStructure[fileInfo.folderPath]) {
      batchFolderStructure[fileInfo.folderPath] = {
        name: folderStructure[fileInfo.folderPath].name,
        path: folderStructure[fileInfo.folderPath].path,
        files: [],
      };
    }

    batchFolderStructure[fileInfo.folderPath].files.push(fileInfo.file);
  }

  // Ensure all parent folders are included
  for (const path of Object.keys(batchFolderStructure)) {
    const pathParts = path.split("/").filter(Boolean);
    let currentPath = "";

    for (const part of pathParts) {
      currentPath += "/" + part;
      if (!batchFolderStructure[currentPath] && folderStructure[currentPath]) {
        batchFolderStructure[currentPath] = {
          name: folderStructure[currentPath].name,
          path: folderStructure[currentPath].path,
          files: [], // Empty files array for intermediate folders
        };
      }
    }
  }

  return {
    folderStructure: batchFolderStructure,
    fileKeys: batchFileKeys,
    knownSizeBytes,
    estimatedSizeBytes,
    knownSizeFiles,
    unknownSizeFiles,
  };
}

interface BuildDownloadContextParams {
  jobId: string;
  dataroomId: string;
  dataroomName: string;
  teamId: string;
  sourceContext: NonNullable<BulkDownloadPayload["sourceContext"]>;
}

interface BuildDownloadContextResult {
  folderStructure: BulkDownloadFolderStructure;
  fileKeys: string[];
  folderName?: string;
}

/**
 * Sentinel error thrown by the validation step when the link is no longer
 * permitted to download. The task's catch block converts it into a clean
 * "FAILED" job status with a user-facing message instead of a noisy stack.
 */
class DownloadNotPermittedError extends Error {
  constructor(public readonly userMessage: string) {
    super(userMessage);
    this.name = "DownloadNotPermittedError";
  }
}

/**
 * Re-validate the link/dataroom against the live DB before doing any work.
 * Defends against the time-of-check / time-of-use gap between the request
 * handler returning `202` and the trigger task actually running: a link
 * could have been archived, deleted, expired, or had download disabled
 * in that window.
 *
 * Returns the *live* values for fields the rest of the pipeline depends on
 * (`enableWatermark`, `permissionGroupId`) so we never trust the snapshot
 * the API put on the wire.
 */
async function revalidateDownloadContext(params: {
  jobId: string;
  dataroomId: string;
  teamId: string;
  type: "bulk" | "folder";
  linkId: string;
}): Promise<{
  enableWatermark: boolean;
  permissionGroupId: string | null;
}> {
  const { jobId, dataroomId, teamId, type, linkId } = params;

  await downloadJobStore.updateJob(jobId, { phase: "VALIDATING" });

  const link = await prisma.link.findUnique({
    where: { id: linkId },
    select: {
      id: true,
      teamId: true,
      allowDownload: true,
      isArchived: true,
      deletedAt: true,
      expiresAt: true,
      enableWatermark: true,
      permissionGroupId: true,
      dataroom: {
        select: { id: true, allowBulkDownload: true },
      },
    },
  });

  const NOT_PERMITTED = new DownloadNotPermittedError(
    "This download is no longer available. The link may have been archived, expired, or had its permissions changed.",
  );

  if (!link || !link.dataroom) throw NOT_PERMITTED;
  if (link.dataroom.id !== dataroomId) throw NOT_PERMITTED;
  if (link.teamId !== teamId) throw NOT_PERMITTED;
  if (!link.allowDownload) throw NOT_PERMITTED;
  if (link.isArchived) throw NOT_PERMITTED;
  if (link.deletedAt) throw NOT_PERMITTED;
  if (link.expiresAt && link.expiresAt < new Date()) throw NOT_PERMITTED;
  if (type === "bulk" && !link.dataroom.allowBulkDownload) throw NOT_PERMITTED;

  return {
    enableWatermark: !!link.enableWatermark,
    permissionGroupId: link.permissionGroupId ?? null,
  };
}

/**
 * Heavy work that used to live in the API handlers: re-validate the link,
 * load the relevant folders/documents/permissions, build the folder
 * structure and file list, persist `view.createMany` rows for analytics
 * and emit the Slack notification. Performed inside the trigger task so
 * the API can return a jobId immediately.
 */
async function buildDownloadContext({
  jobId,
  dataroomId,
  dataroomName,
  teamId,
  sourceContext,
}: BuildDownloadContextParams): Promise<BuildDownloadContextResult> {
  const {
    type,
    folderId,
    linkId,
    viewId,
    viewerId,
    viewerEmail,
    groupId,
    verified,
    notifySlack,
  } = sourceContext;

  if (type === "folder" && !folderId) {
    throw new Error("folderId is required for folder downloads");
  }

  // 1. Re-validate the link/dataroom against the live DB. We use the live
  //    `enableWatermark` and `permissionGroupId` from here on, ignoring
  //    any snapshots in `sourceContext`.
  const { enableWatermark, permissionGroupId } = await revalidateDownloadContext(
    { jobId, dataroomId, teamId, type, linkId },
  );

  // 2. Heavy DB work + tree building.
  await downloadJobStore.updateJob(jobId, { phase: "BUILDING" });

  // Load all folders for this dataroom – needed for hierarchy traversal and
  // path computation.
  const allDataroomFolders = await prisma.dataroomFolder.findMany({
    where: { dataroomId },
    select: { id: true, name: true, path: true, parentId: true },
  });

  let rootFolder:
    | { id: string; name: string; path: string; parentId: string | null }
    | undefined;

  let foldersInScope = allDataroomFolders;
  if (type === "folder") {
    rootFolder = allDataroomFolders.find((f) => f.id === folderId);
    if (!rootFolder) {
      throw new Error(`Folder ${folderId} not found for dataroom ${dataroomId}`);
    }
    const descendantIds = collectDescendantIds(folderId!, allDataroomFolders);
    foldersInScope = allDataroomFolders.filter(
      (f) => f.id === folderId || descendantIds.has(f.id),
    );
  }

  // DB-level prune: documents whose primary version is in VERCEL_BLOB
  // can never be bulk-downloaded, so don't even pull them off the wire.
  // We still re-check `type === "notion"` in memory because `type` is
  // nullable and Prisma's `not` operator treats NULL as a non-match.
  const documentsInScope = await prisma.dataroomDocument.findMany({
    where: {
      dataroomId,
      ...(type === "folder"
        ? { folderId: { in: foldersInScope.map((f) => f.id) } }
        : {}),
      document: {
        versions: {
          some: {
            isPrimary: true,
            storageType: { not: "VERCEL_BLOB" },
          },
        },
      },
    },
    select: {
      id: true,
      folderId: true,
      document: {
        select: {
          id: true,
          name: true,
          versions: {
            where: { isPrimary: true },
            select: {
              type: true,
              file: true,
              storageType: true,
              originalFile: true,
              numPages: true,
              contentType: true,
              fileSize: true,
            },
            take: 1,
          },
        },
      },
    },
  });

  // Apply per-group permissions (canDownload). We use the live
  // `permissionGroupId` from the link, not the snapshot in `sourceContext`.
  let effectiveFolders = foldersInScope;
  let effectiveDocuments = documentsInScope;
  const effectiveGroupId = groupId || permissionGroupId;

  if (effectiveGroupId) {
    let groupPermissions: { itemType: ItemType; itemId: string }[] = [];

    if (groupId) {
      groupPermissions = await prisma.viewerGroupAccessControls.findMany({
        where: { groupId, canDownload: true },
        select: { itemType: true, itemId: true },
      });
    } else if (permissionGroupId) {
      groupPermissions = await prisma.permissionGroupAccessControls.findMany({
        where: { groupId: permissionGroupId, canDownload: true },
        select: { itemType: true, itemId: true },
      });
    }

    const permittedFolderIds = new Set<string>();
    const permittedDocumentIds = new Set<string>();
    for (const p of groupPermissions) {
      if (p.itemType === ItemType.DATAROOM_FOLDER) {
        permittedFolderIds.add(p.itemId);
      } else if (p.itemType === ItemType.DATAROOM_DOCUMENT) {
        permittedDocumentIds.add(p.itemId);
      }
    }

    effectiveFolders = effectiveFolders.filter((f) =>
      permittedFolderIds.has(f.id),
    );
    effectiveDocuments = effectiveDocuments.filter((d) =>
      permittedDocumentIds.has(d.id),
    );
  }

  const { folderStructure, fileKeys, downloadableDocuments } =
    buildBulkDownloadStructure({
      fullFolders: type === "folder" ? foldersInScope : allDataroomFolders,
      includedFolders: effectiveFolders,
      includedDocuments: effectiveDocuments,
      enableWatermark,
      rootFolder:
        type === "folder" && rootFolder
          ? { id: rootFolder.id, name: rootFolder.name }
          : undefined,
    });

  logger.info("Built folder download context", {
    jobId,
    type,
    folderCount: effectiveFolders.length,
    documentCount: effectiveDocuments.length,
    downloadableDocuments: downloadableDocuments.length,
    fileKeys: fileKeys.length,
  });

  // Persist analytics rows.
  if (downloadableDocuments.length > 0) {
    const downloadType = type === "folder" ? "FOLDER" : "BULK";
    const includeDocumentsList =
      downloadableDocuments.length < DOCUMENT_LIST_METADATA_THRESHOLD;
    const summaryMetadata =
      type === "folder"
        ? {
            folderName: rootFolder!.name,
            folderPath: rootFolder!.path,
            documentCount: downloadableDocuments.length,
          }
        : {
            dataroomName,
            documentCount: downloadableDocuments.length,
          };
    const downloadMetadata = includeDocumentsList
      ? {
          ...summaryMetadata,
          documents: downloadableDocuments.map((doc) => ({
            id: doc.document.id,
            name: doc.document.name,
          })),
        }
      : summaryMetadata;

    await prisma.view.createMany({
      data: downloadableDocuments.map((doc) => ({
        viewType: "DOCUMENT_VIEW",
        documentId: doc.document.id!,
        linkId,
        dataroomId,
        groupId: groupId ?? null,
        dataroomViewId: viewId,
        viewerEmail: viewerEmail ?? null,
        downloadedAt: new Date(),
        downloadType,
        downloadMetadata,
        viewerId: viewerId ?? null,
        verified,
      })),
      skipDuplicates: true,
    });
  }

  // Slack notification (best-effort, mirrors prior API behaviour).
  if (notifySlack) {
    try {
      await notifyDocumentDownload({
        teamId,
        documentId: undefined,
        dataroomId,
        linkId,
        viewerEmail: viewerEmail ?? undefined,
        viewerId: viewerId ?? undefined,
        metadata:
          type === "folder"
            ? {
                folderName: rootFolder!.name,
                documentCount: downloadableDocuments.length,
                isFolderDownload: true,
              }
            : {
                documentCount: downloadableDocuments.length,
                isBulkDownload: true,
              },
      });
    } catch (err) {
      logger.warn("Slack notification failed", {
        jobId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    folderStructure,
    fileKeys,
    folderName: type === "folder" ? rootFolder!.name : undefined,
  };
}

async function sendEmailNotification({
  emailAddress,
  dataroomName,
  jobId,
  teamId,
  dataroomId,
  expiresAt,
  linkId,
}: {
  emailAddress: string;
  dataroomName: string;
  jobId: string;
  teamId: string;
  dataroomId: string;
  expiresAt?: string;
  linkId?: string;
}): Promise<void> {
  try {
    let downloadUrl: string;
    let isViewer = false;

    if (linkId) {
      const link = await prisma.link.findUnique({
        where: { id: linkId },
        select: { id: true, domainId: true, domainSlug: true, slug: true },
      });
      downloadUrl = link
        ? `${constructLinkUrl(link)}/downloads`
        : `${process.env.NEXT_PUBLIC_MARKETING_URL || "https://www.papermark.com"}/view/${linkId}/downloads`;
      isViewer = true;
    } else {
      const baseUrl = process.env.NEXTAUTH_URL || "https://app.papermark.com";
      downloadUrl = `${baseUrl}/datarooms/${dataroomId}/documents`;
    }

    await sendDownloadReadyEmail({
      to: emailAddress,
      dataroomName,
      downloadUrl,
      expiresAt,
      isViewer,
    });
    logger.info("Download ready email sent", {
      jobId,
      emailAddress,
      downloadUrl,
    });
  } catch (error) {
    logger.error("Failed to send download ready email", {
      jobId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
