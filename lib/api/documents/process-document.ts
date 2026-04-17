import { get } from "@vercel/edge-config";
import { parsePageId } from "notion-utils";

import { DocumentData } from "@/lib/documents/create-document";
import { isTrustedTeam } from "@/lib/edge-config/trusted-teams";
import { copyFileToBucketServer } from "@/lib/files/copy-file-to-bucket-server";
import notion from "@/lib/notion";
import { getNotionPageIdFromSlug } from "@/lib/notion/utils";
import prisma from "@/lib/prisma";
import {
  convertFilesToPdfTask,
  convertKeynoteToPdfTask,
} from "@/lib/trigger/convert-files";
import { processVideo } from "@/lib/trigger/optimize-video-files";
import { convertPdfToImageRoute } from "@/lib/trigger/pdf-to-image-route";
import { getExtension, log } from "@/lib/utils";
import { conversionQueueName } from "@/lib/utils/trigger-utils";
import { sendDocumentCreatedWebhook } from "@/lib/webhook/triggers/document-created";
import { sendLinkCreatedWebhook } from "@/lib/webhook/triggers/link-created";

type ProcessDocumentParams = {
  documentData: DocumentData;
  teamId: string;
  teamPlan: string;
  userId?: string;
  folderPathName?: string;
  createLink?: boolean;
  isExternalUpload?: boolean;
};

export const processDocument = async ({
  documentData,
  teamId,
  teamPlan,
  userId,
  folderPathName,
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

  // Check whether the Notion page is publically accessible or not
  if (type === "notion") {
    try {
      let pageId = parsePageId(key, { uuid: false });

      // If parsePageId fails, try to get page ID from slug
      if (!pageId) {
        try {
          const pageIdFromSlug = await getNotionPageIdFromSlug(key);
          pageId = pageIdFromSlug || undefined;
        } catch (slugError) {
          throw new Error("Unable to extract page ID from Notion URL");
        }
      }

      // if the page isn't accessible then end the process here.
      if (!pageId) {
        throw new Error("Notion page not found");
      }
      await notion.getPage(pageId);
    } catch (error) {
      throw new Error("This Notion page isn't publically available.");
    }
  }

  // For link type, validate URL format
  if (type === "link") {
    try {
      new URL(key);

      // Skip keyword check for trusted teams
      const trusted = await isTrustedTeam(teamId);
      if (!trusted) {
        const keywords = await get("keywords");
        if (Array.isArray(keywords) && keywords.length > 0) {
          const matchedKeyword = keywords.find(
            (keyword) =>
              typeof keyword === "string" &&
              key.toLowerCase().includes(keyword.toLowerCase()),
          );

          if (matchedKeyword) {
            log({
              message: `Link document creation blocked: ${matchedKeyword} \n\n \`Metadata: {teamId: ${teamId}, url: ${key}}\``,
              type: "error",
              mention: true,
            });
            throw new Error("This URL is not allowed");
          }
        }
      }
    } catch (error) {
      throw new Error("Invalid URL format for link document.");
    }
  }

  const folder = await prisma.folder.findUnique({
    where: {
      teamId_path: {
        teamId,
        path: "/" + folderPathName,
      },
    },
    select: {
      id: true,
    },
  });

  const isLogFile = name.toLowerCase().endsWith(".log");

  // determine if the document is download only
  const isDownloadOnly =
    type === "zip" ||
    type === "map" ||
    type === "email" ||
    contentType === "text/tab-separated-values" ||
    type === "cad" ||
    isLogFile;

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
    await convertKeynoteToPdfTask.trigger(
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
  } else if ((type === "docs" || type === "slides") && !isLogFile) {
    await convertFilesToPdfTask.trigger(
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

  if (
    type === "video" &&
    contentType !== "video/mp4" &&
    contentType?.startsWith("video/")
  ) {
    await processVideo.trigger(
      {
        videoUrl: key,
        teamId,
        docId: key.split("/")[1], // Extract doc_xxxx from teamId/doc_xxxx/filename
        documentVersionId: document.versions[0].id,
        fileSize: fileSize || 0,
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
    await copyFileToBucketServer({
      filePath: document.versions[0].file,
      storageType: document.versions[0].storageType,
      teamId,
    });

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
