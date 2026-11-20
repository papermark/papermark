import type {
  convertFilesToPdfTask,
  convertKeynoteToPdfTask,
} from "@/ee/features/conversions/lib/trigger/convert-files";
import { tasks } from "@trigger.dev/sdk";

import { validateExternalDocumentUrl } from "@/lib/api/documents/validate-external-url";
import { DocumentData } from "@/lib/documents/create-document";
import { getFeatureFlags } from "@/lib/featureFlags";
import prisma from "@/lib/prisma";
import { processVideo } from "@/lib/trigger/optimize-video-files";
import { convertPdfToImageRoute } from "@/lib/trigger/pdf-to-image-route";
import { getExtension } from "@/lib/utils";
import { isMarkdownFile } from "@/lib/utils/get-content-type";
import { conversionQueueName } from "@/lib/utils/trigger-utils";
import { videoProcessingMode } from "@/lib/video/processing-plan";
import { sendDocumentCreatedWebhook } from "@/lib/webhook/triggers/document-created";
import { sendLinkCreatedWebhook } from "@/lib/webhook/triggers/link-created";

type ProcessDocumentParams = {
  documentData: DocumentData;
  teamId: string;
  teamPlan: string;
  userId?: string;
  folderPathName?: string;
  folderId?: string | null;
  createLink?: boolean;
  isExternalUpload?: boolean;
};

export const processDocument = async ({
  documentData,
  teamId,
  teamPlan,
  userId,
  folderPathName,
  folderId,
  createLink = false,
  isExternalUpload = false,
}: ProcessDocumentParams) => {
  const {
    name,
    key,
    storageType,
    contentType,
    supportedFileType,
    fileSize,
    numPages,
    enableExcelAdvancedMode,
  } = documentData;

  // Get passed type property or alternatively, the file extension and save it as the type
  const type = supportedFileType || getExtension(name);

  if (type === "html") {
    const featureFlags = await getFeatureFlags({ teamId });
    if (!featureFlags.htmlDocuments) {
      throw new Error("HTML documents are not enabled for this team.");
    }
  }

  // For notion/link documents, validate the external URL (Notion page must be
  // public; link URLs must be well-formed and not blocked). No-op otherwise.
  await validateExternalDocumentUrl({ type, key, teamId });

  // `folderId` (resolved by callers like the public v1 API) wins over the
  // path-based lookup; the path lookup remains for the dashboard upload flow
  // which still passes `folderPathName` referring to a pre-existing folder.
  const folder = folderId
    ? { id: folderId }
    : folderPathName
      ? await prisma.folder.findUnique({
          where: {
            teamId_path: {
              teamId,
              path: "/" + folderPathName,
            },
          },
          select: { id: true },
        })
      : null;

  const isDownloadOnlyByExtension =
    /\.(log|err|prj|jgw|tif|tiff|ecw|bak|xlsb|sav|shp|shx|dbf|sbn|sbx|qix|cpg)$/i.test(
      name,
    );

  const isMarkdown = isMarkdownFile({ name, contentType });

  // determine if the document is download only
  const isDownloadOnly =
    type === "zip" ||
    type === "map" ||
    type === "email" ||
    type === "other" ||
    contentType === "text/tab-separated-values" ||
    type === "cad" ||
    isMarkdown ||
    isDownloadOnlyByExtension;

  // Save data to the database
  const document = await prisma.document.create({
    data: {
      name: name,
      numPages: numPages,
      file: key,
      originalFile: key,
      contentType: contentType,
      type: type,
      storageType,
      ownerId: userId,
      teamId: teamId,
      advancedExcelEnabled: enableExcelAdvancedMode,
      downloadOnly: isDownloadOnly,
      ...(createLink && {
        links: {
          create: {
            teamId,
            ownerId: userId,
          },
        },
      }),
      versions: {
        create: {
          file: key,
          originalFile: key,
          contentType: contentType,
          type: type,
          storageType,
          numPages: numPages,
          isPrimary: true,
          versionNumber: 1,
          fileSize: fileSize,
        },
      },
      folderId: folder?.id ?? null,
      isExternalUpload,
    },
    include: {
      links: true,
      versions: true,
    },
  });

  // Trigger appropriate conversion tasks based on document type
  // Check if it's a Keynote file (slides type with Keynote content type)
  if (
    type === "slides" &&
    (contentType === "application/vnd.apple.keynote" ||
      contentType === "application/x-iwork-keynote-sffkey")
  ) {
    await tasks.trigger<typeof convertKeynoteToPdfTask>(
      "convert-keynote-to-pdf",
      {
        documentId: document.id,
        documentVersionId: document.versions[0].id,
        teamId,
      },
      {
        idempotencyKey: `${teamId}-${document.versions[0].id}-keynote`,
        tags: [
          `team_${teamId}`,
          `document_${document.id}`,
          `version:${document.versions[0].id}`,
        ],
        queue: conversionQueueName(teamPlan),
        concurrencyKey: teamId,
      },
    );
  } else if (
    (type === "docs" || type === "slides") &&
    !isDownloadOnlyByExtension &&
    !isMarkdown
  ) {
    await tasks.trigger<typeof convertFilesToPdfTask>(
      "convert-files-to-pdf",
      {
        documentId: document.id,
        documentVersionId: document.versions[0].id,
        teamId,
      },
      {
        idempotencyKey: `${teamId}-${document.versions[0].id}-docs`,
        tags: [
          `team_${teamId}`,
          `document_${document.id}`,
          `version:${document.versions[0].id}`,
        ],
        queue: conversionQueueName(teamPlan),
        concurrencyKey: teamId,
      },
    );
  }

  const videoMode = videoProcessingMode({ type, contentType });
  if (videoMode) {
    await processVideo.trigger(
      {
        documentVersionId: document.versions[0].id,
        mode: videoMode,
      },
      {
        idempotencyKey: `${teamId}-${document.versions[0].id}-${videoMode}`,
        tags: [
          `team_${teamId}`,
          `document_${document.id}`,
          `version:${document.versions[0].id}`,
        ],
        queue: conversionQueueName(teamPlan),
        concurrencyKey: teamId,
      },
    );
  }

  // skip triggering convert-pdf-to-image job for "notion" / "excel" documents
  if (type === "pdf") {
    await convertPdfToImageRoute.trigger(
      {
        documentId: document.id,
        documentVersionId: document.versions[0].id,
        teamId,
      },
      {
        idempotencyKey: `${teamId}-${document.versions[0].id}`,
        tags: [
          `team_${teamId}`,
          `document_${document.id}`,
          `version:${document.versions[0].id}`,
        ],
        queue: conversionQueueName(teamPlan),
        concurrencyKey: teamId,
      },
    );
  }

  if (type === "sheet" && enableExcelAdvancedMode) {
    await prisma.documentVersion.update({
      where: { id: document.versions[0].id },
      data: { numPages: 1 },
    });

    try {
      await fetch(
        `${process.env.NEXTAUTH_URL}/api/revalidate?secret=${process.env.REVALIDATE_TOKEN}&documentId=${document.id}`,
      );
    } catch (error) {
      console.error("Failed to revalidate document:", error);
      // The document is still updated, so we can continue without throwing
    }
  }

  // Send webhooks
  await Promise.all([
    !isExternalUpload &&
      sendDocumentCreatedWebhook({
        teamId,
        data: {
          document_id: document.id,
        },
      }),
    createLink &&
      sendLinkCreatedWebhook({
        teamId,
        data: {
          document_id: document.id,
          link_id: document.links[0].id,
        },
      }),
  ]);

  return document;
};
