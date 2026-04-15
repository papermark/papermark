import { NextApiRequest, NextApiResponse } from "next";

import { getTeamStorageConfigById } from "@/ee/features/storage/config";
import { ItemType, ViewType } from "@prisma/client";

import { verifyDataroomSessionInPagesRouter } from "@/lib/auth/dataroom-auth";
import {
  buildFolderNameMap,
  buildFolderPathsFromHierarchy,
} from "@/lib/dataroom/build-folder-hierarchy";
import { notifyDocumentDownload } from "@/lib/integrations/slack/events";
import prisma from "@/lib/prisma";
import { downloadJobStore } from "@/lib/redis-download-job-store";
import { bulkDownloadTask } from "@/lib/trigger/bulk-download";
import { getIpAddress } from "@/lib/utils/ip";

export const config = {
  maxDuration: 60,
};

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const { linkId, viewId, emailNotification } = req.body as {
    linkId: string;
    viewId: string;
    emailNotification?: boolean;
  };

  if (typeof linkId !== "string" || !linkId.trim()) {
    return res.status(400).json({ error: "linkId is required" });
  }

  if (typeof viewId !== "string" || !viewId.trim()) {
    return res.status(400).json({ error: "viewId is required" });
  }

  try {
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
        dataroom: {
          select: {
            id: true,
            name: true,
            teamId: true,
            allowBulkDownload: true,
            folders: {
              select: {
                id: true,
                name: true,
                path: true,
                parentId: true,
              },
            },
            documents: {
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
                        contentType: true,
                        numPages: true,
                        fileSize: true,
                      },
                      take: 1,
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!view) {
      return res.status(404).json({ error: "Error downloading" });
    }

    const dataroomId = view.dataroom?.id;
    const session = await verifyDataroomSessionInPagesRouter(
      req,
      linkId,
      dataroomId ?? "",
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

    if (view.link.deletedAt) {
      return res.status(403).json({ error: "Error downloading" });
    }

    // if link is expired, we should not allow the download
    if (view.link.expiresAt && view.link.expiresAt < new Date()) {
      return res.status(403).json({ error: "Error downloading" });
    }

    // if dataroom does not exist, we should not allow the download
    if (!view.dataroom) {
      return res.status(404).json({ error: "Error downloading" });
    }

    // if dataroom does not allow bulk download, we should not allow the download
    if (!view.dataroom.allowBulkDownload) {
      return res
        .status(403)
        .json({ error: "Bulk download is disabled for this dataroom" });
    }

    // if viewedAt is longer than 23 hours ago, we should not allow the download
    if (
      view.viewedAt &&
      view.viewedAt < new Date(Date.now() - 23 * 60 * 60 * 1000)
    ) {
      return res.status(403).json({ error: "Error downloading" });
    }

    // Build folder paths from the FULL folder list (source of truth) BEFORE
    // permission filtering. This ensures parent folders that only have canView
    // (not canDownload) are still included in the hierarchy so child paths are
    // computed correctly (e.g. "/legal/contracts" instead of just "/contracts").
    const allFolders = view.dataroom.folders;
    const computedPathMap = buildFolderPathsFromHierarchy(allFolders);
    const folderMap = buildFolderNameMap(allFolders, computedPathMap);

    let downloadFolders = allFolders;
    let downloadDocuments = view.dataroom.documents;

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
          where: {
            groupId: view.link.permissionGroupId,
            canDownload: true,
          },
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

      downloadFolders = downloadFolders.filter((folder) =>
        permittedFolderIds.has(folder.id),
      );
      downloadDocuments = downloadDocuments.filter((doc) =>
        permittedDocumentIds.has(doc.id),
      );
    }

    // Create individual document views for each document being downloaded
    const downloadableDocuments = downloadDocuments.filter(
      (doc) =>
        doc.document.versions[0] &&
        doc.document.versions[0].type !== "notion" &&
        doc.document.versions[0].storageType !== "VERCEL_BLOB",
    );

    // For bulk downloads, only store metadata if there are less than 100 documents
    const downloadMetadata =
      downloadableDocuments.length < 100
        ? {
            dataroomName: view.dataroom!.name,
            documentCount: downloadableDocuments.length,
            documents: downloadableDocuments.map((doc) => ({
              id: doc.document.id,
              name: doc.document.name,
            })),
          }
        : {
            dataroomName: view.dataroom!.name,
            documentCount: downloadableDocuments.length,
          };

    await prisma.view.createMany({
      data: downloadableDocuments.map((doc) => ({
        viewType: "DOCUMENT_VIEW",
        documentId: doc.document.id,
        linkId: linkId,
        dataroomId: view.dataroom!.id,
        groupId: view.groupId,
        dataroomViewId: view.id,
        viewerEmail: view.viewerEmail,
        downloadedAt: new Date(),
        downloadType: "BULK",
        downloadMetadata: downloadMetadata,
        viewerId: view.viewerId,
        verified: view.verified,
      })),
      skipDuplicates: true,
    });

    // Construct folderStructure and fileKeys
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
          size?: number; // File size in bytes
        }[];
      };
    } = {};
    const fileKeys: string[] = [];

    const addFileToStructure = (
      path: string,
      fileName: string,
      fileKey: string,
      fileType?: string,
      numPages?: number,
      fileSize?: number,
    ) => {
      const pathParts = path.split("/").filter(Boolean);
      let currentPath = "";

      // Add folder information for each level of the path
      pathParts.forEach((part, index) => {
        currentPath += "/" + part;
        const folderInfo = folderMap.get(currentPath);
        if (!folderStructure[currentPath]) {
          folderStructure[currentPath] = {
            name: folderInfo ? folderInfo.name : part,
            path: currentPath,
            files: [],
          };
        }
      });

      // Add the file to the leaf folder
      if (!folderStructure[path]) {
        const folderInfo = folderMap.get(path) || { name: "Root", id: null };
        folderStructure[path] = {
          name: folderInfo.name,
          path: path,
          files: [],
        };
      }

      const needsWatermark =
        view.link.enableWatermark &&
        (fileType === "pdf" || fileType === "image");

      folderStructure[path].files.push({
        name: fileName,
        key: fileKey,
        type: fileType,
        numPages: numPages,
        needsWatermark: needsWatermark ?? undefined,
        size: fileSize,
      });
      fileKeys.push(fileKey);
    };

    // Add root level documents
    downloadDocuments
      .filter((doc) => !doc.folderId)
      .filter((doc) => doc.document.versions[0].type !== "notion")
      .filter((doc) => doc.document.versions[0].storageType !== "VERCEL_BLOB")
      .forEach((doc) => {
        const fileKey =
          view.link.enableWatermark && doc.document.versions[0].type === "pdf"
            ? doc.document.versions[0].file
            : (doc.document.versions[0].originalFile ??
              doc.document.versions[0].file);

        addFileToStructure(
          "/",
          doc.document.name,
          fileKey,
          doc.document.versions[0].type ?? undefined,
          doc.document.versions[0].numPages ?? undefined,
          doc.document.versions[0].fileSize
            ? Number(doc.document.versions[0].fileSize)
            : undefined,
        );
      });

    // Pre-index documents by folderId for O(1) lookup per folder
    const docsByFolderId = new Map<string, typeof downloadDocuments>();
    for (const doc of downloadDocuments) {
      if (!doc.folderId) continue;
      const list = docsByFolderId.get(doc.folderId) ?? [];
      list.push(doc);
      docsByFolderId.set(doc.folderId, list);
    }

    // Add documents in folders
    downloadFolders.forEach((folder) => {
      // Use the computed path from parentId hierarchy instead of the stored path
      const folderPath = computedPathMap.get(folder.id) ?? folder.path;

      const folderDocs = (docsByFolderId.get(folder.id) ?? [])
        .filter((doc) => doc.document.versions[0].type !== "notion")
        .filter(
          (doc) => doc.document.versions[0].storageType !== "VERCEL_BLOB",
        );

      folderDocs &&
        folderDocs.forEach((doc) => {
          // Use .file if watermark is enabled and document is PDF, otherwise use .originalFile
          const fileKey =
            view.link.enableWatermark && doc.document.versions[0].type === "pdf"
              ? doc.document.versions[0].file
              : (doc.document.versions[0].originalFile ??
                doc.document.versions[0].file);

          addFileToStructure(
            folderPath,
            doc.document.name,
            fileKey,
            doc.document.versions[0].type ?? undefined,
            doc.document.versions[0].numPages ?? undefined,
            doc.document.versions[0].fileSize
              ? Number(doc.document.versions[0].fileSize)
              : undefined,
          );
        });

      // If the folder is empty, ensure it's still added to the structure
      if (folderDocs && folderDocs.length === 0) {
        addFileToStructure(folderPath, "", "");
      }
    });

    if (fileKeys.length === 0) {
      return res.status(404).json({ error: "No files to download" });
    }

    if (view.dataroom?.teamId) {
      void notifyDocumentDownload({
        teamId: view.dataroom.teamId,
        documentId: undefined,
        dataroomId: view.dataroom.id,
        linkId,
        viewerEmail: view.viewerEmail ?? undefined,
        viewerId: view.viewerId ?? undefined,
        metadata: {
          documentCount: downloadDocuments.length,
          isBulkDownload: true,
        },
      }).catch((err) =>
        console.error("Error sending Slack notification:", err),
      );
    }

    const teamId = view.dataroom!.teamId;
    const storageConfig = await getTeamStorageConfigById(teamId);
    const sendEmail =
      !!emailNotification && !!view.viewerEmail && !!session.verified;

    const job = await downloadJobStore.createJob({
      type: "bulk",
      status: "PENDING",
      dataroomId: view.dataroom!.id,
      dataroomName: view.dataroom!.name,
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
        dataroomId: view.dataroom!.id,
        dataroomName: view.dataroom!.name,
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
                date: (view.viewedAt
                  ? new Date(view.viewedAt)
                  : new Date()
                ).toLocaleDateString(),
                time: (view.viewedAt
                  ? new Date(view.viewedAt)
                  : new Date()
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
      },
      {
        idempotencyKey: job.id,
        tags: [
          `team_${teamId}`,
          `dataroom_${view.dataroom!.id}`,
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
        : "Download started. You can check status on the downloads page.",
    });
  } catch (error) {
    console.error("Error starting bulk download:", error);
    return res.status(500).json({
      message: "Internal Server Error",
    });
  }
}
