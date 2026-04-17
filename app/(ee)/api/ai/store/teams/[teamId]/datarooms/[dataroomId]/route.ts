import { NextRequest, NextResponse } from "next/server";

import {
  SUPPORTED_AI_CONTENT_TYPES,
  addFileToVectorStoreTask,
  processDocumentForAITask,
} from "@/ee/features/ai/lib/trigger";
import { createDataroomVectorStore } from "@/ee/features/ai/lib/vector-stores/create-dataroom-vector-store";
import { authOptions } from "@/lib/auth/auth-options";
import { getServerSession } from "next-auth";

import { getFeatureFlags } from "@/lib/featureFlags";
import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";

/**
 * POST /api/ai/store/teams/[teamId]/datarooms/[dataroomId]
 * Index all documents in a dataroom into its vector store
 * Returns batch runIds for status tracking via polling
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { dataroomId: string; teamId: string } },
) {
  try {
    const { dataroomId, teamId } = params;
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = (session.user as CustomUser).id;

    // Verify user is member of team
    const userTeam = await prisma.userTeam.findUnique({
      where: {
        userId_teamId: {
          userId,
          teamId,
        },
      },
    });

    if (!userTeam) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if AI feature is enabled for this team
    const features = await getFeatureFlags({ teamId });
    if (!features.ai) {
      return NextResponse.json(
        { error: "AI features are not available for this team" },
        { status: 403 },
      );
    }

    // Get dataroom and documents
    const dataroom = await prisma.dataroom.findUnique({
      where: {
        id: dataroomId,
        teamId,
      },
      include: {
        team: {
          select: {
            agentsEnabled: true,
          },
        },
        documents: {
          include: {
            document: {
              select: {
                id: true,
                name: true,
                versions: {
                  where: { isPrimary: true },
                  take: 1,
                  select: {
                    id: true,
                    fileId: true,
                    contentType: true,
                    storageType: true,
                    originalFile: true,
                    file: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!dataroom) {
      return NextResponse.json(
        { error: "Dataroom not found" },
        { status: 404 },
      );
    }

    // Check if team has AI enabled
    if (!dataroom.team.agentsEnabled) {
      return NextResponse.json(
        { error: "AI agents are not enabled for this team" },
        { status: 403 },
      );
    }

    if (!dataroom.agentsEnabled) {
      return NextResponse.json(
        { error: "AI agents are not enabled for this dataroom" },
        { status: 403 },
      );
    }

    // Create or get vector store
    let vectorStoreId = dataroom.vectorStoreId;

    if (!vectorStoreId) {
      vectorStoreId = await createDataroomVectorStore({
        dataroomId,
        teamId: dataroom.teamId,
        name: dataroom.name,
      });

      // Update dataroom with vector store ID
      await prisma.dataroom.update({
        where: { id: dataroomId },
        data: { vectorStoreId },
      });
    }

    // Track triggered runs for status polling
    const triggeredRuns: Array<{
      documentId: string;
      documentName: string;
      runId: string;
    }> = [];
    const skippedDocuments: string[] = [];
    const errors: string[] = [];

    // Trigger processing for each document
    for (const dataroomDoc of dataroom.documents) {
      const document = dataroomDoc.document;
      const primaryVersion = document.versions[0];

      if (!primaryVersion) {
        errors.push(`No primary version for document: ${document.name}`);
        continue;
      }

      // Skip if already indexed in this dataroom
      if (dataroomDoc.vectorStoreFileId) {
        skippedDocuments.push(document.name);
        continue;
      }

      // Check if document type is supported
      const contentType = primaryVersion.contentType || "";
      if (!SUPPORTED_AI_CONTENT_TYPES.includes(contentType)) {
        errors.push(
          `Unsupported file type for document: ${document.name} (${contentType})`,
        );
        continue;
      }

      try {
        // Determine file path
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
          dataroomDocumentId: dataroomDoc.id,
          dataroomFolderId: dataroomDoc.folderId || "root",
        };

        let handle;

        // If document already has fileId, just add to vector store
        if (primaryVersion.fileId) {
          handle = await addFileToVectorStoreTask.trigger({
            fileId: primaryVersion.fileId,
            vectorStoreId,
            metadata: fileMetadata,
          });
        } else {
          // Trigger full processing
          handle = await processDocumentForAITask.trigger(
            {
              documentId: document.id,
              documentVersionId: primaryVersion.id,
              teamId: dataroom.teamId,
              vectorStoreId,
              documentName: document.name,
              filePath,
              storageType: primaryVersion.storageType,
              contentType,
              metadata: fileMetadata,
            },
            {
              idempotencyKey: `ai-index-dataroom-${dataroom.id}-${primaryVersion.id}`,
              tags: [
                `team_${dataroom.teamId}`,
                `dataroom_${dataroom.id}`,
                `document_${document.id}`,
                `version_${primaryVersion.id}`,
              ],
            },
          );
        }

        triggeredRuns.push({
          documentId: document.id,
          documentName: document.name,
          runId: handle.id,
        });
      } catch (error) {
        console.error(
          `Error triggering processing for ${document.name}:`,
          error,
        );
        errors.push(
          `Failed to trigger processing for: ${document.name} - ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      }
    }

    return NextResponse.json({
      success: true,
      vectorStoreId,
      totalDocuments: dataroom.documents.length,
      triggeredCount: triggeredRuns.length,
      skippedCount: skippedDocuments.length,
      runs: triggeredRuns,
      skipped: skippedDocuments.length > 0 ? skippedDocuments : undefined,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error("Error indexing dataroom:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
