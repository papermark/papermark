import { NextApiRequest, NextApiResponse } from "next";

import { getTeamStorageConfigById } from "@/ee/features/storage/config";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { getServerSession } from "next-auth";

import { enforceDataroomMemberScope } from "@/lib/api/rbac/guard";
import { buildBulkDownloadStructure } from "@/lib/dataroom/build-bulk-download-structure";
import { collectDescendantIds } from "@/lib/dataroom/build-folder-hierarchy";
import prisma from "@/lib/prisma";
import { ratelimit } from "@/lib/redis";
import { downloadJobStore } from "@/lib/redis-download-job-store";
import { bulkDownloadTask } from "@/lib/trigger/bulk-download";
import { CustomUser } from "@/lib/types";

export const config = {
  maxDuration: 60, // Reduced since we're just triggering the async task
};

type DataroomFolderRow = {
  id: string;
  name: string;
  path: string;
  parentId: string | null;
};

/**
 * What this request is downloading. Resolved once from the request body and
 * then used for every downstream decision: which folders go into the zip,
 * which documents to query, whether the zip is rooted under a folder slug,
 * and how the job is labelled. `rootFolder` is set only for a folder-scoped
 * download, so its presence is the whole discriminant.
 */
type DownloadScope = {
  folders: DataroomFolderRow[];
  rootFolder?: { id: string; name: string };
};

/**
 * Returns `null` when a `folderId` was supplied that does not belong to this
 * dataroom — that lookup is what stops a caller scoping the download to
 * another dataroom's folder.
 */
function resolveDownloadScope(
  folderId: string | undefined,
  allFolders: DataroomFolderRow[],
): DownloadScope | null {
  if (!folderId) {
    return { folders: allFolders };
  }

  const root = allFolders.find((folder) => folder.id === folderId);
  if (!root) {
    return null;
  }

  const descendantIds = collectDescendantIds(folderId, allFolders);
  return {
    rootFolder: { id: root.id, name: root.name },
    folders: allFolders.filter(
      (folder) => folder.id === folderId || descendantIds.has(folder.id),
    ),
  };
}

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
      const { folderId } = (req.body ?? {}) as { folderId?: string };

      const teamAccess = await prisma.userTeam.findUnique({
        where: {
          userId_teamId: {
            userId: userId,
            teamId: teamId,
          },
        },
        select: { teamId: true, role: true },
      });

      if (!teamAccess) {
        return res.status(403).end("Unauthorized to access this team");
      }

      // Team membership alone would let a scoped member bulk-download a room
      // they were never assigned to.
      if (
        await enforceDataroomMemberScope({
          userId,
          teamId,
          dataroomId,
          res,
          role: teamAccess.role,
        })
      ) {
        return;
      }

      // Download is now on every row rather than a single page-header button,
      // so walking a folder list could otherwise fan out one Trigger.dev run
      // and one lambda batch per row. One key covers both scopes.
      const { success } = await ratelimit(5, "1 m").limit(
        `dataroom-download:${teamId}:${dataroomId}:${userId}`,
      );
      if (!success) {
        return res.status(429).json({
          error: "Too many download requests. Please try again shortly.",
          code: "RATE_LIMITED",
        });
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
        },
      });

      if (!dataroom) {
        return res.status(404).end("Dataroom not found");
      }

      const scope = resolveDownloadScope(folderId, dataroom.folders);
      if (!scope) {
        return res
          .status(404)
          .json({ error: "Folder not found in this dataroom" });
      }

      const documents = await prisma.dataroomDocument.findMany({
        where: {
          dataroomId: dataroom.id,
          ...(scope.rootFolder
            ? { folderId: { in: scope.folders.map((folder) => folder.id) } }
            : {}),
        },
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
      });

      // Admin bulk download: no permission filtering, no watermark.
      // `fullFolders` is the builder's hierarchy input and `includedFolders`
      // is the scope filter; they stay distinct because every path is resolved
      // against the whole tree before being rebased under `rootFolder`.
      const { folderStructure, fileKeys } = buildBulkDownloadStructure({
        fullFolders: dataroom.folders,
        includedFolders: scope.folders,
        includedDocuments: documents,
        enableWatermark: false,
        rootFolder: scope.rootFolder,
      });

      if (fileKeys.length === 0) {
        return res.status(404).json({
          error: scope.rootFolder
            ? "This folder has no downloadable files."
            : "No files to download",
        });
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
        type: scope.rootFolder ? "folder" : "bulk",
        folderName: scope.rootFolder?.name,
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
          folderName: scope.rootFolder?.name,
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
