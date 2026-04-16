import { createHash } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  mkdtempSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import {
  getFreezeArchiveConfig,
  getTeamStorageConfigById,
} from "@/ee/features/storage/config";
import { InvocationType, InvokeCommand } from "@aws-sdk/client-lambda";
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { logger, metadata, task } from "@trigger.dev/sdk/v3";
import archiver from "archiver";
import Bottleneck from "bottleneck";

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
  if (s.includes(",") || s.includes("\n") || s.includes("\r") || s.includes('"')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function csvRow(fields: (string | number | null | undefined)[]): string {
  return fields.map(escapeCsvField).join(",");
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
    const documentsZipS3Keys: { bucket: string; key: string; region: string }[] =
      [];
    if (fileKeys.length > 0) {
      metadata.set("progress", 0.1);
      metadata.set("text", "Creating document archive...");

      const timestamp = new Date()
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\.\d{3}/, "");

      const [lambdaClient, storageConfig] = await Promise.all([
        getLambdaClientForTeam(teamId),
        getTeamStorageConfigById(teamId),
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

        logger.info(`Document batch ${batchNumber}/${totalBatches} completed`, {
          s3Key: s3KeyInfo.key,
          bucket: s3KeyInfo.bucket,
        });
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

    // Use a temp directory for all disk I/O, cleaned up at the end
    const tmpDir = mkdtempSync(join(tmpdir(), "freeze-archive-"));

    try {
      // Step 4: Download documents zip(s) from S3 directly, computing SHA-256 on the fly
      const documentFiles: { name: string; path: string; hash: string }[] = [];
      const teamStorageConfig = await getTeamStorageConfigById(teamId);
      for (let i = 0; i < documentsZipS3Keys.length; i++) {
        const s3Key = documentsZipS3Keys[i];
        const downloadClient = new S3Client({
          region: s3Key.region,
          credentials: {
            accessKeyId: teamStorageConfig.accessKeyId,
            secretAccessKey: teamStorageConfig.secretAccessKey,
          },
        });

        const getResponse = await downloadClient.send(
          new GetObjectCommand({ Bucket: s3Key.bucket, Key: s3Key.key }),
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
        const filePath = join(tmpDir, name);
        const hash = createHash("sha256");
        const writeStream = createWriteStream(filePath);

        await pipeline(
          getResponse.Body as Readable,
          async function* (source) {
            for await (const chunk of source) {
              hash.update(chunk);
              yield chunk;
            }
          },
          writeStream,
        );

        const fileHash = hash.digest("hex");
        const fileSize = statSync(filePath).size;
        documentFiles.push({ name, path: filePath, hash: fileHash });
        logger.info(`Documents zip streamed to disk (part ${i + 1})`, {
          size: fileSize,
        });
      }

      // Step 5: Build final archive on disk with MANIFEST.sha256
      const manifestEntries: { hash: string; path: string }[] = [];
      const archivePath = join(tmpDir, "freeze-archive.zip");

      await new Promise<void>((resolve, reject) => {
        const output = createWriteStream(archivePath);
        const archive = archiver("zip", { zlib: { level: 6 } });

        output.on("close", resolve);
        archive.on("error", reject);
        archive.pipe(output);

        for (const { name, path: filePath, hash } of documentFiles) {
          archive.file(filePath, { name });
          manifestEntries.push({ hash, path: name });
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
        const manifestBuffer = Buffer.from(manifestContent, "utf-8");
        archive.append(manifestBuffer, { name: "MANIFEST.sha256" });

        archive.finalize();
      });

      const archiveSize = statSync(archivePath).size;
      logger.info("Final archive written to disk", { size: archiveSize });

      metadata.set("progress", 0.8);
      metadata.set("text", "Computing archive hash...");

      // Step 6: Compute archive hash by streaming from disk
      const archiveHash = await new Promise<string>((resolve, reject) => {
        const hash = createHash("sha256");
        const stream = createReadStream(archivePath);
        stream.on("data", (chunk) => hash.update(chunk));
        stream.on("end", () => resolve(hash.digest("hex")));
        stream.on("error", reject);
      });
      logger.info("Archive hash computed", { archiveHash });

      metadata.set("progress", 0.85);
      metadata.set("text", "Uploading archive...");

      // Step 7: Upload to S3 from disk stream
      const safeName = dataroomName.replace(/[^a-zA-Z0-9]/g, "_");
      const uploadTimestamp = new Date().toISOString().split("T")[0];
      const s3Key = `freeze-archives/${safeName}-${nanoid()}-${uploadTimestamp}.zip`;

      const archiveConfig = getFreezeArchiveConfig();
      const s3Client = new S3Client({
        region: archiveConfig.region,
        credentials: {
          accessKeyId: archiveConfig.accessKeyId,
          secretAccessKey: archiveConfig.secretAccessKey,
        },
      });

      await s3Client.send(
        new PutObjectCommand({
          Bucket: archiveConfig.bucket,
          Key: s3Key,
          Body: createReadStream(archivePath),
          ContentType: "application/zip",
          ContentLength: archiveSize,
          ContentDisposition: `attachment; filename="${safeName}-freeze-archive.zip"`,
          ChecksumSHA256: Buffer.from(archiveHash, "hex").toString("base64"),
        }),
      );

      logger.info("Archive uploaded to S3", {
        bucket: archiveConfig.bucket,
        key: s3Key,
        size: archiveSize,
      });

      // Step 8: Save archive S3 key and hash to the dataroom record
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

      return {
        success: true,
        s3Key,
        archiveHash,
      };
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  },
});

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

  const filesWithSize = filesWithInfo.filter((f) => f.size > 0);
  const hasSizeInfo = filesWithSize.length > filesWithInfo.length * 0.5;

  if (hasSizeInfo) {
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
  } else {
    for (let i = 0; i < filesWithInfo.length; i += MAX_FILES_PER_BATCH) {
      const batchFiles = filesWithInfo.slice(i, i + MAX_FILES_PER_BATCH);
      batches.push(buildBatchFromFiles(batchFiles, folderStructure));
    }
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
