import { NextApiRequest, NextApiResponse } from "next";

import { ItemType, ViewType } from "@prisma/client";
import { waitUntil } from "@vercel/functions";

import { getFile } from "@/lib/files/get-file";
import { notifyDocumentDownload } from "@/lib/integrations/slack/events";
import prisma from "@/lib/prisma";
import { getFileNameWithPdfExtension } from "@/lib/utils";
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
    const { linkId, viewId, documentId } = req.body as {
      linkId: string;
      viewId: string;
      documentId: string;
    };

    try {
      const view = await prisma.view.findUnique({
        where: {
          id: viewId,
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

      // if dataroom does not exist, we should not allow the download
      if (!view.dataroom) {
        return res.status(404).json({ error: "Error downloading" });
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

        const permittedDocumentIds = groupPermissions
          .filter(
            (permission) => permission.itemType === ItemType.DATAROOM_DOCUMENT,
          )
          .map((permission) => permission.itemId);

        downloadDocuments = downloadDocuments.filter((doc) =>
          permittedDocumentIds.includes(doc.id),
        );

        // If no group permission, check if this is the viewer's own upload
        if (downloadDocuments.length === 0 && view.viewerId) {
          const originalDocs = view.dataroom.documents;
          if (originalDocs.length > 0) {
            const upload = await prisma.documentUpload.findFirst({
              where: {
                documentId: documentId,
                viewerId: view.viewerId,
                dataroomId: view.dataroom.id,
              },
              select: { id: true },
            });
            if (upload) {
              downloadDocuments = originalDocs;
            }
          }
        }
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

      const downloadUrl = await getFile({
        type: downloadDocuments[0].document!.versions[0].storageType,
        data: file,
        isDownload: true,
      });

      // For PDF files with watermark, always buffer and process
      if (
        downloadDocuments[0].document!.versions[0].type === "pdf" &&
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
              numPages: downloadDocuments[0].document!.versions[0].numPages,
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

        // Set appropriate headers for watermarked PDF
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${encodeURIComponent(getFileNameWithPdfExtension(downloadDocuments[0].document!.name))}"`,
        );
        res.setHeader("Content-Length", Buffer.from(pdfBuffer).length);

        // Send the watermarked buffer directly
        return res.send(Buffer.from(pdfBuffer));
      }

      // For non-watermarked PDFs, we need to buffer and set proper headers
      // - contentType is application/pdf
      // - contentType is null and type is pdf
      // - contentType starts with image/
      if (
        downloadDocuments[0].document!.versions[0].contentType ===
          "application/pdf" ||
        (downloadDocuments[0].document!.versions[0].contentType === null &&
          downloadDocuments[0].document!.versions[0].type === "pdf") ||
        downloadDocuments[0].document!.versions[0].contentType?.startsWith(
          "image/",
        )
      ) {
        const response = await fetch(downloadUrl);
        if (!response.ok) {
          return res.status(500).json({ error: "Error downloading file" });
        }

        const pdfBuffer = await response.arrayBuffer();

        // Set appropriate headers to force download
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${encodeURIComponent(downloadDocuments[0].document!.name)}"`,
        );
        res.setHeader("Content-Length", Buffer.from(pdfBuffer).length);
        res.setHeader("Cache-Control", "no-cache");

        // Send the PDF buffer directly
        return res.send(Buffer.from(pdfBuffer));
      }

      const headResponse = await fetch(downloadUrl, { method: "HEAD" });
      const contentType =
        downloadDocuments[0].document!.versions[0].contentType ||
        headResponse.headers.get("content-type") ||
        "application/octet-stream";
      const fileName = downloadDocuments[0].document!.name;

      // For all other files, return direct download URL
      return res.status(200).json({
        downloadUrl,
        fileName,
        contentType,
        isDirectDownload: true,
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
