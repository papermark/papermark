import { NextApiRequest, NextApiResponse } from "next";

import {
  SUPPORTED_AI_CONTENT_TYPES,
  addFileToVectorStoreTask,
  processDocumentForAITask,
} from "@/ee/features/ai/lib/trigger";
import { isTeamPausedById } from "@/ee/features/billing/cancellation/lib/is-team-paused";
import { runs } from "@trigger.dev/sdk";
import { waitUntil } from "@vercel/functions";

import { withTeamApi } from "@/lib/api/auth/with-session-team";
import { assertDocumentAccess } from "@/lib/api/rbac/entitlements";
import { isDataroomScopedRole } from "@/lib/api/rbac/permissions";
import { onDataroomDocumentsAttached } from "@/lib/dataroom/apply-default-permissions";
import { errorhandler } from "@/lib/errorHandler";
import { getFeatureFlags } from "@/lib/featureFlags";
import prisma from "@/lib/prisma";
import { sendDataroomChangeNotificationTask } from "@/lib/trigger/dataroom-change-notification";
import { log, serializeFileSize } from "@/lib/utils";
import { sortItemsByIndexAndName } from "@/lib/utils/sort-items-by-index-name";

export const config = {
  // in order to enable `waitUntil` function
  supportsResponseStreaming: true,
};

// GET /api/teams/:teamId/datarooms/:id/documents
const getHandler = withTeamApi(
  async ({ req, res }) => {
    const { id: dataroomId } = req.query as { id: string };

    try {
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
  },
  { requiredPermissions: ["datarooms.read"], dataroomParam: "id" },
);

// POST /api/teams/:teamId/datarooms/:id/documents
const postHandler = withTeamApi(
  async ({ req, res, teamId, userId, role, allowedDataroomIds }) => {
    const { id: dataroomId } = req.query as { id: string };

    // Assuming data is an object with `name` and `description` properties
    const { documentId, folderPathName } = req.body as {
      documentId: string;
      folderPathName?: string;
    };

    try {
      // For dataroom-scoped members, the document being attached must either be
      // owned by them (a fresh upload) or already live in one of their assigned
      // rooms — otherwise an arbitrary team document could be pulled into the
      // room and viewed.
      if (isDataroomScopedRole(role)) {
        const document = await prisma.document.findFirst({
          where: { id: documentId, teamId },
          select: { ownerId: true },
        });
        if (!document) {
          return res.status(404).json({ error: "Document not found" });
        }
        const ownsDocument = document.ownerId === userId;
        const hasRoomAccess =
          ownsDocument ||
          (await assertDocumentAccess({
            role,
            userId,
            teamId,
            documentId,
            allowedIds: allowedDataroomIds,
          }));
        if (!hasRoomAccess) {
          return res
            .status(403)
            .json({ error: "You cannot add this document to a data room." });
        }
      }

      // Check if team is paused
      const teamIsPaused = await isTeamPausedById(teamId);
      if (teamIsPaused) {
        return res.status(403).json({
          error:
            "Team is currently paused. Adding documents to dataroom is not available.",
        });
      }

      const dataroom = await prisma.dataroom.findUnique({
        where: { id: dataroomId, teamId },
        select: { isFrozen: true },
      });
      if (!dataroom) {
        return res.status(404).json({ error: "Data room not found" });
      }
      if (dataroom.isFrozen) {
        return res.status(403).json({
          error:
            "This data room is frozen. You cannot add documents to a frozen data room.",
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
            },
          },
        },
      });

      await onDataroomDocumentsAttached({
        dataroomId,
        dataroomDocuments: [
          {
            id: dataroomDocument.id,
            folderId: dataroomDocument.folderId,
          },
        ],
        schedule: waitUntil,
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
  },
  { requiredPermissions: ["documents.write"], dataroomParam: "id" },
);

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "GET") {
    return getHandler(req, res);
  } else if (req.method === "POST") {
    return postHandler(req, res);
  } else {
    res.setHeader("Allow", ["GET", "POST"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
