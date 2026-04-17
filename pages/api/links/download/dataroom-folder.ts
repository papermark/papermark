import { NextApiRequest, NextApiResponse } from "next";

import { getTeamStorageConfigById } from "@/ee/features/storage/config";
import { ItemType, ViewType } from "@prisma/client";

import { verifyDataroomSessionInPagesRouter } from "@/lib/auth/dataroom-auth";
import {
  buildFolderPathsFromHierarchy,
  collectDescendantIds,
} from "@/lib/dataroom/build-folder-hierarchy";
import { notifyDocumentDownload } from "@/lib/integrations/slack/events";
import prisma from "@/lib/prisma";
import { downloadJobStore } from "@/lib/redis-download-job-store";
import { bulkDownloadTask } from "@/lib/trigger/bulk-download";
import { safeSlugify } from "@/lib/utils";
import { getIpAddress } from "@/lib/utils/ip";

export const config = {
  maxDuration: 60,
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  try {
    const { folderId, dataroomId, viewId, linkId, emailNotification } =
      req.body as {
        folderId: string;
        dataroomId: string;
        viewId: string;
        linkId: string;
        emailNotification?: boolean;
      };
    if (!folderId) {
      return res
        .status(400)
        .json({ error: "folderId is required in request body" });
    }

    const view = await prisma.view.findUnique({
      where: {
        id: viewId,
        linkId: linkId,
        viewType: { equals: ViewType.DATAROOM_VIEW },
      },
      select: {
        id: true,
        viewedAt: true,
        viewerEmail: true,
        viewerId: true,
        verified: true,
        link: {
          select: {
            teamId: true,
            allowDownload: true,
            expiresAt: true,
            isArchived: true,
            deletedAt: true,
            enableWatermark: true,
            watermarkConfig: true,
            name: true,
            permissionGroupId: true,
          },
        },
        groupId: true,
      },
    });

    if (!view) {
      return res.status(404).json({ error: "Error downloading" });
    }

    const session = await verifyDataroomSessionInPagesRouter(
      req,
      linkId,
      dataroomId,
    );
    if (!session) {
      return res.status(401).json({ error: "Session required to download" });
    }

    // Verified session and email are only required when the viewer requested email notification
    if (emailNotification) {
      if (!view.viewerEmail) {
        return res.status(400).json({
          error:
            "Email is required to receive download notifications. Enter your email in the dataroom.",
        });
      }
      if (!session.verified) {
        return res.status(403).json({
          error:
            "Verify your email with the one-time code to receive a notification when the download is ready.",
        });
      }
    }

    if (!view.link.allowDownload) {
      return res.status(403).json({ error: "Error downloading" });
    }

    // if link is archived, we should not allow the download
    if (view.link.isArchived) {
      return res.status(403).json({ error: "Error downloading" });
    }

    // if link is deleted, we should not allow the download
    if (view.link.deletedAt) {
      return res.status(403).json({ error: "Error downloading" });
    }

    // if link is expired, we should not allow the download
    if (view.link.expiresAt && view.link.expiresAt < new Date()) {
      return res.status(403).json({ error: "Error downloading" });
    }

    // if viewedAt is longer than 23 hours ago, we should not allow the download
    if (
      view.viewedAt &&
      view.viewedAt < new Date(Date.now() - 23 * 60 * 60 * 1000)
    ) {
      return res.status(403).json({ error: "Error downloading" });
    }

    const rootFolder = await prisma.dataroomFolder.findUnique({
      where: {
        id: folderId,
        dataroomId,
      },
      select: { id: true, name: true, path: true, parentId: true },
    });

    if (!rootFolder) {
      return res.status(404).json({ error: "Folder not found" });
    }

    // Fetch all folders in this dataroom so we can traverse the parentId
    // hierarchy. This avoids relying on the materialized `path` field which
    // can become stale after renames/moves.
    const allDataroomFolders = await prisma.dataroomFolder.findMany({
      where: { dataroomId },
      select: { id: true, name: true, path: true, parentId: true },
    });

    // Collect descendants via parentId chain (source of truth)
    const descendantIds = collectDescendantIds(
      rootFolder.id,
      allDataroomFolders,
    );
    const subfolders = allDataroomFolders.filter((f) =>
      descendantIds.has(f.id),
    );

    // Keep the full (unfiltered) folder list for path computation below.
    // Permission filtering may remove parent folders that only have canView
    // (not canDownload), which would break child path computation.
    const fullFolders = [rootFolder, ...subfolders];
    let allFolders = [...fullFolders];
    let allDocuments = await prisma.dataroomDocument.findMany({
      where: {
        dataroomId,
        folderId: {
          in: allFolders.map((f) => f.id),
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

    // Check permissions based on groupId (ViewerGroup) or permissionGroupId (PermissionGroup)
    const effectiveGroupId = view.groupId || view.link.permissionGroupId;

    if (effectiveGroupId) {
      let groupPermissions: any[] = [];

      if (view.groupId) {
        // This is a ViewerGroup (legacy behavior)
        groupPermissions = await prisma.viewerGroupAccessControls.findMany({
          where: { groupId: view.groupId, canDownload: true },
        });
      } else if (view.link.permissionGroupId) {
        // This is a PermissionGroup (new behavior)
        groupPermissions = await prisma.permissionGroupAccessControls.findMany({
          where: { groupId: view.link.permissionGroupId, canDownload: true },
        });
      }

      const permittedFolderIds = new Set(
        groupPermissions
          .filter(
            (permission) => permission.itemType === ItemType.DATAROOM_FOLDER,
          )
          .map((permission) => permission.itemId),
      );
      const permittedDocumentIds = new Set(
        groupPermissions
          .filter(
            (permission) => permission.itemType === ItemType.DATAROOM_DOCUMENT,
          )
          .map((permission) => permission.itemId),
      );

      allFolders = allFolders.filter((folder) =>
        permittedFolderIds.has(folder.id),
      );
      allDocuments = allDocuments.filter((doc) =>
        permittedDocumentIds.has(doc.id),
      );
    }

    // Build folder paths from the FULL (unfiltered) folder hierarchy so that
    // parent folders removed by permission filtering are still present in the
    // path map, producing correct child paths (e.g. "/legal/contracts" instead
    // of just "/contracts").
    const computedPathMap = buildFolderPathsFromHierarchy(fullFolders);

    // Compute the root folder's path from the hierarchy
    const computedRootPath =
      computedPathMap.get(rootFolder.id) ?? rootFolder.path;

    const folderStructure: {
      [key: string]: {
        name: string;
        path: string;
        files: {
          name: string;
          key: string;
          type?: string;
          numPages?: number;
          needsWatermark?: boolean;
          size?: number;
        }[];
      };
    } = {};

    const fileKeys: string[] = [];

    const addFileToStructure = (
      computedFolderPath: string,
      rootFolderInfo: { name: string; computedPath: string },
      fileName: string,
      fileKey: string,
      fileType?: string,
      numPages?: number,
      fileSize?: number,
    ) => {
      let relativePath = "";
      if (computedFolderPath !== rootFolderInfo.computedPath) {
        const escapedRoot = rootFolderInfo.computedPath.replace(
          /[.*+?^${}()|[\]\\]/g,
          "\\$&",
        );
        const pathRegex = new RegExp(`^${escapedRoot}/(.*)$`);
        const match = computedFolderPath.match(pathRegex);
        relativePath = match ? match[1] : "";
      }

      const pathParts = [safeSlugify(rootFolderInfo.name)];
      if (relativePath) {
        pathParts.push(...relativePath.split("/").filter(Boolean));
      }

      let currentPath = "";
      for (const part of pathParts) {
        currentPath += "/" + part;
        if (!folderStructure[currentPath]) {
          folderStructure[currentPath] = {
            name: part,
            path: currentPath,
            files: [],
          };
        }
      }

      if (fileName && fileKey) {
        const needsWatermark =
          view.link.enableWatermark &&
          (fileType === "pdf" || fileType === "image");

        folderStructure[currentPath].files.push({
          name: fileName,
          key: fileKey,
          type: fileType,
          numPages: numPages,
          needsWatermark: needsWatermark ?? undefined,
          size: fileSize,
        });
        fileKeys.push(fileKey);
      }
    };

    const rootFolderInfo = {
      name: rootFolder.name,
      computedPath: computedRootPath,
    };

    // Pre-index documents by folderId for O(1) lookup per folder
    const docsByFolderId = new Map<string, typeof allDocuments>();
    for (const doc of allDocuments) {
      if (!doc.folderId) continue;
      const list = docsByFolderId.get(doc.folderId) ?? [];
      list.push(doc);
      docsByFolderId.set(doc.folderId, list);
    }

    for (const folder of allFolders) {
      const folderPath = computedPathMap.get(folder.id) ?? folder.path;
      const docs = docsByFolderId.get(folder.id) ?? [];

      if (docs.length === 0) {
        addFileToStructure(
          folderPath,
          rootFolderInfo,
          "",
          "",
          undefined,
          undefined,
        );
        continue;
      }

      for (const doc of docs) {
        const version = doc.document.versions[0];
        if (
          !version ||
          version.type === "notion" ||
          version.storageType === "VERCEL_BLOB"
        )
          continue;

        // Use .file if watermark is enabled and document is PDF, otherwise use .originalFile
        const fileKey =
          view.link.enableWatermark && version.type === "pdf"
            ? version.file
            : (version.originalFile ?? version.file);
        addFileToStructure(
          folderPath,
          rootFolderInfo,
          doc.document.name,
          fileKey,
          version.type ?? undefined,
          version.numPages ?? undefined,
          version.fileSize ? Number(version.fileSize) : undefined,
        );
      }
    }

    const rootPath = "/" + safeSlugify(rootFolder.name);
    if (!folderStructure[rootPath]) {
      folderStructure[rootPath] = {
        name: safeSlugify(rootFolder.name),
        path: rootPath,
        files: [],
      };
    }

    // Don't update the DATAROOM_VIEW with downloadedAt for folder downloads
    // Only bulk downloads should update the DATAROOM_VIEW

    // Create individual document views for each document in the folder
    const downloadableDocuments = allDocuments.filter(
      (doc) =>
        doc.document.versions[0] &&
        doc.document.versions[0].type !== "notion" &&
        doc.document.versions[0].storageType !== "VERCEL_BLOB",
    );

    // Prepare metadata with folder name and document list
    const downloadMetadata = {
      folderName: rootFolder.name,
      folderPath: rootFolder.path,
      documents: downloadableDocuments.map((doc) => ({
        id: doc.document.id,
        name: doc.document.name,
      })),
    };

    await prisma.view.createMany({
      data: downloadableDocuments.map((doc) => ({
        viewType: "DOCUMENT_VIEW",
        documentId: doc.document.id,
        linkId: linkId,
        dataroomId: dataroomId,
        groupId: view.groupId,
        dataroomViewId: view.id,
        viewerEmail: view.viewerEmail,
        downloadedAt: new Date(),
        downloadType: "FOLDER",
        downloadMetadata: downloadMetadata,
        viewerId: view.viewerId,
        verified: view.verified,
      })),
      skipDuplicates: true,
    });

    if (view.link.teamId) {
      void notifyDocumentDownload({
        teamId: view.link.teamId,
        documentId: undefined,
        dataroomId,
        linkId,
        viewerEmail: view.viewerEmail ?? undefined,
        viewerId: view.viewerId ?? undefined,
        metadata: {
          folderName: rootFolder.name,
          documentCount: allDocuments.length,
          isFolderDownload: true,
        },
      }).catch((err) =>
        console.error("Error sending Slack notification:", err),
      );
    }

    const teamId = view.link.teamId!;
    const storageConfig = await getTeamStorageConfigById(teamId);
    const dataroom = await prisma.dataroom.findUnique({
      where: { id: dataroomId },
      select: { name: true },
    });
    const dataroomName = dataroom?.name ?? "Dataroom";
    const sendEmail =
      !!emailNotification && !!view.viewerEmail && !!session.verified;

    const job = await downloadJobStore.createJob({
      type: "folder",
      status: "PENDING",
      dataroomId,
      dataroomName,
      folderName: rootFolder.name,
      totalFiles: fileKeys.length,
      processedFiles: 0,
      progress: 0,
      teamId,
      userId: view.viewerId ?? view.viewerEmail ?? "viewer",
      linkId,
      viewerId: view.viewerId ?? undefined,
      viewerEmail: view.viewerEmail ?? undefined,
      emailNotification: sendEmail,
      emailAddress: sendEmail ? (view.viewerEmail ?? undefined) : undefined,
    });

    const handle = await bulkDownloadTask.trigger(
      {
        jobId: job.id,
        dataroomId,
        dataroomName,
        teamId,
        folderStructure,
        fileKeys,
        sourceBucket: storageConfig.bucket,
        watermarkConfig: view.link.enableWatermark
          ? {
              enabled: true,
              config: view.link.watermarkConfig,
              viewerData: {
                email: view.viewerEmail,
                date: new Date(
                  view.viewedAt ? view.viewedAt : new Date(),
                ).toLocaleDateString(),
                time: new Date(
                  view.viewedAt ? view.viewedAt : new Date(),
                ).toLocaleTimeString(),
                link: view.link.name,
                ipAddress: getIpAddress(req.headers),
              },
            }
          : { enabled: false },
        viewId: view.id,
        viewerId: view.viewerId ?? undefined,
        viewerEmail: view.viewerEmail ?? undefined,
        linkId,
        emailNotification: sendEmail,
        emailAddress: sendEmail ? (view.viewerEmail ?? undefined) : undefined,
        folderName: rootFolder.name,
      },
      {
        idempotencyKey: job.id,
        tags: [
          `team_${teamId}`,
          `dataroom_${dataroomId}`,
          `job_${job.id}`,
          `link_${linkId}`,
        ],
      },
    );

    await downloadJobStore.updateJob(job.id, { triggerRunId: handle.id });

    return res.status(202).json({
      jobId: job.id,
      status: "PENDING",
      message: sendEmail
        ? "Download started. We'll email you when it's ready."
        : "Download started. Check the downloads page for status.",
    });
  } catch (error) {
    console.error("Download error:", error);
    return res.status(500).json({
      message: "Internal Server Error",
      error: (error as Error).message,
    });
  }
}
