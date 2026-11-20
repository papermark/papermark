import { NextApiRequest, NextApiResponse } from "next";

import { LinkType } from "@prisma/client";

import { verifyDataroomSessionInPagesRouter } from "@/lib/auth/dataroom-auth";
import { verifyLinkSessionInPagesRouter } from "@/lib/auth/link-session";
import { getFile } from "@/lib/files/get-file";
import { notifyDocumentDownload } from "@/lib/integrations/slack/events";
import prisma from "@/lib/prisma";
import {
  buildAttachmentDispositionForName,
  getFileNameWithPdfExtension,
} from "@/lib/utils";
import { ensureFileExtension } from "@/lib/utils/get-content-type";
import { getIpAddress } from "@/lib/utils/ip";

// This function can run for a maximum of 300 seconds
export const config = {
  maxDuration: 300,
};

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "POST") {
    // POST /api/links/download
    const { linkId, viewId } = req.body as { linkId: string; viewId: string };

    try {
      const view = await prisma.view.findUnique({
        where: {
          id: viewId,
          linkId: linkId,
        },
        select: {
          id: true,
          dataroomId: true,
          dataroomViewId: true,
          viewedAt: true,
          viewerEmail: true,
          link: {
            select: {
              linkType: true,
              emailAuthenticated: true,
              allowDownload: true,
              expiresAt: true,
              isArchived: true,
              deletedAt: true,
              enableWatermark: true,
              watermarkConfig: true,
              name: true,
            },
          },
          document: {
            select: {
              id: true,
              teamId: true,
              downloadOnly: true,
              name: true,
              versions: {
                where: { isPrimary: true },
                select: {
                  type: true,
                  file: true,
                  storageType: true,
                  numPages: true,
                  originalFile: true,
                  contentType: true,
                },
                take: 1,
              },
            },
          },
        },
      });

      // if view does not exist, we should not allow the download
      if (!view) {
        return res.status(404).json({ error: "Error downloading" });
      }

      if (view.link.linkType === LinkType.DATAROOM_LINK) {
        const session = await verifyDataroomSessionInPagesRouter(
          req,
          linkId,
          view.dataroomId ?? "",
        );
        if (!session) {
          return res
            .status(401)
            .json({ error: "Session required to download" });
        }

        if (!view.dataroomViewId || session.viewId !== view.dataroomViewId) {
          return res.status(403).json({ error: "Error downloading" });
        }

        if (view.link.emailAuthenticated && !session.verified) {
          return res.status(403).json({ error: "Error downloading" });
        }
      } else if (view.link.linkType === LinkType.DOCUMENT_LINK) {
        const session = await verifyLinkSessionInPagesRouter(req, linkId);
        if (!session) {
          return res
            .status(401)
            .json({ error: "Session required to download" });
        }

        if (
          session.linkType !== LinkType.DOCUMENT_LINK ||
          session.viewId !== view.id ||
          session.documentId !== view.document?.id
        ) {
          return res.status(403).json({ error: "Error downloading" });
        }

        if (view.link.emailAuthenticated && !session.verified) {
          return res.status(403).json({ error: "Error downloading" });
        }
      }

      // if document is downloadOnly, always allow. Otherwise, check link settings.
      if (!view.document?.downloadOnly && !view.link.allowDownload) {
        return res.status(403).json({ error: "Error downloading" });
      }

      // if link is archived, we should not allow the download
      if (view.link.isArchived) {
        return res.status(403).json({ error: "Error downloading" });
      }

      // if link is deleted, we should not allow the download
      if (view.link.deletedAt) {
        return res.status(403).json({ error: "Error downloading" });
      }

      // if link is expired, we should not allow the download
      if (view.link.expiresAt && view.link.expiresAt < new Date()) {
        return res.status(403).json({ error: "Error downloading" });
      }

      // if document is a Notion document, we should not allow the download
      if (view.document!.versions[0].type === "notion") {
        return res.status(403).json({ error: "Error downloading" });
      }

      // if viewedAt is longer than 30 mins ago, we should not allow the download for document links and 23 hours ago for dataroom links
      if (
        (view.link.linkType === LinkType.DOCUMENT_LINK &&
          view.viewedAt < new Date(Date.now() - 30 * 60 * 1000)) ||
        (view.link.linkType === LinkType.DATAROOM_LINK &&
          view.viewedAt < new Date(Date.now() - 23 * 60 * 60 * 1000))
      ) {
        return res.status(403).json({ error: "Error downloading" });
      }

      // update the view with the downloadedAt timestamp
      await prisma.view.update({
        where: { id: viewId },
        data: { downloadedAt: new Date() },
      });

      if (view.document?.teamId) {
        try {
          await notifyDocumentDownload({
            teamId: view.document.teamId,
            documentId: view.document.id,
            dataroomId: undefined,
            linkId,
            viewerEmail: view.viewerEmail ?? undefined,
            viewerId: undefined,
          });
        } catch (error) {
          console.error("Error sending Slack notification:", error);
        }
      }

      // get the file to be downloaded, if watermark is enabled and document is not pdf, then get the pdf file, otherwise return the original file
      // if watermark is enabled and watermark config is present and document version is pdf, then get the file
      // if watermark is not enabled, then get the original file
      const file =
        view.link.enableWatermark &&
        view.link.watermarkConfig &&
        view.document!.versions[0].type === "pdf"
          ? view.document!.versions[0].file
          : (view.document!.versions[0].originalFile ??
            view.document!.versions[0].file);

      // Pre-compute the user-facing filename (renamed doc name + correct
      // extension). Pass it as ResponseContentDisposition so the browser
      // uses our name even when downloading via direct presigned URL.
      const desiredFileName = ensureFileExtension({
        name: view.document!.name,
        contentType: view.document!.versions[0].contentType,
        type: view.document!.versions[0].type,
      });

      const downloadUrl = await getFile({
        type: view.document!.versions[0].storageType,
        data: file,
        isDownload: true,
        responseContentDisposition: desiredFileName
          ? buildAttachmentDispositionForName(desiredFileName)
          : undefined,
      });

      const versionType = view.document!.versions[0].type;

      if (
        (versionType === "pdf" || versionType === "image") &&
        view.link.enableWatermark &&
        view.link.watermarkConfig
      ) {
        const response = await fetch(
          `${process.env.NEXTAUTH_URL}/api/mupdf/annotate-document`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${process.env.INTERNAL_API_KEY}`,
            },
            body: JSON.stringify({
              url: downloadUrl,
              // Images are a single page; convert them to a watermarked PDF.
              fileType: versionType === "image" ? "image" : "pdf",
              numPages:
                versionType === "image"
                  ? 1
                  : view.document!.versions[0].numPages,
              // Flatten form/annotation/layers; the watermark is drawn into
              // the page content stream so it can't be removed as a layer.
              flatten: true,
              watermarkConfig: view.link.watermarkConfig,
              originalFileName: view.document!.name,
              viewerData: {
                email: view.viewerEmail,
                date: new Date(
                  view.viewedAt ? view.viewedAt : new Date(),
                ).toLocaleDateString(),
                ipAddress: getIpAddress(req.headers),
                link: view.link.name,
                time: new Date(
                  view.viewedAt ? view.viewedAt : new Date(),
                ).toLocaleTimeString(),
              },
            }),
          },
        );

        if (!response.ok) {
          // Try to get the specific error details from the watermarking API
          let errorMessage = "Error downloading";
          try {
            const errorData = await response.json();
            if (errorData.error && errorData.details) {
              errorMessage = `${errorData.error}: ${errorData.details}`;
            } else if (errorData.error) {
              errorMessage = errorData.error;
            }
          } catch {
            // If we can't parse the error response, use generic message
            errorMessage = "Error downloading";
          }

          return res.status(500).json({ error: errorMessage });
        }

        const pdfBuffer = await response.arrayBuffer();

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
          "Content-Disposition",
          buildAttachmentDispositionForName(
            getFileNameWithPdfExtension(view.document!.name),
          ),
        );
        res.setHeader("Content-Length", Buffer.from(pdfBuffer).length);

        // Send the watermarked buffer directly
        return res.send(Buffer.from(pdfBuffer));
      }

      return res.status(200).json({
        downloadUrl,
        fileName: desiredFileName,
      });
    } catch (error) {
      return res.status(500).json({
        message: "Internal Server Error",
        error: (error as Error).message,
      });
    }
  }

  // We only allow POST requests
  res.setHeader("Allow", ["POST"]);
  return res.status(405).end(`Method ${req.method} Not Allowed`);
}
