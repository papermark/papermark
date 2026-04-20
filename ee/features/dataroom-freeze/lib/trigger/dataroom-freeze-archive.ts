import { getTeamStorageConfigById } from "@/ee/features/storage/config";
import { InvocationType, InvokeCommand } from "@aws-sdk/client-lambda";
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { logger, metadata, task } from "@trigger.dev/sdk";
import archiver from "archiver";
import Bottleneck from "bottleneck";
import { createHash } from "node:crypto";
import { Readable, Transform } from "node:stream";

import { getLambdaClientForTeam } from "@/lib/files/aws-client";
import { parseS3PresignedUrl } from "@/lib/files/bulk-download-presign";
import prisma from "@/lib/prisma";
import { getViewPageDuration, getViewUserAgent } from "@/lib/tinybird";
import { nanoid } from "@/lib/utils";

const MAX_FILES_PER_BATCH = 500;
const MAX_ZIP_SIZE_BYTES = 500 * 1024 * 1024;

const tinybirdLimiter = new Bottleneck({
  maxConcurrent: 5,
  minTime: 200,
});

function escapeCsvField(field: string | number | null | undefined): string {
  if (field === null || field === undefined) return "";
  const s = String(field);
  if (
    s.includes(",") ||
    s.includes("\n") ||
    s.includes("\r") ||
    s.includes('"')
  ) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function csvRow(fields: (string | number | null | undefined)[]): string {
  return fields.map(escapeCsvField).join(",");
}

function appendStreamEntry(
  archive: ReturnType<typeof archiver>,
  source: Readable,
  name: string,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onEntry = (entry: { name?: string }) => {
      if (entry.name === name) {
        archive.off("entry", onEntry);
        archive.off("error", onErr);
        source.off("error", onErr);
        resolve();
      }
    };
    const onErr = (err: Error) => {
      archive.off("entry", onEntry);
      archive.off("error", onErr);
      source.off("error", onErr);
      reject(err);
    };
    archive.on("entry", onEntry);
    archive.on("error", onErr);
    source.on("error", onErr);
    archive.append(source, { name });
  });
}

export type FreezeArchivePayload = {
  dataroomId: string;
  dataroomName: string;
  teamId: string;
  userId: string;
  folderStructure: {
    [key: string]: {
      name: string;
      path: string;
      files: { name: string; key: string; size?: number }[];
    };
  };
  fileKeys: string[];
  sourceBucket: string;
};

