import { NextApiRequest, NextApiResponse } from "next";

import { getServerSession } from "next-auth/next";

import { errorhandler } from "@/lib/errorHandler";
import prisma from "@/lib/prisma";
import { convertFilesToPdfTask } from "@/lib/trigger/convert-files";
import { convertPdfToImageRoute } from "@/lib/trigger/pdf-to-image-route";
import { CustomUser } from "@/lib/types";
import { getExtension, log, serializeFileSize } from "@/lib/utils";
import { conversionQueueName } from "@/lib/utils/trigger-utils";
import { documentUploadSchema } from "@/lib/zod/url-validation";

import { authOptions } from "../../../auth/[...nextauth]";

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "POST") {
    // POST /api/teams/:teamId/documents/agreement
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      res.status(401).end("Unauthorized");
      return;
    }

    const { teamId } = req.query as { teamId: string };

    const userId = (session.user as CustomUser).id;

    // Validate request body using Zod schema for security
    const validationResult = await documentUploadSchema.safeParseAsync({
      ...req.body,
      // Ensure type field is provided for validation
      type: req.body.type || getExtension(req.body.name),
    });

    if (!validationResult.success) {
      log({
        message: `Agreement document validation failed for teamId: ${teamId}. Errors: ${JSON.stringify(validationResult.error.errors)}`,
        type: "error",
      });
      return res.status(400).json({
        error: "Invalid agreement document data",
        details: validationResult.error.errors,
      });
    }

    const {
      name,
      url: fileUrl,
      storageType,
      numPages,
      type,
      folderPathName,
      fileSize,
      contentType,
    } = validationResult.data;

    try {
      const team = await prisma.team.findUnique({
        where: {
          id: teamId,
          users: {
            some: {
              userId,
            },
          },
        },
        select: { plan: true },
      });

      if (!team) {
        return res.status(401).end("Unauthorized");
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

      // Save data to the database
      const document = await prisma.document.create({
        data: {
          name: name,
          numPages: numPages,
          file: fileUrl,
          originalFile: fileUrl,
          contentType,
          type,
          storageType,
          ownerId: (session.user as CustomUser).id,
          teamId: teamId,
          links: {
            // create link for agreement without any protection
            create: {
              name: "Generated Agreement Link",
              emailProtected: false,
              enableFeedback: false,
              enableNotification: false,
              teamId,
            },
          },
          versions: {
            create: {
              file: fileUrl,
              type,
              storageType,
              originalFile: fileUrl,
              contentType,
              numPages: numPages,
              fileSize: fileSize,
              isPrimary: true,
              versionNumber: 1,
            },
          },
          folderId: folder?.id ? folder.id : null,
        },
        include: {
          links: true,
          versions: true,
        },
      });

      const isLogFile = name.toLowerCase().endsWith(".log");

      if (type === "docs" && !isLogFile) {
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
            queue: conversionQueueName(team.plan),
            concurrencyKey: teamId,
          },
        );
      }

      if (type === "pdf") {
        await convertPdfToImageRoute.trigger(
          {
            documentId: document.id,
            documentVersionId: document.versions[0].id,
            teamId,
            // docId: fileUrl.split("/")[1],
          },
          {
            idempotencyKey: `${teamId}-${document.versions[0].id}`,
            tags: [
              `team_${teamId}`,
              `document_${document.id}`,
              `version:${document.versions[0].id}`,
            ],
            queue: conversionQueueName(team.plan),
            concurrencyKey: teamId,
          },
        );
      }

      return res.status(201).json(serializeFileSize(document));
    } catch (error) {
      log({
        message: `Failed to create document. \n\n*teamId*: _${teamId}_, \n\n*file*: ${fileUrl} \n\n ${error}`,
        type: "error",
      });
      errorhandler(error, res);
    }
  } else {
    // We only allow GET and POST requests
    res.setHeader("Allow", ["GET", "POST"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
