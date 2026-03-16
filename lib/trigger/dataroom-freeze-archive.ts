import { createHash } from "node:crypto";
import { PassThrough } from "node:stream";

import { logger, metadata, task } from "@trigger.dev/sdk/v3";
import { put } from "@vercel/blob";
import archiver from "archiver";
import Bottleneck from "bottleneck";

import prisma from "@/lib/prisma";
import {
  getViewPageDuration,
  getViewUserAgent,
  getViewUserAgent_v2,
} from "@/lib/tinybird";

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

    // Step 1: Create the documents zip via Lambda
    let documentsZipUrl: string | undefined;
    if (fileKeys.length > 0) {
      metadata.set("progress", 0.1);
      metadata.set("text", "Creating document archive...");

      const baseUrl = process.env.NEXTAUTH_URL || "https://app.papermark.com";
      const internalApiKey = process.env.INTERNAL_API_KEY;
      if (!internalApiKey) {
        throw new Error("INTERNAL_API_KEY is not configured");
      }

      const timestamp = new Date()
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\.\d{3}/, "");

      const response = await fetch(
        `${baseUrl}/api/jobs/process-download-batch`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${internalApiKey}`,
          },
          body: JSON.stringify({
            teamId,
            sourceBucket,
            fileKeys,
            folderStructure,
            watermarkConfig: { enabled: false },
            zipPartNumber: 1,
            totalParts: 1,
            dataroomName,
            zipFileName: `${dataroomName}-freeze-${timestamp}`,
            expirationHours: 24,
          }),
        },
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          `Document zip creation failed: ${errorData.error || response.statusText}`,
        );
      }

      const data = await response.json();
      documentsZipUrl = data.downloadUrl;
      logger.info("Documents zip created", { documentsZipUrl });
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

    // Step 4: Download the documents zip if we have one
    let documentsZipBuffer: Buffer | undefined;
    if (documentsZipUrl) {
      const zipResponse = await fetch(documentsZipUrl);
      if (!zipResponse.ok) {
        throw new Error("Failed to download documents zip");
      }
      documentsZipBuffer = Buffer.from(await zipResponse.arrayBuffer());
      logger.info("Documents zip downloaded", {
        size: documentsZipBuffer.length,
      });
    }

    // Step 5: Build final archive with MANIFEST.sha256
    const manifestEntries: { hash: string; path: string }[] = [];
    const sha256 = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");

    const archiveBuffer = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      const passthrough = new PassThrough();
      passthrough.on("data", (chunk: Buffer) => chunks.push(chunk));
      passthrough.on("end", () => resolve(Buffer.concat(chunks)));
      passthrough.on("error", reject);

      const archive = archiver("zip", { zlib: { level: 6 } });
      archive.on("error", reject);
      archive.pipe(passthrough);

      if (documentsZipBuffer) {
        archive.append(documentsZipBuffer, { name: "documents.zip" });
        manifestEntries.push({
          hash: sha256(documentsZipBuffer),
          path: "documents.zip",
        });
      }

      const auditBuffer = Buffer.from(auditCsv, "utf-8");
      archive.append(auditBuffer, { name: "audit-log.csv" });
      manifestEntries.push({
        hash: sha256(auditBuffer),
        path: "audit-log.csv",
      });

      const qaBuffer = Buffer.from(qaCsv, "utf-8");
      archive.append(qaBuffer, { name: "qa-pairs.csv" });
      manifestEntries.push({
        hash: sha256(qaBuffer),
        path: "qa-pairs.csv",
      });

      const manifestContent = manifestEntries
        .map((e) => `${e.hash}  ${e.path}`)
        .join("\n");
      const manifestBuffer = Buffer.from(manifestContent, "utf-8");
      archive.append(manifestBuffer, { name: "MANIFEST.sha256" });

      archive.finalize();
    });

    metadata.set("progress", 0.85);
    metadata.set("text", "Uploading archive...");

    // Step 6: Compute overall archive hash
    const archiveHash = sha256(archiveBuffer);
    logger.info("Archive hash computed", { archiveHash });

    // Step 7: Upload to Vercel Blob
    const timestamp = new Date().toISOString().split("T")[0];
    const safeName = dataroomName.replace(/[^a-zA-Z0-9]/g, "_");
    const filename = `freeze-archive-${safeName}-${timestamp}.zip`;

    const blob = await put(filename, archiveBuffer, {
      access: "public",
      addRandomSuffix: true,
      contentType: "application/zip",
    });

    logger.info("Archive uploaded to Vercel Blob", {
      url: blob.downloadUrl,
      size: archiveBuffer.length,
    });

    // Step 8: Save archive URL and hash to the dataroom record
    await prisma.dataroom.update({
      where: { id: dataroomId, teamId },
      data: {
        freezeArchiveUrl: blob.downloadUrl,
        freezeArchiveHash: archiveHash,
      },
    });

    metadata.set("progress", 1.0);
    metadata.set("text", "Archive ready");
    metadata.set("downloadUrl", blob.downloadUrl);
    metadata.set("archiveHash", archiveHash);

    logger.info("Dataroom freeze archive completed", {
      dataroomId,
      archiveHash,
      downloadUrl: blob.downloadUrl,
    });

    return {
      success: true,
      downloadUrl: blob.downloadUrl,
      archiveHash,
    };
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
          "",
          "",
          "",
          "",
          "",
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

      let browser = "",
        os = "",
        device = "",
        country = "",
        city = "";
      try {
        const ua = await tinybirdLimiter.schedule(async () => {
          const r = await getViewUserAgent({ viewId: docView.id });
          if (!r || r.rows === 0) {
            return getViewUserAgent_v2({
              documentId: docView.document?.id || "null",
              viewId: docView.id,
              since: 0,
            });
          }
          return r;
        });
        browser = ua?.data[0]?.browser ?? "";
        os = ua?.data[0]?.os ?? "";
        device = ua?.data[0]?.device ?? "";
        country = ua?.data[0]?.country ?? "";
        city = ua?.data[0]?.city ?? "";
      } catch {
        // Tinybird may not have data
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
  const faqItems = await prisma.dataroomFaqItem.findMany({
    where: { dataroomId },
    include: {
      dataroomDocument: {
        include: {
          document: { select: { name: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const rows: string[] = [];
  const headers = [
    "Title",
    "Question",
    "Original Question",
    "Answer",
    "Status",
    "Visibility",
    "Document",
    "Tags",
    "View Count",
    "Created At",
    "Updated At",
  ];
  rows.push(csvRow(headers));

  for (const item of faqItems) {
    rows.push(
      csvRow([
        item.title ?? "",
        item.editedQuestion,
        item.originalQuestion ?? "",
        item.answer,
        item.status,
        item.visibilityMode,
        item.dataroomDocument?.document.name ?? "",
        item.tags.join("; "),
        item.viewCount,
        item.createdAt.toISOString(),
        item.updatedAt.toISOString(),
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