export const dataroomFreezeArchiveTask = task({
  id: "dataroom-freeze-archive",
  retry: { maxAttempts: 2 },
  machine: { preset: "large-1x" },
  run: async (payload: FreezeArchivePayload) => {
    const {
      dataroomId,
      dataroomName,
      teamId,
      userId,
      folderStructure,
      fileKeys,
      sourceBucket,
    } = payload;

    logger.info("Starting dataroom freeze archive", {
      dataroomId,
      dataroomName,
      fileCount: fileKeys.length,
    });

    metadata.set("progress", 0.05);
    metadata.set("text", "Collecting documents...");

    // Step 1: Create the documents zip(s) via Lambda (direct invocation)
    const documentsZipS3Keys: {
      bucket: string;
      key: string;
      region: string;
    }[] = [];
    let archiveCompleted = false;
    const storageConfigPromise = getTeamStorageConfigById(teamId);
    try {
      if (fileKeys.length > 0) {
        metadata.set("progress", 0.1);
        metadata.set("text", "Creating document archive...");

        const timestamp = new Date()
          .toISOString()
          .replace(/[-:]/g, "")
          .replace(/\.\d{3}/, "");

        const [lambdaClient, storageConfig] = await Promise.all([
          getLambdaClientForTeam(teamId),
          storageConfigPromise,
        ]);

        const batches = splitFilesIntoBatches(folderStructure, fileKeys);
        const totalBatches = batches.length;

        logger.info("Document archive batches created", {
          totalBatches,
          batchDetails: batches.map((b, i) => ({
            batch: i + 1,
            files: b.fileKeys.length,
            sizeMB: Math.round(b.totalSize / (1024 * 1024)),
          })),
        });

        for (let i = 0; i < batches.length; i++) {
          const batch = batches[i];
          const batchNumber = i + 1;
          const isSingleBatch = totalBatches === 1;

          metadata.set(
            "text",
            isSingleBatch
              ? "Creating document archive..."
              : `Creating document archive (${batchNumber}/${totalBatches})...`,
          );

          const zipFileName = isSingleBatch
            ? `${dataroomName}-freeze-${timestamp}`
            : `${dataroomName}-freeze-${timestamp}-${String(batchNumber).padStart(3, "0")}`;

          const command = new InvokeCommand({
            FunctionName: storageConfig.lambdaFunctionName,
            InvocationType: InvocationType.RequestResponse,
            Payload: JSON.stringify({
              sourceBucket,
              fileKeys: batch.fileKeys,
              folderStructure: batch.folderStructure,
              watermarkConfig: { enabled: false },
              zipPartNumber: batchNumber,
              totalParts: totalBatches,
              dataroomName,
              zipFileName,
              expirationHours: 24,
            }),
          });

          const response = await lambdaClient.send(command);

          if (!response.Payload) {
            throw new Error(
              `Lambda response payload is undefined (batch ${batchNumber})`,
            );
          }

          const decodedPayload = new TextDecoder().decode(response.Payload);
          const lambdaResult = JSON.parse(decodedPayload);

          if (lambdaResult.errorMessage) {
            throw new Error(
              `Lambda error (batch ${batchNumber}): ${lambdaResult.errorMessage}`,
            );
          }

          const body = JSON.parse(lambdaResult.body);
          const s3KeyInfo = parseS3PresignedUrl(body.downloadUrl);
          documentsZipS3Keys.push(s3KeyInfo);

          const batchProgress = 0.1 + (0.3 * batchNumber) / totalBatches;
          metadata.set("progress", batchProgress);

          logger.info(
            `Document batch ${batchNumber}/${totalBatches} completed`,
            {
              s3Key: s3KeyInfo.key,
              bucket: s3KeyInfo.bucket,
            },
          );
        }
      }

      metadata.set("progress", 0.4);
      metadata.set("text", "Generating audit logs...");

      // Step 2: Generate audit logs CSV
      const auditCsv = await generateAuditLogsCsv(dataroomId, teamId);
      logger.info("Audit logs CSV generated", {
        rows: auditCsv.split("\n").length,
      });

      metadata.set("progress", 0.6);
      metadata.set("text", "Generating Q&A data...");

      // Step 3: Generate Q&A CSV
      const qaCsv = await generateQACsv(dataroomId);
      logger.info("Q&A CSV generated", { rows: qaCsv.split("\n").length });

      metadata.set("progress", 0.7);
      metadata.set("text", "Building final archive...");

      // Step 4-7: Stream documents + CSVs + MANIFEST through archiver → SHA-256 tap → multipart S3 upload.
      // No disk I/O: the final archive is never materialized locally, so size is bounded by S3 limits
      // (partSize × 10,000 parts), not the Trigger.dev machine's 10 GB disk.
      const safeName = dataroomName.replace(/[^a-zA-Z0-9]/g, "_");
      const uploadTimestamp = new Date().toISOString().split("T")[0];
      const s3Key = `freeze-archives/${safeName}-${nanoid()}-${uploadTimestamp}.zip`;

      const storageConfig = await storageConfigPromise;
      const s3Client = new S3Client({
        region: storageConfig.region,
        credentials: {
          accessKeyId: storageConfig.accessKeyId,
          secretAccessKey: storageConfig.secretAccessKey,
        },
      });

      // zlib.level 0 (store) because every entry is either already-compressed (inner zips)
      // or tiny text (CSVs / MANIFEST); deflate would waste CPU without shrinking the output.
      const archive = archiver("zip", { zlib: { level: 0 } });
      const archiveHasher = createHash("sha256");
      const hashTap = new Transform({
        transform(chunk, _enc, cb) {
          archiveHasher.update(chunk);
          cb(null, chunk);
        },
      });
      archive.pipe(hashTap);

      // 32 MiB parts → supports ~320 GiB before hitting the 10,000-part ceiling.
      // Bump to 128–256 MiB if multi-TB archives become routine.
      const upload = new Upload({
        client: s3Client,
        partSize: 32 * 1024 * 1024,
        queueSize: 4,
        params: {
          Bucket: storageConfig.archiveBucket,
          Key: s3Key,
          Body: hashTap,
          ContentType: "application/zip",
          ContentDisposition: `attachment; filename="${safeName}-freeze-archive.zip"`,
        },
      });

      // Registered after `upload` exists so archiver failures can also abort
      // any in-flight multipart parts rather than leaving them in S3.
      archive.on("error", (err: Error) => {
        logger.error("Archiver error", { error: err.message });
        hashTap.destroy(err);
        upload.abort().catch((abortErr) => {
          logger.error(
            "Failed to abort multipart upload after archiver error",
            {
              error:
                abortErr instanceof Error ? abortErr.message : String(abortErr),
            },
          );
        });
      });

      let uploadedBytes = 0;
      upload.on("httpUploadProgress", (p) => {
        if (typeof p.loaded === "number") uploadedBytes = p.loaded;
      });

      const uploadPromise = upload.done().catch((err) => {
        archive.destroy(err as Error);
        throw err;
      });

      try {
        const manifestEntries: { hash: string; path: string }[] = [];

        for (let i = 0; i < documentsZipS3Keys.length; i++) {
          const srcKey = documentsZipS3Keys[i];
          const downloadClient = new S3Client({
            region: srcKey.region,
            credentials: {
              accessKeyId: storageConfig.accessKeyId,
              secretAccessKey: storageConfig.secretAccessKey,
            },
          });

          const getResponse = await downloadClient.send(
            new GetObjectCommand({ Bucket: srcKey.bucket, Key: srcKey.key }),
          );

          if (!getResponse.Body) {
            throw new Error(
              `Empty S3 response body for documents zip (part ${i + 1})`,
            );
          }

          const name =
            documentsZipS3Keys.length === 1
              ? "documents.zip"
              : `documents-${String(i + 1).padStart(3, "0")}.zip`;

          const entryHasher = createHash("sha256");
          const entryTap = new Transform({
            transform(chunk, _enc, cb) {
              entryHasher.update(chunk);
              cb(null, chunk);
            },
          });
          const source = (getResponse.Body as Readable).pipe(entryTap);

          await appendStreamEntry(archive, source, name);
          manifestEntries.push({ hash: entryHasher.digest("hex"), path: name });

          const batchProgress =
            0.7 + (0.2 * (i + 1)) / documentsZipS3Keys.length;
          metadata.set("progress", batchProgress);
          metadata.set(
            "text",
            documentsZipS3Keys.length === 1
              ? "Uploading archive..."
              : `Uploading archive (${i + 1}/${documentsZipS3Keys.length})...`,
          );
          logger.info(`Documents zip streamed into archive (part ${i + 1})`, {
            name,
          });
        }

        const auditBuffer = Buffer.from(auditCsv, "utf-8");
        archive.append(auditBuffer, { name: "audit-log.csv" });
        manifestEntries.push({
          hash: createHash("sha256").update(auditBuffer).digest("hex"),
          path: "audit-log.csv",
        });

        const qaBuffer = Buffer.from(qaCsv, "utf-8");
        archive.append(qaBuffer, { name: "qa-pairs.csv" });
        manifestEntries.push({
          hash: createHash("sha256").update(qaBuffer).digest("hex"),
          path: "qa-pairs.csv",
        });

        const manifestContent = manifestEntries
          .map((e) => `${e.hash}  ${e.path}`)
          .join("\n");
        archive.append(Buffer.from(manifestContent, "utf-8"), {
          name: "MANIFEST.sha256",
        });

        metadata.set("progress", 0.9);
        metadata.set("text", "Finalizing upload...");

        await archive.finalize();
        await uploadPromise;
      } catch (err) {
        try {
          await upload.abort();
          logger.info("Aborted multipart S3 upload after error", {
            bucket: storageConfig.archiveBucket,
            key: s3Key,
          });
        } catch (abortErr) {
          logger.error("Failed to abort multipart upload", {
            error:
              abortErr instanceof Error ? abortErr.message : String(abortErr),
          });
        }
        throw err;
      }

      const archiveHash = archiveHasher.digest("hex");

      logger.info("Archive uploaded to S3", {
        bucket: storageConfig.archiveBucket,
        key: s3Key,
        size: uploadedBytes,
      });

      await prisma.dataroom.update({
        where: { id: dataroomId, teamId },
        data: {
          freezeArchiveUrl: s3Key,
          freezeArchiveHash: archiveHash,
        },
      });

      metadata.set("progress", 1.0);
      metadata.set("text", "Archive ready");
      metadata.set("archiveReady", true);
      metadata.set("archiveHash", archiveHash);

      logger.info("Dataroom freeze archive completed", {
        dataroomId,
        archiveHash,
        s3Key,
      });

      archiveCompleted = true;

      return {
        success: true,
        s3Key,
        archiveHash,
      };
    } finally {
      if (!archiveCompleted && documentsZipS3Keys.length > 0) {
        await cleanupIntermediateZipParts(teamId, documentsZipS3Keys);
      }
    }
  },
});

