import { NextApiRequest, NextApiResponse } from "next";

import {
  addFileToVectorStoreTask,
  processDocumentForAITask,
  SUPPORTED_AI_CONTENT_TYPES,
} from "@/ee/features/ai/lib/trigger";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { waitUntil } from "@vercel/functions";
import { getServerSession } from "next-auth/next";

import { getFeatureFlags } from "@/lib/featureFlags";
import { errorhandler } from "@/lib/errorHandler";
import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";

export const config = {
  // in order to enable `waitUntil` function
  supportsResponseStreaming: true,
};

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "POST") {
    // POST /api/teams/:teamId/documents/:id/add-to-dataroom
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      return res.status(401).end("Unauthorized");
    }

    const { teamId, id: docId } = req.query as { teamId: string; id: string };
    const { dataroomId } = req.body as { dataroomId: string };

    const userId = (session.user as CustomUser).id;

    try {
      const team = await prisma.team.findUnique({
        where: {
          id: teamId,
          users: {
            some: {
              userId,
            },
          },
          documents: {
            some: {
              id: {
                equals: docId,
              },
            },
          },
        },
        select: {
          id: true,
          plan: true,
        },
      });

      if (!team) {
        return res.status(401).end("Unauthorized");
      }

      if (
        (team.plan === "free" || team.plan === "pro") &&
        !team.plan.includes("drtrial")
      ) {
        return res.status(403).json({
          message: "Upgrade your plan to use datarooms.",
        });
      }

      // Fetch dataroom with AI settings
      const dataroom = await prisma.dataroom.findUnique({
        where: { id: dataroomId },
        select: {
          id: true,
          teamId: true,
          name: true,
          isFrozen: true,
          agentsEnabled: true,
          vectorStoreId: true,
        },
      });

      if (!dataroom) {
        return res.status(404).json({
          message: "Dataroom not found!",
        });
      }

      if (dataroom.isFrozen) {
        return res.status(403).json({
          message:
            "This data room is frozen. You cannot add documents to a frozen data room.",
        });
      }

      // Fetch document with primary version
      const document = await prisma.document.findUnique({
        where: { id: docId },
        include: {
          versions: {
            where: { isPrimary: true },
            take: 1,
          },
        },
      });

      if (!document) {
        return res.status(404).json({
          message: "Document not found!",
        });
      }

      let dataroomDocument;
      try {
        dataroomDocument = await prisma.dataroomDocument.create({
          data: {
            documentId: docId,
            dataroomId,
          },
        });
      } catch (error) {
        return res.status(500).json({
          message: "Document already exists in dataroom!",
        });
      }

      // Auto-index document if dataroom has AI agents enabled
      if (dataroom.agentsEnabled && dataroom.vectorStoreId) {
        const primaryVersion = document.versions[0];
        const contentType = primaryVersion?.contentType || "";

        // Check if AI feature is enabled for the team
        const features = await getFeatureFlags({ teamId });

        if (features.ai && primaryVersion && SUPPORTED_AI_CONTENT_TYPES.includes(contentType)) {
          const filePath =
            primaryVersion.originalFile && contentType !== "application/pdf"
              ? primaryVersion.originalFile
              : primaryVersion.file;

          const fileMetadata = {
            teamId: dataroom.teamId,
            documentId: document.id,
            documentName: document.name,
            versionId: primaryVersion.id,
            dataroomId: dataroom.id,
            dataroomDocumentId: dataroomDocument.id,
            dataroomFolderId: "root",
          };

          try {
            // If document already has fileId, just add to vector store
            if (primaryVersion.fileId) {
              waitUntil(
                addFileToVectorStoreTask.trigger({
                  fileId: primaryVersion.fileId,
                  vectorStoreId: dataroom.vectorStoreId,
                  metadata: fileMetadata,
                }),
              );
            } else {
              // Trigger full processing
              waitUntil(
                processDocumentForAITask.trigger(
                  {
                    documentId: document.id,
                    documentVersionId: primaryVersion.id,
                    teamId: dataroom.teamId,
                    vectorStoreId: dataroom.vectorStoreId,
                    documentName: document.name,
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
                      `document_${document.id}`,
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

      return res.status(200).json({
        message: "Document added to dataroom!",
      });
    } catch (error) {
      errorhandler(error, res);
    }
  } else {
    // We only allow POST requests
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
