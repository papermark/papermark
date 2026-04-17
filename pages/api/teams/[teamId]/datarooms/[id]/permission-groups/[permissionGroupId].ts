import { NextApiRequest, NextApiResponse } from "next";

import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { ItemType } from "@prisma/client";
import { getServerSession } from "next-auth/next";
import { z } from "zod";

import { revalidateLinksForPermissionGroup } from "@/lib/api/links/revalidate";
import { errorhandler } from "@/lib/errorHandler";
import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";

// Zod schema for validating permissions
const itemPermissionSchema = z.object({
  view: z.boolean(),
  download: z.boolean(),
  itemType: z.nativeEnum(ItemType),
});

const permissionsSchema = z.record(z.string(), itemPermissionSchema);

const patchPermissionGroupSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
});

// Helper function to get parent folder IDs for a given document in a dataroom
async function getParentFolderIds(
  dataroomId: string,
  documentId: string,
): Promise<string[]> {
  // Get the dataroom document to find which folder it's in
  const dataroomDocument = await prisma.dataroomDocument.findUnique({
    where: { id: documentId },
    select: { folderId: true },
  });

  if (!dataroomDocument?.folderId) {
    return []; // Document is at root level
  }

  // Get the folder and walk up the hierarchy
  const parentFolders: string[] = [];
  let currentFolderId: string | null = dataroomDocument.folderId;

  while (currentFolderId) {
    parentFolders.push(currentFolderId);

    const folder: { parentId: string | null } | null =
      await prisma.dataroomFolder.findUnique({
        where: { id: currentFolderId },
        select: { parentId: true },
      });

    currentFolderId = folder?.parentId || null;
  }

  return parentFolders;
}