async function cleanupIntermediateZipParts(
  teamId: string,
  parts: { bucket: string; key: string; region: string }[],
): Promise<void> {
  try {
    const storageConfig = await getTeamStorageConfigById(teamId);

    // Group by bucket+region so we can batch deletes per S3 endpoint.
    const groups = new Map<
      string,
      { bucket: string; region: string; keys: string[] }
    >();
    for (const part of parts) {
      const groupKey = `${part.region}::${part.bucket}`;
      const existing = groups.get(groupKey);
      if (existing) {
        existing.keys.push(part.key);
      } else {
        groups.set(groupKey, {
          bucket: part.bucket,
          region: part.region,
          keys: [part.key],
        });
      }
    }

    for (const group of groups.values()) {
      const cleanupClient = new S3Client({
        region: group.region,
        credentials: {
          accessKeyId: storageConfig.accessKeyId,
          secretAccessKey: storageConfig.secretAccessKey,
        },
      });

      // DeleteObjectsCommand supports up to 1000 keys per request.
      for (let i = 0; i < group.keys.length; i += 1000) {
        const chunk = group.keys.slice(i, i + 1000);
        await cleanupClient.send(
          new DeleteObjectsCommand({
            Bucket: group.bucket,
            Delete: {
              Objects: chunk.map((Key) => ({ Key })),
              Quiet: true,
            },
          }),
        );
      }

      logger.info("Cleaned up intermediate document zip parts", {
        bucket: group.bucket,
        region: group.region,
        count: group.keys.length,
      });
    }
  } catch (cleanupError) {
    logger.error("Failed to cleanup intermediate document zip parts", {
      error:
        cleanupError instanceof Error
          ? cleanupError.message
          : String(cleanupError),
      partCount: parts.length,
    });
  }
}

