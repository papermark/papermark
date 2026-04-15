import { logger, task } from "@trigger.dev/sdk";

import { getTeamStorageConfigById } from "@/ee/features/storage/config";
import { InvocationType, InvokeCommand } from "@aws-sdk/client-lambda";
import { getLambdaClientForTeam } from "@/lib/files/aws-client";
import { sendDownloadReadyEmail } from "@/lib/emails/send-download-ready-email";
import { parseS3PresignedUrl } from "@/lib/files/bulk-download-presign";
import prisma from "@/lib/prisma";
import { downloadJobStore } from "@/lib/redis-download-job-store";
import { constructLinkUrl } from "@/lib/utils/link-url";

// Maximum files per batch (Lambda payload limit)
const MAX_FILES_PER_BATCH = 500;
// Maximum size for a single ZIP file (500MB to stay within Lambda's 15min timeout)
// Lambda needs time to: read from S3 + apply watermarks + create ZIP + upload to S3
const MAX_ZIP_SIZE_BYTES = 500 * 1024 * 1024;

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

export type BulkDownloadPayload = {
  jobId: string;
  dataroomId: string;
  dataroomName: string;
  teamId: string;
  folderStructure: {
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
  fileKeys: string[];
  sourceBucket: string;
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
      folderStructure,
      fileKeys,
      sourceBucket,
      watermarkConfig,
      viewId,
      viewerEmail,
      emailNotification,
      emailAddress,
      folderName,
    } = payload;

    logger.info("Starting bulk download task", {
      jobId,
      dataroomId,
      dataroomName,
      totalFiles: fileKeys.length,
    });

    // Generate timestamp once for all parts of this download
    const downloadTimestamp = generateTimestamp();

    try {
      // Update job status to processing
      await downloadJobStore.updateJob(jobId, {
        status: "PROCESSING",
        processedFiles: 0,
        progress: 0,
      });

      // Calculate total size from folder structure for batch decisions
      const totalPayloadSize = Object.values(folderStructure).reduce(
        (sum, folder) =>
          sum +
          folder.files.reduce((fSum, file) => fSum + (file.size || 0), 0),
        0,
      );
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
        });

        const result = await processDownloadBatch({
          teamId,
          folderStructure,
          fileKeys,
          sourceBucket,
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
          sizeBytes: b.totalSize,
          sizeMB: Math.round(b.totalSize / (1024 * 1024)),
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
        });

        try {
          const result = await processDownloadBatch({
            teamId,
            folderStructure: batch.folderStructure,
            fileKeys: batch.fileKeys,
            sourceBucket,
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
      logger.error("Bulk download task failed", {
        jobId,
        error: error instanceof Error ? error.message : String(error),
      });

      // Update job status to failed
      await downloadJobStore.updateJob(jobId, {
        status: "FAILED",
        error: error instanceof Error ? error.message : String(error),
      });

      throw error;
    }
  },
});

interface ProcessDownloadBatchParams {
  teamId: string;
  folderStructure: BulkDownloadPayload["folderStructure"];
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
  teamId,
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
  const [client, storageConfig] = await Promise.all([
    getLambdaClientForTeam(teamId),
    getTeamStorageConfigById(teamId),
  ]);

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

  const response = await client.send(command);

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
  folderStructure: BulkDownloadPayload["folderStructure"];
  fileKeys: string[];
  totalSize: number;
}

interface FileInfo {
  key: string;
  folderPath: string;
  size: number;
  file: BulkDownloadPayload["folderStructure"][string]["files"][number];
}

function splitFilesIntoBatches(
  folderStructure: BulkDownloadPayload["folderStructure"],
  fileKeys: string[],
): FileBatch[] {
  const batches: FileBatch[] = [];

  // Build a list of files with their info
  const filesWithInfo: FileInfo[] = [];
  for (const [path, folder] of Object.entries(folderStructure)) {
    for (const file of folder.files) {
      if (file.key && fileKeys.includes(file.key)) {
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
      const fileSize = fileInfo.size || 10 * 1024 * 1024; // Estimate 10MB for unknown sizes

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
  folderStructure: BulkDownloadPayload["folderStructure"],
): FileBatch {
  const batchFolderStructure: BulkDownloadPayload["folderStructure"] = {};
  const batchFileKeys: string[] = [];
  let totalSize = 0;

  for (const fileInfo of files) {
    batchFileKeys.push(fileInfo.key);
    totalSize += fileInfo.size || 0;

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
    totalSize,
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
