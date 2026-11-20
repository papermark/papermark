import { NextApiRequest, NextApiResponse } from "next";

import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { getServerSession } from "next-auth/next";

import { errorhandler } from "@/lib/errorHandler";
import { getFile } from "@/lib/files/get-file";
import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "POST") {
    // POST /api/teams/:teamId/agreements/:agreementId/download
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      res.status(401).end("Unauthorized");
      return;
    }

    const userId = (session.user as CustomUser).id;
    const { teamId, agreementId } = req.query as {
      teamId: string;
      agreementId: string;
    };

    if (!teamId || !agreementId) {
      return res.status(400).json("Missing required parameters");
    }

    try {
      // Check if user belongs to the team and get the agreement
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
          id: true,
          name: true,
          agreements: {
            where: {
              id: agreementId,
              deletedAt: null, // Only allow downloading non-deleted agreements
            },
            select: {
              id: true,
              name: true,
              content: true,
              contentType: true,
              signingProvider: true,
              requireName: true,
              createdAt: true,
              updatedAt: true,
              signingExternalId: true,
              signingEnvelopeId: true,
              signingTemplateId: true,
              _count: {
                select: {
                  links: true,
                  responses: true,
                },
              },
            },
          },
        },
      });

      if (!team || team.agreements.length === 0) {
        return res.status(404).json("Agreement not found or unauthorized");
      }

      const agreement = team.agreements[0];

      // Check if the content is a Papermark URL
      const isPapermarkUrl =
        agreement.content.includes("papermark.com/view/") ||
        agreement.content.includes("www.papermark.com/view/");

      let fileContent: string;
      let filename: string;
      let link: any = null;

      if (isPapermarkUrl) {
        // Extract linkId from Papermark URL
        const urlParts = agreement.content.split("/view/");
        if (urlParts.length < 2) {
          return res.status(400).json("Invalid Papermark URL format");
        }

        const linkId = urlParts[1].split(/[/?#]/)[0]; // Get linkId, remove any query params or fragments

        // Fetch the link and its document
        link = await prisma.link.findUnique({
          where: { id: linkId },
          include: {
            document: {
              select: {
                name: true,
                file: true,
                originalFile: true,
                storageType: true,
                type: true,
                contentType: true,
                versions: {
                  where: { isPrimary: true },
                  select: {
                    file: true,
                    originalFile: true,
                    storageType: true,
                    type: true,
                    contentType: true,
                  },
                  take: 1,
                },
              },
            },
          },
        });

        if (!link || !link.document) {
          return res
            .status(404)
            .json("Document not found for the provided Papermark URL");
        }

        // Use the primary version if available, otherwise use the document file
        const documentVersion = link.document.versions[0];
        const fileKey = documentVersion
          ? documentVersion.originalFile || documentVersion.file
          : link.document.originalFile || link.document.file;
        const storageType = documentVersion
          ? documentVersion.storageType
          : link.document.storageType;
        const fileType = documentVersion
          ? documentVersion.type
          : link.document.type;

        // Get the file URL from storage
        const fileUrl = await getFile({
          type: storageType,
          data: fileKey,
          isDownload: true,
        });

        // Fetch the actual file content with safety measures
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

        const fileResponse = await fetch(fileUrl, {
          signal: controller.signal,
          // Add size limit check in the response handling
        });

        clearTimeout(timeoutId);

        if (!fileResponse.ok) {
          throw new Error("Failed to fetch document content");
        }

        // Use the document name for filename
        const docName = link.document.name.replace(/\.[^/.]+$/, ""); // Remove extension
        let extension = "txt";
        if (fileType === "pdf") extension = "pdf";
        else if (fileType === "docs") extension = "docx";
        else if (fileType === "slides") extension = "pptx";
        else if (fileType === "sheet") extension = "xlsx";

        filename = `${docName
          .replace(/[^a-z0-9\-_]/gi, "_")
          .toLowerCase()
          .substring(0, 50)}_agreement.${extension}`;

        // Handle different file types appropriately
        const isPdf =
          fileType === "pdf" || link.document.contentType?.includes("pdf");
        const isDocx =
          fileType === "docs" ||
          link.document.contentType?.includes("wordprocessingml");

        if (isPdf || isDocx) {
          // Handle binary files (PDFs, Word docs)
          const buffer = await fileResponse.arrayBuffer();
          let contentType =
            link.document.contentType || "application/octet-stream";

          if (isPdf) contentType = "application/pdf";
          else if (isDocx)
            contentType =
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

          res.setHeader("Content-Type", contentType);
          res.setHeader(
            "Content-Disposition",
            `attachment; filename="${filename}"`,
          );
          res.setHeader("Content-Length", buffer.byteLength.toString());
          return res.send(Buffer.from(buffer));
        } else {
          // Handle text-based files
          fileContent = await fileResponse.text();
        }
      } else {
        // Regular URL - return formatted metadata as before
        fileContent = `
AGREEMENT DETAILS
================

Name: ${agreement.name}
Signing Provider: ${agreement.signingProvider}
Content Type: ${agreement.contentType}
URL: ${agreement.content}
Requires Name: ${agreement.requireName ? "Yes" : "No"}
Created: ${agreement.createdAt.toLocaleDateString()} at ${agreement.createdAt.toLocaleTimeString()}
Last Updated: ${agreement.updatedAt.toLocaleDateString()} at ${agreement.updatedAt.toLocaleTimeString()}
Team: ${team.name}

SIGNING METADATA
================

External ID: ${agreement.signingExternalId || "N/A"}
Envelope ID: ${agreement.signingEnvelopeId || "N/A"}
Template ID: ${agreement.signingTemplateId || "N/A"}

USAGE STATISTICS
===============

Used in ${agreement._count.links} link${agreement._count.links === 1 ? "" : "s"}
Total responses: ${agreement._count.responses}

AGREEMENT URL
=============

${agreement.content}

---
Downloaded on: ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}
Agreement ID: ${agreement.id}
        `.trim();

        filename = `${agreement.name
          .replace(/[^a-z0-9\-_]/gi, "_")
          .toLowerCase()
          .substring(0, 50)}_agreement.txt`;
      }

      // Set headers for file download (only for text files - PDFs are handled above)
      if (fileContent) {
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${filename}"`,
        );
        res.setHeader("Content-Length", Buffer.byteLength(fileContent, "utf8"));
        return res.send(fileContent);
      }
    } catch (error) {
      errorhandler(error, res);
    }
  } else {
    // We only allow POST requests
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