async function generateAuditLogsCsv(
  dataroomId: string,
  teamId: string,
): Promise<string> {
  const dataroom = await prisma.dataroom.findUnique({
    where: { id: dataroomId, teamId },
    select: {
      team: { select: { pauseStartsAt: true, pauseEndsAt: true } },
    },
  });

  const { pauseStartsAt, pauseEndsAt } = dataroom?.team ?? {};

  const views = await prisma.view.findMany({
    where: { dataroomId },
    include: {
      link: { select: { name: true } },
      document: {
        select: {
          id: true,
          name: true,
          numPages: true,
          versions: {
            orderBy: { createdAt: "desc" },
            select: { versionNumber: true, createdAt: true, numPages: true },
          },
        },
      },
      agreementResponse: {
        include: {
          agreement: { select: { name: true } },
        },
      },
    },
    orderBy: { viewedAt: "desc" },
  });

  const filteredViews = views.filter(
    (v) => !isViewDuringPause(v.viewedAt, pauseStartsAt, pauseEndsAt),
  );

  const dataroomViews = filteredViews.filter(
    (v) => v.viewType === "DATAROOM_VIEW",
  );
  const documentViews = filteredViews.filter(
    (v) => v.viewType === "DOCUMENT_VIEW",
  );

  const rows: string[] = [];
  const headers = [
    "Dataroom Viewed At",
    "Dataroom Downloaded At",
    "Visitor Name",
    "Visitor Email",
    "Link Name",
    "Verified",
    "Agreement Accepted",
    "Agreement Name",
    "Agreement Accepted At",
    "Document Name",
    "Document Viewed At",
    "Document Downloaded At",
    "Total Visit Duration (s)",
    "Total Document Completion (%)",
    "Document Version",
    "Browser",
    "OS",
    "Device",
    "Country",
    "City",
  ];
  rows.push(csvRow(headers));

  for (const drView of dataroomViews) {
    // Fetch UA/geo from the dataroom view ID (stored in pm_click_events via recordLinkView)
    let browser = "",
      os = "",
      device = "",
      country = "",
      city = "";
    try {
      const ua = await tinybirdLimiter.schedule(() =>
        getViewUserAgent({ viewId: drView.id }),
      );
      browser = ua?.data[0]?.browser ?? "";
      os = ua?.data[0]?.os ?? "";
      device = ua?.data[0]?.device ?? "";
      country = ua?.data[0]?.country ?? "";
      city = ua?.data[0]?.city ?? "";
    } catch {
      // Tinybird may not have data
    }

    const docViews = documentViews.filter(
      (dv) => dv.dataroomViewId === drView.id,
    );

    if (docViews.length === 0) {
      rows.push(
        csvRow([
          drView.viewedAt.toISOString(),
          drView.downloadedAt?.toISOString() ?? "",
          drView.viewerName ?? "",
          drView.viewerEmail ?? "",
          drView.link?.name ?? "",
          drView.verified ? "Yes" : "",
          drView.agreementResponse ? "Yes" : "",
          drView.agreementResponse?.agreement.name ?? "",
          drView.agreementResponse?.createdAt.toISOString() ?? "",
          "",
          "",
          "",
          "",
          "",
          "",
          browser,
          os,
          device,
          country,
          city,
        ]),
      );
      continue;
    }

    for (const docView of docViews) {
      let durationSec = "";
      let completionRate = "";

      try {
        const duration = await tinybirdLimiter.schedule(() =>
          getViewPageDuration({
            documentId: docView.document?.id || "null",
            viewId: docView.id,
            since: 0,
          }),
        );
        const totalMs = duration.data.reduce(
          (sum, d) => sum + d.sum_duration,
          0,
        );
        durationSec = (totalMs / 1000).toFixed(1);

        const relevantVersion = docView.document?.versions.find(
          (v) => v.createdAt <= docView.viewedAt,
        );
        const numPages =
          relevantVersion?.numPages || docView.document?.numPages || 0;
        completionRate = numPages
          ? ((duration.data.length / numPages) * 100).toFixed(2) + "%"
          : "";
      } catch {
        // Tinybird may not have data for all views
      }

      const relevantVersion = docView.document?.versions.find(
        (v) => v.createdAt <= docView.viewedAt,
      );

      rows.push(
        csvRow([
          drView.viewedAt.toISOString(),
          drView.downloadedAt?.toISOString() ?? "",
          drView.viewerName ?? "",
          drView.viewerEmail ?? "",
          drView.link?.name ?? "",
          drView.verified ? "Yes" : "",
          drView.agreementResponse ? "Yes" : "",
          drView.agreementResponse?.agreement.name ?? "",
          drView.agreementResponse?.createdAt.toISOString() ?? "",
          docView.document?.name ?? "",
          docView.viewedAt.toISOString(),
          docView.downloadedAt?.toISOString() ?? "",
          durationSec,
          completionRate,
          String(
            relevantVersion?.versionNumber ??
              docView.document?.versions[0]?.versionNumber ??
              "",
          ),
          browser,
          os,
          device,
          country,
          city,
        ]),
      );
    }
  }

  return rows.join("\n");
}

