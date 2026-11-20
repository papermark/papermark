import { NextApiRequest, NextApiResponse } from "next";

import { ItemType, ViewType } from "@prisma/client";
import { waitUntil } from "@vercel/functions";

import { getDataroomSessionByLinkIdInPagesRouter } from "@/lib/auth/dataroom-auth";
import { getFile } from "@/lib/files/get-file";
import { notifyDocumentDownload } from "@/lib/integrations/slack/events";
import prisma from "@/lib/prisma";
import {
  buildAttachmentDispositionForName,
  getFileNameWithPdfExtension,
} from "@/lib/utils";
import { ensureFileExtension } from "@/lib/utils/get-content-type";
import { getIpAddress } from "@/lib/utils/ip";

export const config = {
  maxDuration: 300,
};

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "POST") {
    // POST /api/links/download/dataroom-document
    const { linkId, documentId } = req.body as {
      linkId: string;
      documentId: string;
    };

    try {
      const session = await getDataroomSessionByLinkIdInPagesRouter(
        req,
        linkId,
      );
      if (!session) {
        return res.status(401).json({ error: "Session required to download" });
      }

      const view = await prisma.view.findUnique({
        where: {
          id: session.viewId,
          linkId: linkId,
          viewType: { equals: ViewType.DATAROOM_VIEW },
        },
        select: {
          id: true,
          viewedAt: true,
          viewerEmail: true,
          viewerId: true,
          verified: true,
          link: {
            select: {
              allowDownload: true,
              expiresAt: true,
              isArchived: true,
              deletedAt: true,
              emailAuthenticated: true,
              enableWatermark: true,
              watermarkConfig: true,
              name: true,
              permissionGroupId: true,
              teamId: true,
            },
          },
          groupId: true,
          dataroom: {
            select: {
              id: true,
              documents: {
                where: { document: { id: documentId } },
                select: {
                  id: true,
                  document: {
                    select: {
                      id: true,
                      name: true,
                      versions: {
                        where: { isPrimary: true },
                        select: {
                          id: true,
                          type: true,
                          file: true,
                          storageType: true,
                          originalFile: true,
                          numPages: true,
                          contentType: true,
                        },
                        take: 1,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      });

      // if view does not exist, we should not allow the download
      if (!view) {
        return res.status(404).json({ error: "Error downloading" });
      }

      // if dataroom does not exist, we should not allow the download
      if (!view.dataroom) {
        return res.status(404).json({ error: "Error downloading" });
      }

      if (session.dataroomId !== view.dataroom.id) {
        return res.status(403).json({ error: "Error downloading" });
      }

      if (view.link.emailAuthenticated && !session.verified) {
        return res.status(403).json({ error: "Error downloading" });
      }

      // if link does not allow download, we should not allow the download
      if (!view.link.allowDownload) {
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

      // if viewedAt is longer than 23 hours ago, we should not allow the download
      if (
        view.viewedAt &&
        view.viewedAt < new Date(Date.now() - 23 * 60 * 60 * 1000)
      ) {
        return res.status(403).json({ error: "Error downloading" });
      }

      let downloadDocuments = view.dataroom.documents;

      // Check permissions based on groupId (ViewerGroup) or permissionGroupId (PermissionGroup)
      const effectiveGroupId = view.groupId || view.link.permissionGroupId;

      if (effectiveGroupId) {
        let groupPermissions: any[] = [];

        if (view.groupId) {
          // This is a ViewerGroup (legacy behavior)
          groupPermissions = await prisma.viewerGroupAccessControls.findMany({
            where: { groupId: view.groupId, canDownload: true },
          });
        } else if (view.link.permissionGroupId) {
          // This is a PermissionGroup (new behavior)
          groupPermissions =
            await prisma.permissionGroupAccessControls.findMany({
              where: {
                groupId: view.link.permissionGroupId,
                canDownload: true,
              },
            });
        }

        const permittedDocumentIds = new Set(
          groupPermissions
            .filter(
              (permission) =>
                permission.itemType === ItemType.DATAROOM_DOCUMENT,
            )
            .map((permission) => permission.itemId as string),
        );

        // Fallback: viewer-uploaded docs aren't tied to the link's
        // permission group. Allow the original uploader through, scoped to
        // the current viewer's id.
        const candidateDocIds = downloadDocuments
          .filter((doc) => !permittedDocumentIds.has(doc.id))
          .map((doc) => doc.id);

        if (candidateDocIds.length > 0 && view.viewerId) {
          const viewerUploads = await prisma.documentUpload.findMany({
            where: {
              linkId,
              viewerId: view.viewerId,
              dataroomDocumentId: { in: candidateDocIds },
            },
            select: { dataroomDocumentId: true },
          });
          for (const upload of viewerUploads) {
            if (upload.dataroomDocumentId) {
              permittedDocumentIds.add(upload.dataroomDocumentId);
            }
          }
        }

        downloadDocuments = downloadDocuments.filter((doc) =>
          permittedDocumentIds.has(doc.id),
        );
      }

      if (downloadDocuments.length === 0) {
        return res.status(403).json({ error: "Error downloading" });
      }

      //creates new view for document
      await prisma.view.create({
        data: {
          viewType: "DOCUMENT_VIEW",
          documentId: documentId,
          linkId: linkId,
          dataroomId: view.dataroom.id,
          groupId: view.groupId,
          dataroomViewId: view.id,
          viewerEmail: view.viewerEmail,
          downloadedAt: new Date(),
          downloadType: "SINGLE",
          viewerId: view.viewerId,
          verified: view.verified,
        },
      });

      if (view.link.teamId) {
        waitUntil(
          notifyDocumentDownload({
            teamId: view.link.teamId,
            documentId,
            dataroomId: view.dataroom.id,
            linkId,
            viewerEmail: view.viewerEmail ?? undefined,
            viewerId: view.viewerId ?? undefined,
          }),
        );
      } else {
        console.log("No teamId found, skipping Slack notification");
      }

      const file =
        view.link.enableWatermark &&
        downloadDocuments[0].document!.versions[0].type === "pdf"
          ? downloadDocuments[0].document!.versions[0].file
          : (downloadDocuments[0].document!.versions[0].originalFile ??
            downloadDocuments[0].document!.versions[0].file);

      // Pre-compute the user-facing download filename (renamed name + correct
      // extension). We pass it as ResponseContentDisposition on the S3
      // presigned URL so the browser uses it instead of the original
      // upload-time disposition stored on the S3 object. CloudFront-fronted
      // origins ignore this and still return the stored disposition.
      const versionForName = downloadDocuments[0].document!.versions[0];
      const desiredFileName = ensureFileExtension({
        name: downloadDocuments[0].document!.name,
        contentType: versionForName.contentType,
        type: versionForName.type,
      });

      const downloadUrl = await getFile({
        type: versionForName.storageType,
        data: file,
        isDownload: true,
        responseContentDisposition: desiredFileName
          ? buildAttachmentDispositionForName(desiredFileName)
          : undefined,
      });

      const versionType = downloadDocuments[0].document!.versions[0].type;

      // For PDFs and images with watermark, buffer and process. Images are
      // converted to a watermarked PDF.
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
              fileType: versionType === "image" ? "image" : "pdf",
              numPages:
                versionType === "image"
                  ? 1
                  : downloadDocuments[0].document!.versions[0].numPages,
              // Flatten form/annotation/layers; the watermark is drawn into
              // the page content stream so it can't be removed as a layer.
              flatten: true,
              watermarkConfig: view.link.watermarkConfig,
              originalFileName: downloadDocuments[0].document!.name,
              viewerData: {
                email: view.viewerEmail,
                date: (view.viewedAt
                  ? new Date(view.viewedAt)
                  : new Date()
                ).toLocaleDateString(),
                ipAddress: getIpAddress(req.headers),
                link: view.link.name,
                time: (view.viewedAt
                  ? new Date(view.viewedAt)
                  : new Date()
                ).toLocaleTimeString(),
              },
            }),
          },
        );

        if (!response.ok) {
          return res.status(500).json({ error: "Error downloading" });
        }

        const pdfBuffer = await response.arrayBuffer();

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
          "Content-Disposition",
          buildAttachmentDispositionForName(
            getFileNameWithPdfExtension(downloadDocuments[0].document!.name),
          ),
        );
        res.setHeader("Content-Length", Buffer.from(pdfBuffer).length);

        // Send the watermarked buffer directly
        return res.send(Buffer.from(pdfBuffer));
      }

      // For everything else (PDFs, images, sheets, slides, archives, ...)
      // we hand back the presigned URL with the renamed Content-Disposition
      // baked in via response-content-disposition. The client iframes it,
      // CloudFront/S3 returns the bytes directly, and the OS saves the file
      // with the right name + extension. No need to buffer through Vercel.
      return res.status(200).json({
        downloadUrl,
        fileName: desiredFileName,
      });
    } catch (error) {
      console.error("Error:", error);
      return res.status(500).json({ error: "Error downloading file" });
    }
  } else {
    // We only allow POST requests
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
