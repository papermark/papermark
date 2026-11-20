import { NextApiRequest, NextApiResponse } from "next";

import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { ItemType } from "@prisma/client";
import { getServerSession } from "next-auth/next";

import {
  DataroomIndexSource,
  generateDataroomIndex,
} from "@/lib/dataroom/index-generator";
import { resolveDataroomIndexEnabledForViewer } from "@/lib/featureFlags/dataroom-index-viewer";
import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";
import { IndexFileFormat } from "@/lib/types/index-file";

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const userId = (session.user as CustomUser).id;
  const { teamId, id: dataroomId } = req.query as {
    teamId: string;
    id: string;
  };
  const { format = "excel", linkId } = req.body as {
    format: IndexFileFormat;
    linkId: string;
  };

  try {
    // Check if user has access to the team
    const team = await prisma.team.findUnique({
      where: {
        id: teamId,
        users: {
          some: {
            userId: userId,
          },
        },
      },
    });

    if (!team) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!team.plan.includes("datarooms") && !team.plan.includes("trial")) {
      return res.status(401).json({
        error: "Please upgrade to a Data Rooms plan to generate an index",
      });
    }

    // Get the dataroom link with all necessary data
    const link = await prisma.link.findUnique({
      where: {
        id: linkId,
      },
      select: {
        id: true,
        dataroomId: true,
        linkType: true,
        url: true,
        name: true,
        slug: true,
        expiresAt: true,
        createdAt: true,
        updatedAt: true,
        teamId: true,
        isArchived: true,
        domainId: true,
        domainSlug: true,
        groupId: true,
        permissionGroupId: true,
        dataroom: {
          select: {
            id: true,
            name: true,
            teamId: true,
            documents: {
              include: {
                document: {
                  include: {
                    versions: { where: { isPrimary: true } },
                  },
                },
              },
            },
            folders: true,
            updatedAt: true,
            createdAt: true,
          },
        },
      },
    });

    if (
      !link ||
      !link.dataroom ||
      link.dataroom.id !== dataroomId ||
      link.teamId !== teamId ||
      link.dataroom.teamId !== teamId
    ) {
      return res.status(404).json({ error: "Link not found" });
    }

    // check if link is expired or archived
    if (link.expiresAt && link.expiresAt < new Date()) {
      return res.status(404).json({ error: "Link expired" });
    }

    if (link.isArchived) {
      return res.status(404).json({ error: "Link archived" });
    }

    // Check if the link is a group link and remove the folder/documents from the dataroom if not part of the group permissions
    if (link.groupId) {
      const groupAccessControls =
        await prisma.viewerGroupAccessControls.findMany({
          where: {
            groupId: link.groupId,
            OR: [{ canView: true }, { canDownload: true }],
          },
          select: {
            itemId: true,
            itemType: true,
          },
        });

      const allowedDocuments = groupAccessControls
        .filter((control) => control.itemType === ItemType.DATAROOM_DOCUMENT)
        .map((control) => control.itemId);
      const allowedFolders = groupAccessControls
        .filter((control) => control.itemType === ItemType.DATAROOM_FOLDER)
        .map((control) => control.itemId);

      link.dataroom.documents = link.dataroom.documents.filter((doc) =>
        allowedDocuments.includes(doc.id),
      );
      link.dataroom.folders = link.dataroom.folders.filter((folder) =>
        allowedFolders.includes(folder.id),
      );
    }

    // Check if the link has permission group restrictions and filter accordingly
    if (link.permissionGroupId) {
      const permissionGroupAccessControls =
        await prisma.permissionGroupAccessControls.findMany({
          where: {
            groupId: link.permissionGroupId,
            OR: [{ canView: true }, { canDownload: true }],
          },
          select: {
            itemId: true,
            itemType: true,
          },
        });

      const allowedDocuments = permissionGroupAccessControls
        .filter((control) => control.itemType === ItemType.DATAROOM_DOCUMENT)
        .map((control) => control.itemId);
      const allowedFolders = permissionGroupAccessControls
        .filter((control) => control.itemType === ItemType.DATAROOM_FOLDER)
        .map((control) => control.itemId);

      link.dataroom.documents = link.dataroom.documents.filter((doc) =>
        allowedDocuments.includes(doc.id),
      );
      link.dataroom.folders = link.dataroom.folders.filter((folder) =>
        allowedFolders.includes(folder.id),
      );
    }

    const linkWithDataroom: DataroomIndexSource = {
      id: link.id,
      dataroom: {
        id: link.dataroom.id,
        name: link.dataroom.name,
        createdAt: link.dataroom.createdAt,
        lastUpdatedAt: link.dataroom.updatedAt,
        folders: link.dataroom.folders,
        documents: link.dataroom.documents.map((doc) => ({
          id: doc.id,
          folderId: doc.folderId,
          orderIndex: doc.orderIndex,
          updatedAt: doc.updatedAt,
          createdAt: doc.createdAt,
          hierarchicalIndex: doc.hierarchicalIndex,
          document: {
            id: doc.document.id,
            name: doc.document.name,
            versions: doc.document.versions.map((version) => ({
              id: version.id,
              versionNumber: version.versionNumber,
              type: version.contentType || "unknown",
              hasPages: version.hasPages,
              file: version.file,
              isVertical: version.isVertical,
              numPages: version.numPages ?? 0,
              updatedAt: version.updatedAt,
              fileSize: Number(version.fileSize ?? 0),
            })),
          },
        })),
      },
    };

    const showHierarchicalIndex = await resolveDataroomIndexEnabledForViewer({
      teamId: link.dataroom.teamId,
      teamPlan: team.plan,
    });

    // Generate the index file using the appropriate generator
    const { data, filename, mimeType } = await generateDataroomIndex(
      linkWithDataroom,
      {
        format,
        baseUrl: link.domainId
          ? `${link.domainSlug}/${link.slug}`
          : `${process.env.NEXT_PUBLIC_MARKETING_URL}/view/${link.id}`,
        showHierarchicalIndex,
      },
    );

    // Set response headers for file download
    res.setHeader("Content-Type", mimeType);
    res.setHeader("Content-Disposition", `attachment; filename=${filename}`);

    // Send the file
    return res.send(data);
  } catch (error) {
    console.error("Request error", error);
    return res.status(500).json({ error: "Error generating index" });
  }
}
