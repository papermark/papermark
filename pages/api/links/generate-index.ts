import { NextApiRequest, NextApiResponse } from "next";

import { ItemType } from "@prisma/client";

import {
  DataroomIndexSource,
  generateDataroomIndex,
} from "@/lib/dataroom/index-generator";
import { resolveDataroomIndexEnabledForViewer } from "@/lib/featureFlags/dataroom-index-viewer";
import prisma from "@/lib/prisma";
import { IndexFileFormat } from "@/lib/types/index-file";

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  // POST /api/links/generate-index
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const {
    format = "excel",
    linkId,
    viewId,
    dataroomId,
    viewerId,
  } = req.body as {
    format: IndexFileFormat;
    linkId: string;
    viewId: string;
    dataroomId: string;
    viewerId: string;
  };

  try {
    const view = await prisma.view.findUnique({
      where: {
        id: viewId,
        linkId: linkId,
      },
      select: {
        id: true,
        linkId: true,
        dataroomId: true,
        viewerId: true,
        link: {
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
            deletedAt: true,
            domainId: true,
            domainSlug: true,
            groupId: true,
            permissionGroupId: true,
            enableIndexFile: true,
            dataroom: {
              select: {
                id: true,
                name: true,
                teamId: true,
                team: { select: { plan: true } },
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
        },
      },
    });

    if (
      !view ||
      !view.link ||
      view.dataroomId !== dataroomId ||
      view.viewerId !== viewerId
    ) {
      return res.status(404).json({ error: "View not found" });
    }

    const link = view.link;

    if (!link || !link.dataroom || link.dataroom.id !== dataroomId) {
      return res.status(404).json({ error: "Link not found" });
    }

    if (!link.enableIndexFile) {
      return res
        .status(404)
        .json({ error: "Index file is not enabled for this link" });
    }

    // check if link is expired or archived
    if (link.expiresAt && link.expiresAt < new Date()) {
      return res.status(404).json({ error: "Link expired" });
    }

    if (link.isArchived) {
      return res.status(404).json({ error: "Link archived" });
    }

    if (link.deletedAt) {
      return res.status(404).json({ error: "Link deleted" });
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
      teamPlan: link.dataroom.team.plan,
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
