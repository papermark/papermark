import { NextApiRequest, NextApiResponse } from "next";

import { getServerSession } from "next-auth/next";

import { getTeamStorageConfigById } from "@/ee/features/storage/config";

import { getFile } from "@/lib/files/get-file";
import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";
import { log } from "@/lib/utils";

import { authOptions } from "../../../../auth/[...nextauth]";

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const { id: documentId, teamId } = req.query as {
    id: string;
    teamId: string;
  };
  const userId = (session.user as CustomUser).id;

  try {
    const team = await prisma.team.findUnique({
      where: {
        id: teamId,
        users: {
          some: { userId },
        },
      },
    });

    if (!team) {
      return res.status(403).json({ message: "Access denied" });
    }

    // Fetch document and verify team membership
    const document = await prisma.document.findUnique({
      where: { id: documentId },
      include: {
        team: {
          include: {
            users: {
              where: { userId },
              select: { userId: true },
            },
          },
        },
        versions: {
          where: { isPrimary: true },
          select: {
            id: true,
            type: true,
            hasPages: true,
            numPages: true,
            isVertical: true,
            file: true,
            storageType: true,
            pages: {
              orderBy: { pageNumber: "asc" },
              select: {
                file: true,
                storageType: true,
                pageNumber: true,
                embeddedLinks: true,
                pageLinks: true,
                metadata: true,
              },
            },
          },
        },
      },
    });

    // Check if document exists and user is team member
    if (!document || document.team.users.length === 0) {
      return res.status(403).json({ message: "Access denied" });
    }

    const primaryVersion = document.versions[0];
    if (!primaryVersion) {
      return res.status(404).json({ message: "Document version not found" });
    }

    // Prepare return data structure
    const returnData = {
      documentId,
      documentName: document.name,
      documentType: document.type,
      fileType: primaryVersion.type,
      isVertical: primaryVersion.isVertical,
      numPages: primaryVersion.numPages,
      advancedExcelEnabled: document.advancedExcelEnabled,
      pages: undefined as any,
      file: undefined as string | undefined,
      sheetData: undefined as any,
    };

    const INITIAL_PAGES_TO_LOAD = 10;

    // Handle different file types
    if (primaryVersion.hasPages && primaryVersion.pages.length > 0) {
      // Documents with pages (PDFs, docs, slides)
      // Only sign URLs for the first batch of pages to avoid timeouts on large documents.
      // Remaining page URLs are fetched on-demand by the client via preview-pages endpoint.
      returnData.pages = await Promise.all(
        primaryVersion.pages.map(async (page, index) => {
          const { storageType, ...otherPageData } = page;
          return {
            ...otherPageData,
            file:
              index < INITIAL_PAGES_TO_LOAD
                ? await getFile({ data: page.file, type: storageType })
                : null,
          };
        }),
      );
    } else if (primaryVersion.type === "image") {
      // Single image files
      returnData.file = await getFile({
        data: primaryVersion.file,
        type: primaryVersion.storageType,
      });
      returnData.numPages = 1;
    } else if (primaryVersion.type === "sheet") {
      if (document.advancedExcelEnabled) {
        // Advanced Excel mode: use Office Online viewer URL
        if (!primaryVersion.file.includes("https://")) {
          const storageConfig = await getTeamStorageConfigById(document.teamId);
          returnData.file = `https://${storageConfig.advancedDistributionHost}/${primaryVersion.file}`;
        } else {
          returnData.file = primaryVersion.file;
        }
        returnData.numPages = 1;
      }
      // Non-advanced sheets: return 200 with advancedExcelEnabled=false so
      // PreviewViewer renders its inline fallback instead of showing an error.
    } else if (primaryVersion.type === "notion") {
      // Notion documents - preview not supported
      return res.status(400).json({
        message: "Notion document preview coming soon",
      });
    } else {
      // Check if document should be processed but isn't
      const shouldHavePages = ["pdf", "docs", "slides", "cad"].includes(
        primaryVersion.type || "",
      );

      if (shouldHavePages) {
        return res.status(400).json({
          message: "Document is still processing. Please wait and try again.",
        });
      } else {
        return res.status(400).json({
          message: "Preview not available for this document type",
        });
      }
    }

    return res.status(200).json(returnData);
  } catch (error) {
    log({
      message: "Error fetching document preview data",
      type: "error",
      mention: true,
    });
    console.error(error);
    return res.status(500).json({ message: "Internal server error" });
  }
}