// Helper function to ensure parent folders are visible when child documents are made visible
async function ensureParentFoldersVisible(
  dataroomId: string,
  groupId: string,
  permissions: Record<
    string,
    { itemType: ItemType; view: boolean; download: boolean }
  >,
): Promise<void> {
  const foldersToMakeVisible = new Set<string>();

  // Find all documents that are being made visible
  const visibleDocuments = Object.entries(permissions)
    .filter(
      ([_, perm]) => perm.itemType === ItemType.DATAROOM_DOCUMENT && perm.view,
    )
    .map(([itemId, _]) => itemId);

  // Get parent folder IDs for all visible documents
  for (const documentId of visibleDocuments) {
    const parentFolders = await getParentFolderIds(dataroomId, documentId);
    parentFolders.forEach((folderId) => foldersToMakeVisible.add(folderId));
  }

  // Also handle folders that are being made visible - ensure their parent folders are visible too
  const visibleFolders = Object.entries(permissions)
    .filter(
      ([_, perm]) => perm.itemType === ItemType.DATAROOM_FOLDER && perm.view,
    )
    .map(([itemId, _]) => itemId);

  for (const folderId of visibleFolders) {
    let currentFolderId: string | null = folderId;

    while (currentFolderId) {
      const folder: { parentId: string | null } | null =
        await prisma.dataroomFolder.findUnique({
          where: { id: currentFolderId },
          select: { parentId: true },
        });

      if (folder?.parentId) {
        foldersToMakeVisible.add(folder.parentId);
        currentFolderId = folder.parentId;
      } else {
        break;
      }
    }
  }

  // Update or create permissions for parent folders to make them visible
  if (foldersToMakeVisible.size > 0) {
    const foldersToUpdate = Array.from(foldersToMakeVisible);

    await prisma.$transaction(async (tx) => {
      for (const folderId of foldersToUpdate) {
        await tx.permissionGroupAccessControls.upsert({
          where: {
            groupId_itemId: {
              groupId: groupId,
              itemId: folderId,
            },
          },
          create: {
            groupId: groupId,
            itemId: folderId,
            itemType: ItemType.DATAROOM_FOLDER,
            canView: true,
            canDownload: false,
            canDownloadOriginal: false,
          },
          update: {
            canView: true, // Always ensure parent folders are visible
            // Don't change canDownload - preserve existing setting
          },
        });
      }
    });
  }
}

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "GET") {
    // GET /api/teams/:teamId/datarooms/:id/permission-groups/:permissionGroupId
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      return res.status(401).end("Unauthorized");
    }

    const {
      teamId,
      id: dataroomId,
      permissionGroupId,
    } = req.query as {
      teamId: string;
      id: string;
      permissionGroupId: string;
    };

    const userId = (session.user as CustomUser).id;

    try {
      // Verify team membership
      const team = await prisma.team.findUnique({
        where: {
          id: teamId,
          users: {
            some: { userId },
          },
        },
      });

      if (!team) {
        return res.status(401).end("Unauthorized");
      }

      // Verify dataroom exists and belongs to team
      const dataroom = await prisma.dataroom.findUnique({
        where: {
          id: dataroomId,
          teamId: teamId,
        },
      });

      if (!dataroom) {
        return res.status(404).json({ error: "Dataroom not found" });
      }

      // Fetch permission group and its access controls
      const permissionGroup = await prisma.permissionGroup.findUnique({
        where: {
          id: permissionGroupId,
          dataroomId: dataroomId,
          teamId: teamId,
        },
        include: {
          accessControls: true,
        },
      });

      if (!permissionGroup) {
        return res.status(404).json({ error: "Permission group not found" });
      }

      return res.status(200).json({ permissionGroup });
    } catch (error) {
      return errorhandler(error, res);
    }
  } else if (req.method === "PATCH") {
    // PATCH /api/teams/:teamId/datarooms/:id/permission-groups/:permissionGroupId
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      return res.status(401).end("Unauthorized");
    }

    const {
      teamId,
      id: dataroomId,
      permissionGroupId,
    } = req.query as {
      teamId: string;
      id: string;
      permissionGroupId: string;
    };

    const userId = (session.user as CustomUser).id;

    try {
      // Verify team membership
      const team = await prisma.team.findUnique({
        where: {
          id: teamId,
          users: {
            some: { userId },
          },
        },
      });

      if (!team) {
        return res.status(401).end("Unauthorized");
      }

      // Verify dataroom exists and belongs to team
      const dataroom = await prisma.dataroom.findUnique({
        where: {
          id: dataroomId,
          teamId: teamId,
        },
      });

      if (!dataroom) {
        return res.status(404).json({ error: "Dataroom not found" });
      }

      // Verify permission group exists and belongs to dataroom
      const permissionGroup = await prisma.permissionGroup.findUnique({
        where: {
          id: permissionGroupId,
          dataroomId: dataroomId,
          teamId: teamId,
        },
      });

      if (!permissionGroup) {
        return res.status(404).json({ error: "Permission group not found" });
      }

      // Validate and update permission group
      const validationResult = patchPermissionGroupSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({
          error: "Invalid request body",
          details: validationResult.error.issues,
        });
      }

      const { name, description } = validationResult.data;

      const updatedPermissionGroup = await prisma.permissionGroup.update({
        where: {
          id: permissionGroupId,
        },
        data: {
          ...(name && { name }),
          ...(description !== undefined && { description }),
        },
      });

      return res.status(200).json({ permissionGroup: updatedPermissionGroup });
    } catch (error) {
      return errorhandler(error, res);
    }
  } else if (req.method === "PUT") {
    // PUT /api/teams/:teamId/datarooms/:id/permission-groups/:permissionGroupId
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      return res.status(401).end("Unauthorized");
    }

    const {
      teamId,
      id: dataroomId,
      permissionGroupId,
    } = req.query as {
      teamId: string;
      id: string;
      permissionGroupId: string;
    };

    const { permissions } = req.body;

    const userId = (session.user as CustomUser).id;

    try {
      // Verify team membership
      const team = await prisma.team.findUnique({
        where: {
          id: teamId,
          users: {
            some: { userId },
          },
        },
      });

      if (!team) {
        return res.status(401).end("Unauthorized");
      }

      // Verify dataroom exists and belongs to team
      const dataroom = await prisma.dataroom.findUnique({
        where: {
          id: dataroomId,
          teamId: teamId,
        },
      });

      if (!dataroom) {
        return res.status(404).json({ error: "Dataroom not found" });
      }

      // Verify permission group exists and belongs to dataroom
      const permissionGroup = await prisma.permissionGroup.findUnique({
        where: {
          id: permissionGroupId,
          dataroomId: dataroomId,
          teamId: teamId,
        },
      });

      if (!permissionGroup) {
        return res.status(404).json({ error: "Permission group not found" });
      }

      // Validate permissions payload using Zod
      if (!permissions) {
        return res.status(400).json({ error: "Permissions are required" });
      }

      // Validate schema structure
      const validationResult = permissionsSchema.safeParse(permissions);
      if (!validationResult.success) {
        return res.status(400).json({
          error: "Invalid permissions format",
          details: validationResult.error.issues,
        });
      }

      const validatedPermissions = validationResult.data;

      const updatedPermissionGroup = await prisma.$transaction(async (tx) => {
        // Get existing permissions for comparison
        const existingPermissions =
          await tx.permissionGroupAccessControls.findMany({
            where: {
              groupId: permissionGroupId,
            },
          });

        // Create maps for efficient lookup
        const existingMap = new Map(
          existingPermissions.map((p) => [`${p.itemId}-${p.itemType}`, p]),
        );

        // Categorize permissions into updates vs creates
        const toUpdate: Array<{
          itemId: string;
          itemType: ItemType;
          canView: boolean;
          canDownload: boolean;
          canDownloadOriginal: boolean;
        }> = [];

        const toCreate: Array<{
          groupId: string;
          itemId: string;
          itemType: ItemType;
          canView: boolean;
          canDownload: boolean;
          canDownloadOriginal: boolean;
        }> = [];

        // Categorize permissions into updates vs creates
        Object.entries(validatedPermissions).forEach(([itemId, permission]) => {
          const key = `${itemId}-${permission.itemType}`;
          const existing = existingMap.get(key);

          const permissionData = {
            itemId,
            itemType: permission.itemType,
            canView: permission.view,
            canDownload: permission.download,
            canDownloadOriginal: false,
          };

          if (existing) {
            // Check if anything actually changed
            if (
              existing.canView !== permission.view ||
              existing.canDownload !== permission.download
            ) {
              toUpdate.push(permissionData);
            }
          } else {
            toCreate.push({
              groupId: permissionGroupId,
              ...permissionData,
            });
          }
        });

        // Perform updates
        if (toUpdate.length > 0) {
          await Promise.all(
            toUpdate.map((item) =>
              tx.permissionGroupAccessControls.updateMany({
                where: {
                  groupId: permissionGroupId,
                  itemId: item.itemId,
                  itemType: item.itemType,
                },
                data: {
                  canView: item.canView,
                  canDownload: item.canDownload,
                  canDownloadOriginal: item.canDownloadOriginal,
                },
              }),
            ),
          );
        }

        // Perform creates
        if (toCreate.length > 0) {
          await tx.permissionGroupAccessControls.createMany({
            data: toCreate,
          });
        }

        // Remove permissions that are no longer in the new set
        const newItemKeys = new Set(
          Object.entries(validatedPermissions).map(
            ([itemId, permission]) => `${itemId}-${permission.itemType}`,
          ),
        );

        const toDelete = existingPermissions.filter(
          (p) => !newItemKeys.has(`${p.itemId}-${p.itemType}`),
        );

        if (toDelete.length > 0) {
          await tx.permissionGroupAccessControls.deleteMany({
            where: {
              id: {
                in: toDelete.map((p) => p.id),
              },
            },
          });
        }

        return permissionGroup;
      });

      // After saving permissions, ensure parent folders are visible for any items that were made visible
      await ensureParentFoldersVisible(
        dataroomId,
        permissionGroupId,
        validatedPermissions,
      );

      // Revalidate ISR pages so viewers see the updated file list
      await revalidateLinksForPermissionGroup(permissionGroupId);

      return res.status(200).json({ permissionGroup: updatedPermissionGroup });
    } catch (error) {
      return errorhandler(error, res);
    }
  } else if (req.method === "DELETE") {
    // DELETE /api/teams/:teamId/datarooms/:id/permission-groups/:permissionGroupId
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      return res.status(401).end("Unauthorized");
    }

    const {
      teamId,
      id: dataroomId,
      permissionGroupId,
    } = req.query as {
      teamId: string;
      id: string;
      permissionGroupId: string;
    };

    const userId = (session.user as CustomUser).id;

    try {
      // Verify team membership
      const team = await prisma.team.findUnique({
        where: {
          id: teamId,
          users: {
            some: { userId },
          },
        },
      });

      if (!team) {
        return res.status(401).end("Unauthorized");
      }

      // Verify dataroom exists and belongs to team
      const dataroom = await prisma.dataroom.findUnique({
        where: {
          id: dataroomId,
          teamId: teamId,
        },
      });

      if (!dataroom) {
        return res.status(404).json({ error: "Dataroom not found" });
      }

      // Verify permission group exists and belongs to dataroom
      const permissionGroup = await prisma.permissionGroup.findUnique({
        where: {
          id: permissionGroupId,
          dataroomId: dataroomId,
          teamId: teamId,
        },
      });

      if (!permissionGroup) {
        return res.status(404).json({ error: "Permission group not found" });
      }

      // Find linked links before deletion (FK onDelete: SetNull clears the reference)
      const linkedLinks = await prisma.link.findMany({
        where: { permissionGroupId, deletedAt: null },
        select: { id: true, domainId: true },
      });

      // Delete the permission group (this will cascade delete access controls)
      await prisma.permissionGroup.delete({
        where: {
          id: permissionGroupId,
        },
      });

      // Revalidate ISR pages so viewers see all files again (no restrictions)
      const revalidateUrl = process.env.NEXTAUTH_URL;
      const revalidateToken = process.env.REVALIDATE_TOKEN;
      if (revalidateUrl && revalidateToken && linkedLinks.length > 0) {
        await Promise.all(
          linkedLinks.map((link) =>
            fetch(
              `${revalidateUrl}/api/revalidate?secret=${revalidateToken}&linkId=${link.id}&hasDomain=${link.domainId ? "true" : "false"}`,
            ).catch((err) =>
              console.error(`Error revalidating link ${link.id}:`, err),
            ),
          ),
        );
      }

      return res.status(200).json({ message: "Permission group deleted" });
    } catch (error) {
      return errorhandler(error, res);
    }
  }

  // We only allow GET, PATCH, PUT, and DELETE requests
  res.setHeader("Allow", ["GET", "PATCH", "PUT", "DELETE"]);
  return res.status(405).end(`Method ${req.method} Not Allowed`);
}
