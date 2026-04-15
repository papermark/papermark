import { NextApiRequest, NextApiResponse } from "next";

import {
  SUPPORTED_AI_CONTENT_TYPES,
  addFileToVectorStoreTask,
  processDocumentForAITask,
} from "@/ee/features/ai/lib/trigger";
import { isTeamPausedById } from "@/ee/features/billing/cancellation/lib/is-team-paused";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { runs } from "@trigger.dev/sdk";
import { waitUntil } from "@vercel/functions";
import { getServerSession } from "next-auth/next";

import { errorhandler } from "@/lib/errorHandler";
import { getFeatureFlags } from "@/lib/featureFlags";
import prisma from "@/lib/prisma";
import { sendDataroomChangeNotificationTask } from "@/lib/trigger/dataroom-change-notification";
import { CustomUser } from "@/lib/types";
import { log, serializeFileSize } from "@/lib/utils";
import { sortItemsByIndexAndName } from "@/lib/utils/sort-items-by-index-name";

export const config = {
  // in order to enable `waitUntil` function
  supportsResponseStreaming: true,
};

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "GET") {
    // GET /api/teams/:teamId/datarooms/:id/documents
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      return res.status(401).end("Unauthorized");
    }

    const userId = (session.user as CustomUser).id;
    const { teamId, id: dataroomId } = req.query as {
      teamId: string;
      id: string;
    };

    try {
      // Check if the user is part of the team
      const team = await prisma.team.findUnique({
        where: {
          id: teamId,
          users: {
            some: {
              userId: userId,
            },
          },
        },
      });

      if (!team) {
        return res.status(401).end("Unauthorized");
      }

      const documents = await prisma.dataroomDocument.findMany({
        where: {
          dataroomId: dataroomId,
          folderId: null,
        },
        orderBy: [
          { orderIndex: "asc" },
          {
            document: {
              name: "asc",
            },
          },
        ],
        select: {
          id: true,
          dataroomId: true,
          folderId: true,
          orderIndex: true,
          hierarchicalIndex: true,
          createdAt: true,
          updatedAt: true,
          document: {
            select: {
              id: true,
              name: true,
              type: true,
              advancedExcelEnabled: true,
              versions: {
                select: { id: true, hasPages: true },
              },
              isExternalUpload: true,
              _count: {
                select: {
                  views: { where: { dataroomId } },
                  versions: true,
                },
              },
            },
          },
        },
      });

      const sortedDocuments = sortItemsByIndexAndName(documents);

      return res.status(200).json(sortedDocuments);
    } catch (error) {
      console.error("Request error", error);
      return res
        .status(500)
        .json({ error: "Error fetching documents from dataroom" });
    }
  } else if (req.method === "POST") {
    // POST /api/teams/:teamId/datarooms/:id/documents
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      res.status(401).end("Unauthorized");
      return;
    }

    const { teamId, id: dataroomId } = req.query as {
      teamId: string;
      id: string;
    };

    const userId = (session.user as CustomUser).id;

    // Assuming data is an object with `name` and `description` properties
    const { documentId, folderPathName } = req.body as {
      documentId: string;
      folderPathName?: string;
    };

    try {
      // Check if the user is part of the team
      const team = await prisma.team.findUnique({
        where: {
          id: teamId,
          users: {
            some: {
              userId: userId,
            },
          },
        },
        select: {
          id: true,
        },
      });

      if (!team) {
        return res.status(401).end("Unauthorized");
      }

      // Check if team is paused
      const teamIsPaused = await isTeamPausedById(teamId);
      if (teamIsPaused) {
        return res.status(403).json({
          error:
            "Team is currently paused. Adding documents to dataroom is not available.",
        });
      }

      const folder = await prisma.dataroomFolder.findUnique({
        where: {
          dataroomId_path: {
            dataroomId,
            path: "/" + folderPathName,
          },
        },
        select: {
          id: true,
        },
      });

      const dataroomDocument = await prisma.dataroomDocument.create({
        data: {
          documentId,
          dataroomId,
          folderId: folder?.id,
        },
        include: {
          document: {
            include: {
              versions: {
                where: { isPrimary: true },
                take: 1,
              },
            },
          },
          dataroom: {
            select: {
              teamId: true,
              name: true,
              enableChangeNotifications: true,
              agentsEnabled: true,
              vectorStoreId: true,
              links: {
                select: { id: true },
                orderBy: { createdAt: "desc" },
                take: 1,
              },
              _count: {
                select: { viewerGroups: true, permissionGroups: true },
              },
            },
          },
        },
      });

      // Auto-index document if dataroom has AI agents enabled
      if (
        dataroomDocument.dataroom.agentsEnabled &&
        dataroomDocument.dataroom.vectorStoreId
      ) {
        const primaryVersion = dataroomDocument.document.versions[0];
        const contentType = primaryVersion?.contentType || "";

        // Check if AI feature is enabled for the team
        const features = await getFeatureFlags({ teamId });

        if (
          features.ai &&
          primaryVersion &&
          SUPPORTED_AI_CONTENT_TYPES.includes(contentType)
        ) {
          const filePath =
            primaryVersion.originalFile && contentType !== "application/pdf"
              ? primaryVersion.originalFile
              : primaryVersion.file;

          const fileMetadata = {
            teamId: dataroomDocument.dataroom.teamId,
            documentId: dataroomDocument.document.id,
            documentName: dataroomDocument.document.name,
            versionId: primaryVersion.id,
            dataroomId: dataroomDocument.dataroomId,
            dataroomDocumentId: dataroomDocument.id,
            dataroomFolderId: dataroomDocument.folderId || "root",
          };

          try {
            // If document already has fileId, just add to vector store
            if (primaryVersion.fileId) {
              waitUntil(
                addFileToVectorStoreTask.trigger({
                  fileId: primaryVersion.fileId,
                  vectorStoreId: dataroomDocument.dataroom.vectorStoreId,
                  metadata: fileMetadata,
                }),
              );
            } else {
              // Trigger full processing
              waitUntil(
                processDocumentForAITask.trigger(
                  {
                    documentId: dataroomDocument.document.id,
                    documentVersionId: primaryVersion.id,
                    teamId: dataroomDocument.dataroom.teamId,
                    vectorStoreId: dataroomDocument.dataroom.vectorStoreId,
                    documentName: dataroomDocument.document.name,
                    filePath,
                    storageType: primaryVersion.storageType,
                    contentType,
                    metadata: fileMetadata,
                  },
                  {
                    idempotencyKey: `ai-index-dataroom-${dataroomId}-${primaryVersion.id}`,
                    tags: [
                      `team_${teamId}`,
                      `dataroom_${dataroomId}`,
                      `document_${dataroomDocument.document.id}`,
                      `version_${primaryVersion.id}`,
                    ],
                  },
                ),
              );
            }
          } catch (error) {
            console.error("Error triggering AI indexing for document:", error);
            // Don't fail the document add, just log the error
          }
        }
      }

      // Check if the team has the dataroom change notification enabled
      if (dataroomDocument.dataroom.enableChangeNotifications) {
        // Get all delayed and queued runs for this dataroom
        const existingChangeRuns = await runs.list({
          taskIdentifier: ["send-dataroom-change-notification"],
          tag: [`dataroom_${dataroomId}`, `user_upload_${userId}`],
          status: ["DELAYED", "QUEUED"],
          period: "15m",
        });

        const matchingChangeRuns = existingChangeRuns.data.filter(
          (run) =>
            run.tags?.includes(`dataroom_${dataroomId}`) &&
            run.tags?.includes(`user_upload_${userId}`),
        );

        let accumulatedDocIds: string[] = [dataroomDocument.id];
        for (const run of matchingChangeRuns) {
          const fullRun = await runs.retrieve(run.id);
          const existingIds = (
            fullRun.payload as { dataroomDocumentIds?: string[] } | undefined
          )?.dataroomDocumentIds;
          if (Array.isArray(existingIds)) {
            accumulatedDocIds.push(...existingIds);
          }
        }
        accumulatedDocIds = [...new Set(accumulatedDocIds)];

        await Promise.all(matchingChangeRuns.map((run) => runs.cancel(run.id)));

        waitUntil(
          sendDataroomChangeNotificationTask.trigger(
            {
              dataroomId,
              dataroomDocumentIds: accumulatedDocIds,
              senderUserId: userId,
              teamId,
            },
            {
              idempotencyKey: `dataroom-notification-${teamId}-${dataroomId}-${dataroomDocument.id}`,
              tags: [
                `team_${teamId}`,
                `dataroom_${dataroomId}`,
                `document_${dataroomDocument.id}`,
                `user_upload_${userId}`,
              ],
              delay: new Date(Date.now() + 10 * 60 * 1000), // 10 minute delay
            },
          ),
        );
      }

      return res.status(201).json(serializeFileSize(dataroomDocument));
    } catch (error) {
      log({
        message: `Failed to create dataroom document. \n\n*teamId*: _${teamId}_, \n\n*dataroomId*: ${dataroomId} \n\n ${error}`,
        type: "error",
      });
      errorhandler(error, res);
    }
  } else {
    // We only allow GET requests
    res.setHeader("Allow", ["GET", "POST"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
