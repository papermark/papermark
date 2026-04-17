import { NextApiRequest, NextApiResponse } from "next";

import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { ItemType } from "@prisma/client";
import { getServerSession } from "next-auth";

import { errorhandler } from "@/lib/errorHandler";
import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";

async function revalidateLinksForDataroom(dataroomId: string): Promise<void> {
  try {
    const links = await prisma.link.findMany({
      where: {
        dataroomId,
        deletedAt: null,
        OR: [
          { permissionGroupId: { not: null } },
          { groupId: { not: null } },
        ],
      },
      select: { id: true, domainId: true },
    });

    if (links.length === 0) return;

    const revalidateUrl = process.env.NEXTAUTH_URL;
    const revalidateToken = process.env.REVALIDATE_TOKEN;
    if (!revalidateUrl || !revalidateToken) return;

    await Promise.all(
      links.map((link) =>
        fetch(
          `${revalidateUrl}/api/revalidate?secret=${revalidateToken}&linkId=${link.id}&hasDomain=${link.domainId ? "true" : "false"}`,
        ).catch((err) =>
          console.error(`Error revalidating link ${link.id}:`, err),
        ),
      ),
    );
  } catch (error) {
    console.error(
      `Error revalidating links for dataroom ${dataroomId}:`,
      error,
    );
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const { teamId, id: dataroomId } = req.query as {
    teamId: string;
    id: string;
  };

  const userId = (session.user as CustomUser).id;

  try {
    const { documentIds, strategy, folderPath } = req.body as {
      documentIds: string[];
      strategy: string;
      folderPath?: string;
    };

    // Validate input
    if (
      !documentIds ||
      !Array.isArray(documentIds) ||
      documentIds.length === 0
    ) {
      return res.status(400).json({ message: "Document IDs are required" });
    }

    if (!strategy) {
      return res.status(400).json({ message: "Strategy is required" });
    }

    // Validate strategy
    if (
      !["INHERIT_FROM_PARENT", "ASK_EVERY_TIME", "HIDDEN_BY_DEFAULT"].includes(
        strategy,
      )
    ) {
      return res.status(400).json({ message: "Invalid strategy" });
    }

    // Check if the user is part of the team
    const team = await prisma.team.findFirst({
      where: {
        id: teamId,
        users: { some: { userId } },
      },
    });

    if (!team) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    // Get dataroom and verify it exists and belongs to the team
    const dataroom = await prisma.dataroom.findUnique({
      where: { id: dataroomId },
      select: {
        id: true,
        teamId: true,
        defaultPermissionStrategy: true,
      },
    });

    if (!dataroom || dataroom.teamId !== teamId) {
      return res.status(404).json({ message: "Dataroom not found" });
    }

    // Get dataroom documents for the provided document IDs
    const dataroomDocuments = await prisma.dataroomDocument.findMany({
      where: {
        documentId: { in: documentIds },
        dataroomId,
      },
      select: { id: true, documentId: true, folderId: true },
    });

    if (dataroomDocuments.length === 0) {
      return res
        .status(404)
        .json({ message: "No documents found in this dataroom" });
    }

    // Apply permissions based on strategy
    await applyPermissionStrategy(
      dataroomId,
      dataroomDocuments,
      strategy,
      folderPath,
    );

    // Revalidate ISR pages for links with permission restrictions
    await revalidateLinksForDataroom(dataroomId);

    return res.status(200).json({
      message: "Permissions applied successfully",
      documentsProcessed: dataroomDocuments.length,
    });
  } catch (error) {
    errorhandler(error, res);
  }
}

async function applyPermissionStrategy(
  dataroomId: string,
  dataroomDocuments: {
    id: string;
    documentId: string;
    folderId: string | null;
  }[],
  strategy: string,
  folderPath?: string,
) {
  if (strategy === "INHERIT_FROM_PARENT") {
    const isRootLevel = !folderPath || folderPath.length === 0;

    if (isRootLevel) {
      // For root level, apply view-only permissions to all groups
      await applyRootLevelPermissions(dataroomId, dataroomDocuments);
    } else {
      // For subfolders, inherit from parent folder
      await inheritFromParentFolder(dataroomId, dataroomDocuments, folderPath);
    }
  } else if (strategy === "ASK_EVERY_TIME") {
    // Do nothing here - the UI will handle showing the permission modal
    return;
  } else if (strategy === "HIDDEN_BY_DEFAULT") {
    // Do nothing here - documents remain hidden with no permissions
    return;
  }
}

async function applyRootLevelPermissions(
  dataroomId: string,
  dataroomDocuments: {
    id: string;
    documentId: string;
    folderId: string | null;
  }[],
) {
  // Get both ViewerGroups and PermissionGroups
  const [viewerGroups, permissionGroups] = await Promise.all([
    prisma.viewerGroup.findMany({
      where: { dataroomId },
      select: { id: true },
    }),
    prisma.permissionGroup.findMany({
      where: { dataroomId },
      select: { id: true },
    }),
  ]);

  const viewerGroupPermissionsToCreate: any[] = [];
  const permissionGroupPermissionsToCreate: any[] = [];

  // ViewerGroup permissions - all get view-only access
  viewerGroups.forEach((group) => {
    dataroomDocuments.forEach((doc) => {
      viewerGroupPermissionsToCreate.push({
        groupId: group.id,
        itemId: doc.id,
        itemType: ItemType.DATAROOM_DOCUMENT,
        canView: true,
        canDownload: false,
      });
    });
  });

  // PermissionGroup permissions - all get view-only access
  permissionGroups.forEach((group) => {
    dataroomDocuments.forEach((doc) => {
      permissionGroupPermissionsToCreate.push({
        groupId: group.id,
        itemId: doc.id,
        itemType: ItemType.DATAROOM_DOCUMENT,
        canView: true,
        canDownload: false,
        canDownloadOriginal: false,
      });
    });
  });

  // Apply permissions in a transaction
  await prisma.$transaction(async (tx) => {
    // Create new permissions
    if (viewerGroupPermissionsToCreate.length > 0) {
      await tx.viewerGroupAccessControls.createMany({
        data: viewerGroupPermissionsToCreate,
        skipDuplicates: true,
      });
    }

    if (permissionGroupPermissionsToCreate.length > 0) {
      await tx.permissionGroupAccessControls.createMany({
        data: permissionGroupPermissionsToCreate,
        skipDuplicates: true,
      });
    }
  });
}

async function inheritFromParentFolder(
  dataroomId: string,
  dataroomDocuments: {
    id: string;
    documentId: string;
    folderId: string | null;
  }[],
  folderPath: string,
) {
  // Get parent folder permissions and apply them to new documents
  const pathSegments = folderPath.split("/").filter(Boolean);
  const parentPath = "/" + pathSegments.slice(0, -1).join("/");

  const parentFolder = await prisma.dataroomFolder.findUnique({
    where: {
      dataroomId_path: { dataroomId, path: parentPath },
    },
    select: { id: true },
  });

  if (!parentFolder) {
    // If no parent folder found, apply root level permissions
    await applyRootLevelPermissions(dataroomId, dataroomDocuments);
    return;
  }

  // Get existing permissions for the parent folder
  const [parentViewerPermissions, parentPermissionGroupPermissions] =
    await Promise.all([
      prisma.viewerGroupAccessControls.findMany({
        where: {
          itemId: parentFolder.id,
          itemType: ItemType.DATAROOM_FOLDER,
        },
        select: { groupId: true, canView: true, canDownload: true },
      }),
      prisma.permissionGroupAccessControls.findMany({
        where: {
          itemId: parentFolder.id,
          itemType: ItemType.DATAROOM_FOLDER,
        },
        select: {
          groupId: true,
          canView: true,
          canDownload: true,
          canDownloadOriginal: true,
        },
      }),
    ]);

  // Apply parent permissions to documents
  await prisma.$transaction(async (tx) => {
    // Create permissions based on parent folder permissions
    const viewerGroupPermissionsToCreate: any[] = [];
    const permissionGroupPermissionsToCreate: any[] = [];

    parentViewerPermissions.forEach((parentPerm) => {
      dataroomDocuments.forEach((doc) => {
        viewerGroupPermissionsToCreate.push({
          groupId: parentPerm.groupId,
          itemId: doc.id,
          itemType: ItemType.DATAROOM_DOCUMENT,
          canView: parentPerm.canView,
          canDownload: parentPerm.canDownload,
        });
      });
    });

    parentPermissionGroupPermissions.forEach((parentPerm) => {
      dataroomDocuments.forEach((doc) => {
        permissionGroupPermissionsToCreate.push({
          groupId: parentPerm.groupId,
          itemId: doc.id,
          itemType: ItemType.DATAROOM_DOCUMENT,
          canView: parentPerm.canView,
          canDownload: parentPerm.canDownload,
          canDownloadOriginal: parentPerm.canDownloadOriginal,
        });
      });
    });

    if (viewerGroupPermissionsToCreate.length > 0) {
      await tx.viewerGroupAccessControls.createMany({
        data: viewerGroupPermissionsToCreate,
        skipDuplicates: true,
      });
    }

    if (permissionGroupPermissionsToCreate.length > 0) {
      await tx.permissionGroupAccessControls.createMany({
        data: permissionGroupPermissionsToCreate,
        skipDuplicates: true,
      });
    }
  });
}
