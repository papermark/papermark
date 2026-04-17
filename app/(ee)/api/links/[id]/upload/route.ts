import { NextRequest, NextResponse } from "next/server";

import { runs } from "@trigger.dev/sdk";
import { waitUntil } from "@vercel/functions";

import { processDocument } from "@/lib/api/documents/process-document";
import { verifyDataroomSession } from "@/lib/auth/dataroom-auth";
import { DocumentData } from "@/lib/documents/create-document";
import prisma from "@/lib/prisma";
import { sendDataroomChangeNotificationTask } from "@/lib/trigger/dataroom-change-notification";
import { sendDataroomUploadNotificationTask } from "@/lib/trigger/dataroom-upload-notification";
import { supportsAdvancedExcelMode } from "@/lib/utils/get-content-type";
import { sanitizePlainText } from "@/lib/utils/sanitize-html";

/**
 * GET /api/links/[id]/upload?dataroomId=xxx
 * Returns the viewer's previously uploaded documents for this dataroom.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const linkId = params.id;
    const dataroomId = request.nextUrl.searchParams.get("dataroomId");

    if (!linkId || !dataroomId) {
      return NextResponse.json(
        { message: "Missing required parameters" },
        { status: 400 },
      );
    }

    // Verify the dataroom session
    const dataroomSession = await verifyDataroomSession(
      request,
      linkId,
      dataroomId,
    );

    if (!dataroomSession || !dataroomSession.viewerId) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { viewerId } = dataroomSession;

    // Fetch the viewer's uploads for this dataroom
    const uploads = await prisma.documentUpload.findMany({
      where: {
        viewerId,
        dataroomId,
        linkId,
      },
      select: {
        id: true,
        documentId: true,
        dataroomDocumentId: true,
        originalFilename: true,
        uploadedAt: true,
        document: {
          select: {
            id: true,
            name: true,
            type: true,
            versions: {
              where: { isPrimary: true },
              select: {
                id: true,
                hasPages: true,
              },
              take: 1,
            },
          },
        },
        dataroomDocument: {
          select: {
            folderId: true,
          },
        },
      },
      orderBy: { uploadedAt: "desc" },
    });

    const formattedUploads = uploads.map((upload) => {
      const fileType = upload.document?.type ?? "";
      const hasPages = upload.document?.versions?.[0]?.hasPages ?? false;
      const needsProcessing = ["pdf", "docs", "slides"].includes(fileType);
      const isComplete = !needsProcessing || hasPages;

      return {
        id: upload.id,
        documentId: upload.documentId,
        dataroomDocumentId: upload.dataroomDocumentId,
        documentVersionId: upload.document?.versions?.[0]?.id ?? null,
        name: upload.originalFilename ?? upload.document?.name ?? "Unknown",
        fileType,
        folderId: upload.dataroomDocument?.folderId ?? null,
        uploadedAt: upload.uploadedAt,
        status: isComplete ? "complete" : "processing",
      };
    });

    return NextResponse.json({ uploads: formattedUploads });
  } catch (error) {
    console.error("Error fetching viewer uploads:", error);
    return NextResponse.json(
      { message: "Error fetching uploads" },
      { status: 500 },
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const linkId = params.id;
    const body = await request.json();
    const { documentData, dataroomId, folderId } = body as {
      documentData: DocumentData;
      dataroomId: string;
      folderId?: string;
    };

    if (!linkId || !documentData || !dataroomId) {
      return NextResponse.json(
        { message: "Missing required parameters" },
        { status: 400 },
      );
    }

    // 0. Verify the dataroom session
    const dataroomSession = await verifyDataroomSession(
      request,
      linkId,
      dataroomId,
    );

    if (!dataroomSession || !dataroomSession.viewerId) {
      return NextResponse.json(
        { message: "You need to be logged in to upload a document." },
        { status: 401 },
      );
    }

    // Check if the link exists and has visitor upload enabled
    const link = await prisma.link.findUnique({
      where: { id: linkId, dataroomId },
      select: {
        id: true,
        name: true,
        enableUpload: true,
        enableNotification: true,
        uploadFolderId: true,
        dataroomId: true,
        teamId: true,
        team: {
          select: {
            plan: true,
            enableExcelAdvancedMode: true,
          },
        },
        dataroom: {
          select: {
            enableVisitorUploadChangeNotifications: true,
          },
        },
      },
    });

    if (
      !link ||
      !link.enableUpload ||
      link.dataroomId !== dataroomId ||
      !link.teamId
    ) {
      return NextResponse.json(
        { message: "Uploads not allowed for this link" },
        { status: 403 },
      );
    }

    const { viewerId, viewId } = dataroomSession;

    // Check if the viewer exists
    const viewer = await prisma.viewer.findUnique({
      where: {
        id: viewerId,
        teamId: link.teamId,
        views: { some: { id: viewId } },
      },
      select: { id: true },
    });

    if (!viewer) {
      return NextResponse.json(
        { message: "Viewer not found" },
        { status: 404 },
      );
    }

    if (typeof documentData.name !== "string") {
      return NextResponse.json(
        { message: "Document name is required" },
        { status: 400 },
      );
    }

    const sanitizedDocumentName = sanitizePlainText(documentData.name);
    if (!sanitizedDocumentName) {
      return NextResponse.json(
        { message: "Document name is required" },
        { status: 400 },
      );
    }

    if (sanitizedDocumentName.length > 255) {
      return NextResponse.json(
        { message: "Document name too long" },
        { status: 400 },
      );
    }

    const updatedDocumentData = {
      ...documentData,
      name: sanitizedDocumentName,
      enableExcelAdvancedMode:
        documentData.supportedFileType === "sheet" &&
        link.team?.enableExcelAdvancedMode &&
        supportsAdvancedExcelMode(documentData.contentType),
    };

    // 1. Create the document
    const document = await processDocument({
      documentData: updatedDocumentData,
      teamId: link.teamId,
      teamPlan: link.team?.plan ?? "free",
      isExternalUpload: true,
    });

    // 2. Create the dataroom document
    // If folderId is provided and link has no uploadFolderId, use folderId as the dataroomFolderId
    // Otherwise, use the link's uploadFolderId
    // or null if it doesn't exist
    let dataroomFolderId: string | null = folderId ?? null;
    if (link.uploadFolderId) {
      const dataroomFolder = await prisma.dataroomFolder.findUnique({
        where: {
          id: link.uploadFolderId,
          dataroomId,
        },
        select: {
          id: true,
        },
      });
      dataroomFolderId = dataroomFolder?.id ?? null;
    }

    const newDataroomDocument = await prisma.dataroomDocument.create({
      data: {
        dataroomId: dataroomId,
        documentId: document.id,
        folderId: dataroomFolderId,
      },
    });

    // 3. Create the DocumentUpload record to track the upload details
    await prisma.documentUpload.create({
      data: {
        documentId: document.id,
        viewerId: viewerId,
        viewId: viewId,
        linkId: linkId,
        originalFilename: document.name,
        fileSize: documentData.fileSize ?? 0,
        numPages: document.numPages,
        mimeType: document.contentType,
        dataroomId: dataroomId,
        dataroomDocumentId: newDataroomDocument.id,
        teamId: link.teamId,
      },
    });

    // 4. Send upload notification to team if enabled
    if (link.enableNotification) {
      try {
        // Cancel any existing pending notification runs for this viewer+dataroom+link
        // Note: runs.list tag filter uses OR logic, so we must post-filter
        // to ensure we only cancel runs matching ALL three tags
        const requiredTags = [
          `dataroom_${dataroomId}`,
          `link_${linkId}`,
          `viewer_${viewerId}`,
        ];
        const allRuns = await runs.list({
          taskIdentifier: ["send-dataroom-upload-notification"],
          tag: requiredTags,
          status: ["DELAYED", "QUEUED"],
          period: "10m",
        });

        const matchingRuns = allRuns.data.filter((run) =>
          requiredTags.every((tag) => run.tags?.includes(tag)),
        );

        await Promise.all(matchingRuns.map((run) => runs.cancel(run.id)));

        // Trigger a new notification with 5-minute delay to batch uploads
        waitUntil(
          sendDataroomUploadNotificationTask.trigger(
            {
              dataroomId,
              linkId,
              viewerId,
              teamId: link.teamId,
            },
            {
              idempotencyKey: `upload-notification-${link.teamId}-${dataroomId}-${linkId}-${viewerId}-${newDataroomDocument.id}`,
              tags: [
                `team_${link.teamId}`,
                `dataroom_${dataroomId}`,
                `link_${linkId}`,
                `viewer_${viewerId}`,
              ],
              delay: new Date(Date.now() + 5 * 60 * 1000), // 5 minute delay
            },
          ),
        );
      } catch (error) {
        console.error("Error triggering upload notification:", error);
      }
    }

    // 5. Notify other dataroom visitors about the new upload (each visitor gets their own email)
    //    Uses cancel-and-retrigger as a debounce: cancelled runs' document IDs
    //    are accumulated into the new run so no uploads are lost.
    if (link.dataroom?.enableVisitorUploadChangeNotifications) {
      try {
        const existingChangeRuns = await runs.list({
          taskIdentifier: ["send-dataroom-change-notification"],
          tag: [`dataroom_${dataroomId}`, `visitor_upload_${viewerId}`],
          status: ["DELAYED", "QUEUED"],
          period: "15m",
        });

        const matchingChangeRuns = existingChangeRuns.data.filter(
          (run) =>
            run.tags?.includes(`dataroom_${dataroomId}`) &&
            run.tags?.includes(`visitor_upload_${viewerId}`),
        );

        let accumulatedDocIds: string[] = [newDataroomDocument.id];
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
              senderUserId: null,
              teamId: link.teamId,
              excludeViewerId: viewerId,
            },
            {
              idempotencyKey: `visitor-change-notification-${link.teamId}-${dataroomId}-${viewerId}-${Date.now()}`,
              tags: [
                `team_${link.teamId}`,
                `dataroom_${dataroomId}`,
                `visitor_upload_${viewerId}`,
              ],
              delay: new Date(Date.now() + 10 * 60 * 1000),
            },
          ),
        );
      } catch (error) {
        console.error(
          "Error triggering visitor upload change notification:",
          error,
        );
      }
    }

    // Return document data for optimistic UI rendering
    return NextResponse.json({
      success: true,
      document: {
        id: document.id,
        name: document.name,
        dataroomDocumentId: newDataroomDocument.id,
        documentVersionId: document.versions[0]?.id,
        folderId: dataroomFolderId,
        fileType: document.type,
        hasPages: (document.numPages ?? 0) > 0,
        createdAt: document.createdAt,
      },
    });
  } catch (error) {
    console.error("Error uploading document:", error);
    return NextResponse.json(
      { message: "Error uploading document" },
      { status: 500 },
    );
  }
}
