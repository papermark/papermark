import { NextRequest, NextResponse } from "next/server";

import {
  addFileToVectorStoreTask,
  processDocumentForAITask,
  SUPPORTED_AI_CONTENT_TYPES,
} from "@/ee/features/ai/lib/trigger";
import { createTeamVectorStore } from "@/ee/features/ai/lib/vector-stores/create-team-vector-store";
import { removeFileFromVectorStore } from "@/ee/features/ai/lib/vector-stores/remove-file-from-vector-store";
import { authOptions } from "@/lib/auth/auth-options";
import { getServerSession } from "next-auth";

import { getFeatureFlags } from "@/lib/featureFlags";
import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";

/**
 * POST /api/ai/store/teams/[teamId]/documents/[documentId]
 * Index a single document into the team vector store
 * Returns runId for status tracking via polling
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { documentId: string; teamId: string } },
) {
  try {
    const { documentId, teamId } = params;
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

    // Get document and version
    const document = await prisma.document.findUnique({
      where: { id: documentId, teamId },
      include: {
        team: {
          select: {
            agentsEnabled: true,
            vectorStoreId: true,
            name: true,
          },
        },
        versions: {
          where: { isPrimary: true },
          take: 1,
        },
      },
    });

    if (!document) {
      return NextResponse.json(
        { error: "Document not found" },
        { status: 404 },
      );
    }

    // Check if team has AI enabled
    if (!document.team.agentsEnabled) {
      return NextResponse.json(
        { error: "AI agents are not enabled for this team" },
        { status: 403 },
      );
    }

    if (!document.agentsEnabled) {
      return NextResponse.json(
        { error: "AI agents are not enabled for this document" },
        { status: 403 },
      );
    }

    const primaryVersion = document.versions[0];

    if (!primaryVersion) {
      return NextResponse.json(
        { error: "No primary version found for this document" },
        { status: 400 },
      );
    }

    // Create or get team vector store
    let vectorStoreId = document.team.vectorStoreId;

    if (!vectorStoreId) {
      vectorStoreId = await createTeamVectorStore(
        document.teamId,
        document.team.name,
      );

      // Update team with vector store ID
      await prisma.team.update({
        where: { id: document.teamId },
        data: { vectorStoreId },
      });
    }

    // Check if document type is supported
    const contentType = primaryVersion.contentType || "";
    if (!SUPPORTED_AI_CONTENT_TYPES.includes(contentType)) {
      return NextResponse.json(
        {
          error: `Unsupported file type: ${contentType}. Supported types: PDF, Excel, and images (JPEG, PNG, WebP).`,
        },
        { status: 400 },
      );
    }

    // Determine file path - use originalFile for non-PDF, file for PDF
    const filePath =
      primaryVersion.originalFile && contentType !== "application/pdf"
        ? primaryVersion.originalFile
        : primaryVersion.file;

    const fileMetadata = {
      teamId: document.teamId,
      documentId: document.id,
      documentName: document.name,
      versionId: primaryVersion.id,
      folderId: document.folderId || "root",
    };

    // Check if document already has a fileId - use lightweight task
    if (primaryVersion.fileId) {
      // Document already processed, just add to vector store
      const handle = await addFileToVectorStoreTask.trigger({
        fileId: primaryVersion.fileId,
        vectorStoreId,
        metadata: fileMetadata,
      });

      return NextResponse.json({
        success: true,
        runId: handle.id,
        isReprocessing: false,
      });
    }

    // Trigger full document processing task
    const handle = await processDocumentForAITask.trigger(
      {
        documentId: document.id,
        documentVersionId: primaryVersion.id,
        teamId: document.teamId,
        vectorStoreId,
        documentName: document.name,
        filePath,
        storageType: primaryVersion.storageType,
        contentType,
        metadata: fileMetadata,
      },
      {
        idempotencyKey: `ai-index-${document.teamId}-${primaryVersion.id}`,
        tags: [
          `team_${document.teamId}`,
          `document_${document.id}`,
          `version_${primaryVersion.id}`,
        ],
      },
    );

    return NextResponse.json({
      success: true,
      runId: handle.id,
      isReprocessing: true,
    });
  } catch (error) {
    console.error("Error indexing document:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/ai/store/teams/[teamId]/documents/[documentId]
 * Remove a document from the team vector store
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: { documentId: string; teamId: string } },
) {
  try {
    const { documentId, teamId } = params;
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

    // Get document and verify user access
    const document = await prisma.document.findUnique({
      where: { id: documentId, teamId },
      include: {
        team: {
          select: {
            vectorStoreId: true,
          },
        },
        versions: {
          where: { isPrimary: true },
          take: 1,
          select: {
            id: true,
            vectorStoreFileId: true,
          },
        },
      },
    });

    if (!document) {
      return NextResponse.json(
        { error: "Document not found" },
        { status: 404 },
      );
    }

    // Check if AI feature is enabled for this team
    const features = await getFeatureFlags({ teamId: document.teamId });
    if (!features.ai) {
      return NextResponse.json(
        { error: "AI features are not available for this team" },
        { status: 403 },
      );
    }

    const primaryVersion = document.versions[0];
    const vectorStoreId = document.team.vectorStoreId;

    if (!primaryVersion?.vectorStoreFileId || !vectorStoreId) {
      return NextResponse.json(
        { error: "Document is not indexed" },
        { status: 400 },
      );
    }

    // Remove file from vector store
    await removeFileFromVectorStore(
      vectorStoreId,
      primaryVersion.vectorStoreFileId,
    );

    // Clear vector store file ID
    await prisma.documentVersion.update({
      where: { id: primaryVersion.id },
      data: { vectorStoreFileId: null },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error removing document from vector store:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