async function generateQACsv(dataroomId: string): Promise<string> {
  const [faqItems, conversations] = await Promise.all([
    prisma.dataroomFaqItem.findMany({
      where: { dataroomId },
      include: {
        dataroomDocument: {
          include: {
            document: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.conversation.findMany({
      where: { dataroomId },
      include: {
        messages: {
          orderBy: { createdAt: "asc" },
          include: {
            user: { select: { name: true, email: true } },
            viewer: { select: { email: true } },
          },
        },
        dataroomDocument: {
          include: {
            document: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const rows: string[] = [];

  const conversationHeaders = [
    "Conversation ID",
    "Type",
    "Conversation Title",
    "Document",
    "Visibility",
    "Sender",
    "Sender Role",
    "Message",
    "Sent At",
    "Conversation Started At",
  ];
  rows.push(csvRow(conversationHeaders));

  for (const conversation of conversations) {
    for (const message of conversation.messages) {
      const senderEmail = message.user
        ? message.user.email || "Team Member"
        : message.viewer?.email || "Visitor";
      const senderRole = message.userId ? "Team Member" : "Visitor";

      rows.push(
        csvRow([
          conversation.id,
          "Conversation",
          conversation.title ?? "",
          conversation.dataroomDocument?.document.name ?? "",
          conversation.visibilityMode,
          senderEmail,
          senderRole,
          message.content,
          message.createdAt.toISOString(),
          conversation.createdAt.toISOString(),
        ]),
      );
    }
  }

  for (const item of faqItems) {
    rows.push(
      csvRow([
        item.sourceConversationId ?? "",
        "Published FAQ",
        item.title ?? "",
        item.dataroomDocument?.document.name ?? "",
        item.visibilityMode,
        "",
        "",
        `Q: ${item.editedQuestion}\nA: ${item.answer}`,
        item.createdAt.toISOString(),
        item.createdAt.toISOString(),
      ]),
    );
  }

  return rows.join("\n");
}

function isViewDuringPause(
  viewedAt: Date,
  pauseStartsAt?: Date | null,
  pauseEndsAt?: Date | null,
): boolean {
  if (!pauseStartsAt) return false;
  if (pauseEndsAt) {
    return viewedAt >= pauseStartsAt && viewedAt <= pauseEndsAt;
  }
  return viewedAt >= pauseStartsAt;
}

interface FileBatch {
  folderStructure: FreezeArchivePayload["folderStructure"];
  fileKeys: string[];
  totalSize: number;
}

interface FileInfo {
  key: string;
  folderPath: string;
  size: number;
  file: FreezeArchivePayload["folderStructure"][string]["files"][number];
}

function splitFilesIntoBatches(
  folderStructure: FreezeArchivePayload["folderStructure"],
  fileKeys: string[],
): FileBatch[] {
  const batches: FileBatch[] = [];

  const filesWithInfo: FileInfo[] = [];
  for (const [path, folder] of Object.entries(folderStructure)) {
    for (const file of folder.files) {
      if (file.key && fileKeys.includes(file.key)) {
        filesWithInfo.push({
          key: file.key,
          folderPath: path,
          size: file.size || 0,
          file,
        });
      }
    }
  }

  let currentBatch: FileInfo[] = [];
  let currentBatchSize = 0;

  for (const fileInfo of filesWithInfo) {
    const fileSize = fileInfo.size || 10 * 1024 * 1024;

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

  if (currentBatch.length > 0) {
    batches.push(buildBatchFromFiles(currentBatch, folderStructure));
  }

  return batches;
}

function buildBatchFromFiles(
  files: FileInfo[],
  folderStructure: FreezeArchivePayload["folderStructure"],
): FileBatch {
  const batchFolderStructure: FreezeArchivePayload["folderStructure"] = {};
  const batchFileKeys: string[] = [];
  let totalSize = 0;

  for (const fileInfo of files) {
    batchFileKeys.push(fileInfo.key);
    totalSize += fileInfo.size || 0;

    if (!batchFolderStructure[fileInfo.folderPath]) {
      batchFolderStructure[fileInfo.folderPath] = {
        name: folderStructure[fileInfo.folderPath].name,
        path: folderStructure[fileInfo.folderPath].path,
        files: [],
      };
    }

    batchFolderStructure[fileInfo.folderPath].files.push(fileInfo.file);
  }

  for (const path of Object.keys(batchFolderStructure)) {
    const pathParts = path.split("/").filter(Boolean);
    let currentPath = "";

    for (const part of pathParts) {
      currentPath += "/" + part;
      if (!batchFolderStructure[currentPath] && folderStructure[currentPath]) {
        batchFolderStructure[currentPath] = {
          name: folderStructure[currentPath].name,
          path: folderStructure[currentPath].path,
          files: [],
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
