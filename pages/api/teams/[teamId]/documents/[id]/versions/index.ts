import { NextApiRequest, NextApiResponse } from "next";

import { isTeamPausedById } from "@/ee/features/billing/cancellation/lib/is-team-paused";
import type { convertFilesToPdfTask } from "@/ee/features/conversions/lib/trigger/convert-files";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { tasks } from "@trigger.dev/sdk";
import { getServerSession } from "next-auth/next";

import { hashToken } from "@/lib/api/auth/token";
import { enforceDocumentMemberScope } from "@/lib/api/rbac/guard";
import { getFeatureFlags } from "@/lib/featureFlags";
import prisma from "@/lib/prisma";
import { processVideo } from "@/lib/trigger/optimize-video-files";
import { convertPdfToImageRoute } from "@/lib/trigger/pdf-to-image-route";
import { CustomUser } from "@/lib/types";
import { log } from "@/lib/utils";
import { isMarkdownFile } from "@/lib/utils/get-content-type";
import { conversionQueueName } from "@/lib/utils/trigger-utils";
import { videoProcessingMode } from "@/lib/video/processing-plan";
import { documentUploadSchema } from "@/lib/zod/url-validation";

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "POST") {
    // POST /api/teams/:teamId/documents/:id/versions
    const { teamId, id: documentId } = req.query as {
      teamId: string;
      id: string;
    };

    // Check for API token first, then fall back to session auth
    const authHeader = req.headers.authorization;
    let userId: string;

    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.replace("Bearer ", "");
      const hashedToken = hashToken(token);

      const restrictedToken = await prisma.restrictedToken.findUnique({
        where: { hashedKey: hashedToken },
        select: { userId: true, teamId: true },
      });

      if (!restrictedToken) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      if (restrictedToken.teamId !== teamId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      userId = restrictedToken.userId;
    } else {
      const session = await getServerSession(req, res, authOptions);
      if (!session) {
        return res.status(401).end("Unauthorized");
      }
      userId = (session.user as CustomUser).id;
    }

    // Scoped members may only add versions to documents in their rooms.
    if (await enforceDocumentMemberScope({ userId, teamId, documentId, res })) {
      return;
    }

    // Validate request body using Zod schema for security
    const validationResult = await documentUploadSchema.safeParseAsync({
      ...req.body,
      name: `Version ${new Date().toISOString()}`, // Dummy name for validation
    });

    if (!validationResult.success) {
      log({
        message: `Document version validation failed for documentId: ${documentId}, teamId: ${teamId}. Errors: ${JSON.stringify(validationResult.error.errors)}`,
        type: "error",
      });
      return res.status(400).json({
        error: "Invalid document version data",
        details: validationResult.error.errors,
      });
    }

    const { url, type, numPages, storageType, contentType, fileSize } =
      validationResult.data;

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
        select: {
          plan: true,
        },
      });

      if (!team) {
        return res.status(401).end("Unauthorized");
      }

      if (type === "html") {
        const featureFlags = await getFeatureFlags({ teamId });
        if (!featureFlags.htmlDocuments) {
          return res.status(403).json({
            error: "HTML documents are not enabled for this team.",
          });
        }
      }

      // Check if team is paused
      const teamIsPaused = await isTeamPausedById(teamId);
      if (teamIsPaused) {
        return res.status(403).json({
          error:
            "Team is currently paused. New document uploads are not available.",
        });
      }

      const document = await prisma.document.findUnique({
        where: {
          id: documentId,
          teamId,
        },
        select: {
          id: true,
          advancedExcelEnabled: true,
          versions: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { versionNumber: true },
          },
        },
      });

      if (!document) {
        return res.status(404).json({ error: "Document not found" });
      }

      // create a new document version
      const currentVersionNumber = document?.versions
        ? document.versions[0].versionNumber
        : 1;
      const version = await prisma.documentVersion.create({
        data: {
          documentId: documentId,
          file: url,
          originalFile: url,
          type: type,
          storageType,
          numPages: document?.advancedExcelEnabled ? 1 : numPages,
          isPrimary: true,
          versionNumber: currentVersionNumber + 1,
          contentType,
          fileSize,
        },
      });

      // turn off isPrimary flag for all other versions
      await prisma.documentVersion.updateMany({
        where: {
          documentId: documentId,
          id: { not: version.id },
        },
        data: {
          isPrimary: false,
        },
      });

      const isDownloadOnlyByExtension =
        /\.(log|err|prj|jgw|tif|tiff|ecw|bak)$/i.test(url);

      const isMarkdown = isMarkdownFile({ name: url, contentType });

      if (
        (type === "docs" || type === "slides") &&
        !isDownloadOnlyByExtension &&
        !isMarkdown
      ) {
        await tasks.trigger<typeof convertFilesToPdfTask>(
          "convert-files-to-pdf",
          {
            documentVersionId: version.id,
            teamId,
            documentId,
          },
          {
            idempotencyKey: `${teamId}-${version.id}-docs`,
            tags: [
              `team_${teamId}`,
              `document_${documentId}`,
              `version:${version.id}`,
            ],
            queue: conversionQueueName(team.plan),
            concurrencyKey: teamId,
          },
        );
      }

      const videoMode = videoProcessingMode({ type, contentType });
      if (videoMode) {
        await processVideo.trigger(
          {
            documentVersionId: version.id,
            mode: videoMode,
          },
          {
            idempotencyKey: `${teamId}-${version.id}-${videoMode}`,
            tags: [
              `team_${teamId}`,
              `document_${documentId}`,
              `version:${version.id}`,
            ],
            queue: conversionQueueName(team.plan),
            concurrencyKey: teamId,
          },
        );
      }

      // trigger document uploaded event to trigger convert-pdf-to-image job
      if (type === "pdf") {
        await convertPdfToImageRoute.trigger(
          {
            documentId: documentId,
            documentVersionId: version.id,
            teamId,
            // docId: version.file.split("/")[1], // Extract doc_xxxx from teamId/doc_xxxx/filename
            versionNumber: version.versionNumber,
          },
          {
            idempotencyKey: `${teamId}-${version.id}`,
            tags: [
              `team_${teamId}`,
              `document_${documentId}`,
              `version:${version.id}`,
            ],
            queue: conversionQueueName(team.plan),
            concurrencyKey: teamId,
          },
        );
      }

      res.status(200).json({ id: documentId });
    } catch (error) {
      log({
        message: `Failed to create new version for document: _${documentId}_. \n\n ${error} \n\n*Metadata*: \`{teamId: ${teamId}, userId: ${userId}}\``,
        type: "error",
      });
      return res.status(500).json({
        message: "Internal Server Error",
        error: (error as Error).message,
      });
    }
  } else {
    // We only allow GET requests
    res.setHeader("Allow", ["GET"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
