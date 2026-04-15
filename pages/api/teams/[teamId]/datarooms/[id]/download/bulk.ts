import { NextApiRequest, NextApiResponse } from "next";

import { getTeamStorageConfigById } from "@/ee/features/storage/config";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { getServerSession } from "next-auth";

import {
  buildFolderNameMap,
  buildFolderPathsFromHierarchy,
} from "@/lib/dataroom/build-folder-hierarchy";
import prisma from "@/lib/prisma";
import { downloadJobStore } from "@/lib/redis-download-job-store";
import { bulkDownloadTask } from "@/lib/trigger/bulk-download";
import { CustomUser } from "@/lib/types";

export const config = {
  maxDuration: 60, // Reduced since we're just triggering the async task
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).end("Unauthorized");
  }

  const { teamId, id: dataroomId } = req.query as {
    teamId: string;
    id: string;
  };

  const userId = (session.user as CustomUser).id;

  if (req.method === "POST") {
    try {
      const teamAccess = await prisma.userTeam.findUnique({
        where: {
          userId_teamId: {
            userId: userId,
            teamId: teamId,
          },
        },
        select: { teamId: true },
      });

      if (!teamAccess) {
        return res.status(403).end("Unauthorized to access this team");
      }

      const dataroom = await prisma.dataroom.findUnique({
        where: {
          id: dataroomId,
          teamId: teamId,
        },
        select: {
          id: true,
          name: true,
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
                  name: true,
                  versions: {
                    where: { isPrimary: true },
                    select: {
                      type: true,
                      file: true,
                      storageType: true,
                      originalFile: true,
                      contentType: true,
                      fileSize: true,
                    },
                    take: 1,
                  },
                },
              },
            },
          },
        },
      });

      if (!dataroom) {
        return res.status(404).end("Dataroom not found");
      }

      let downloadFolders = dataroom.folders;
      let downloadDocuments = dataroom.documents;

      // Build folder paths from the parentId hierarchy (source of truth)
      // instead of using the materialized `path` field which can become stale
      // after folder renames/moves
      const computedPathMap = buildFolderPathsFromHierarchy(downloadFolders);
      const folderMap = buildFolderNameMap(downloadFolders, computedPathMap);

      // Construct folderStructure and fileKeys
      const folderStructure: {
        [key: string]: {
          name: string;
          path: string;
          files: { name: string; key: string; size?: number }[];
        };
      } = {};
      const fileKeys: string[] = [];

      const addFileToStructure = (
        path: string,
        fileName: string,
        fileKey: string,
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
          const folderInfo = folderMap.get(path) || {
            name: "Root",
            id: null,
          };
          folderStructure[path] = {
            name: folderInfo.name,
            path: path,
            files: [],
          };
        }
        folderStructure[path].files.push({
          name: fileName,
          key: fileKey,
          size: fileSize,
        });
        fileKeys.push(fileKey);
      };

      downloadDocuments
        .filter((doc) => !doc.folderId)
        .filter((doc) => doc.document.versions[0].type !== "notion")
        .filter((doc) => doc.document.versions[0].storageType !== "VERCEL_BLOB")
        .forEach((doc) =>
          addFileToStructure(
            "/",
            doc.document.name,
            doc.document.versions[0].originalFile ??
              doc.document.versions[0].file,
            doc.document.versions[0].fileSize
              ? Number(doc.document.versions[0].fileSize)
              : undefined,
          ),
        );

      // Pre-index documents by folderId for O(1) lookup per folder
      const docsByFolderId = new Map<string, typeof downloadDocuments>();
      for (const doc of downloadDocuments) {
        if (!doc.folderId) continue;
        const list = docsByFolderId.get(doc.folderId) ?? [];
        list.push(doc);
        docsByFolderId.set(doc.folderId, list);
      }

      downloadFolders.forEach((folder) => {
        // Use the computed path from parentId hierarchy instead of the stored path
        const folderPath = computedPathMap.get(folder.id) ?? folder.path;

        const folderDocs = (docsByFolderId.get(folder.id) ?? [])
          .filter((doc) => doc.document.versions[0].type !== "notion")
          .filter(
            (doc) => doc.document.versions[0].storageType !== "VERCEL_BLOB",
          );

        folderDocs &&
          folderDocs.forEach((doc) =>
            addFileToStructure(
              folderPath,
              doc.document.name,
              doc.document.versions[0].originalFile ??
                doc.document.versions[0].file,
              doc.document.versions[0].fileSize
                ? Number(doc.document.versions[0].fileSize)
                : undefined,
            ),
          );

        // If the folder is empty, ensure it's still added to the structure
        if (folderDocs && folderDocs.length === 0) {
          addFileToStructure(folderPath, "", "");
        }
      });

      if (fileKeys.length === 0) {
        return res.status(404).json({ error: "No files to download" });
      }

      // Get team-specific storage config
      const storageConfig = await getTeamStorageConfigById(teamId);

      // Get user email for notification
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true },
      });

      // Create download job in Redis
      const job = await downloadJobStore.createJob({
        type: "bulk",
        status: "PENDING",
        dataroomId: dataroom.id,
        dataroomName: dataroom.name,
        totalFiles: fileKeys.length,
        processedFiles: 0,
        progress: 0,
        teamId: teamId,
        userId: userId,
        emailNotification: !!user?.email,
        emailAddress: user?.email ?? undefined,
      });

      // Trigger the async bulk download task
      const handle = await bulkDownloadTask.trigger(
        {
          jobId: job.id,
          dataroomId: dataroom.id,
          dataroomName: dataroom.name,
          teamId: teamId,
          folderStructure: folderStructure,
          fileKeys: fileKeys,
          sourceBucket: storageConfig.bucket,
          watermarkConfig: { enabled: false },
          userId: userId,
          emailNotification: !!user?.email,
          emailAddress: user?.email ?? undefined,
        },
        {
          idempotencyKey: job.id,
          tags: [
            `team_${teamId}`,
            `dataroom_${dataroom.id}`,
            `job_${job.id}`,
            `user_${userId}`,
          ],
        },
      );

      // Update job with trigger run ID
      await downloadJobStore.updateJob(job.id, {
        triggerRunId: handle.id,
      });

      // Return job ID immediately (async response)
      return res.status(202).json({
        jobId: job.id,
        status: "PENDING",
        message: "Download started. You will be notified when ready.",
      });
    } catch (error) {
      console.error("Error starting bulk download:", error);
      return res.status(500).json({
        message: "Internal Server Error",
        error: (error as Error).message,
      });
    }
  } else {
    // We only allow POST requests
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
