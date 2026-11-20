import { NextApiRequest, NextApiResponse } from "next";

import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { ItemType } from "@prisma/client";
import cuid from "cuid";
import { getServerSession } from "next-auth/next";
import { z } from "zod";

import { revalidateLinksForPermissionGroup } from "@/lib/api/links/revalidate";
import {
  buildBulkUpsertPermissionsSql,
  buildDeletePermissionsNotInPayloadSql,
  buildFindAncestorFolderIdsSql,
  buildUpsertAncestorVisibilitySql,
  extractVisibleItemIds,
  type AncestorUpsertRow,
  type PermissionUpsertRow,
} from "@/lib/dataroom/permissions-sql";
import { errorhandler } from "@/lib/errorHandler";
import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";

// PUT can save thousands of permission rows in a single payload (think
// "select all" on a large dataroom). With the bulk-SQL path below this is
// now ~3-4 round-trips total, but we still bump the platform timeout to be
// safe — same as the neighbouring `groups/[groupId]/permissions.ts`.
export const config = {
  maxDuration: 300,
};

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

      const validationResult = permissionsSchema.safeParse(permissions);
      if (!validationResult.success) {
        return res.status(400).json({
          error: "Invalid permissions format",
          details: validationResult.error.issues,
        });
      }

      const validatedPermissions = validationResult.data;

      // Build the bulk-SQL plan. The link-permission UI posts the
      // *complete* desired state (it merges existing rows with pending
      // changes before calling us), so we treat the payload as
      // authoritative: anything in DB but not in (payload ∪ ancestor
      // expansion) is removed.
      const upsertRows: PermissionUpsertRow[] = Object.entries(
        validatedPermissions,
      ).map(([itemId, perm]) => ({
        id: cuid(),
        itemId,
        itemType: perm.itemType,
        canView: perm.view,
        canDownload: perm.download,
      }));

      const bulkUpsertSql = buildBulkUpsertPermissionsSql(
        "PermissionGroupAccessControls",
        permissionGroupId,
        upsertRows,
      );

      const { visibleDocumentIds, visibleFolderIds } =
        extractVisibleItemIds(validatedPermissions);

      const findAncestorsSql = buildFindAncestorFolderIdsSql(
        dataroomId,
        visibleDocumentIds,
        visibleFolderIds,
      );

      await prisma.$transaction(async (tx) => {
        if (bulkUpsertSql) {
          await tx.$executeRaw(bulkUpsertSql);
        }

        // Server-side safety net for the "visible item ⇒ visible
        // ancestors" invariant. Defence-in-depth: the client already
        // includes ancestors in its payload via `collectChangesForItem`,
        // but a buggy/old client or external API caller might not.
        const ancestorIds = new Set<string>();
        if (findAncestorsSql) {
          const ancestorRows = await tx.$queryRaw<{ folder_id: string }[]>(
            findAncestorsSql,
          );
          for (const r of ancestorRows) ancestorIds.add(r.folder_id);

          if (ancestorRows.length > 0) {
            const ancestors: AncestorUpsertRow[] = ancestorRows.map((r) => ({
              id: cuid(),
              folderId: r.folder_id,
            }));

            const ancestorUpsertSql = buildUpsertAncestorVisibilitySql(
              "PermissionGroupAccessControls",
              permissionGroupId,
              ancestors,
            );
            if (ancestorUpsertSql) {
              await tx.$executeRaw(ancestorUpsertSql);
            }
          }
        }

        // Set-everything semantic: drop any DB row whose itemId is no
        // longer in the desired state. We keep both the explicit payload
        // ids *and* the ancestor folder ids so the visibility safety net
        // we just upserted isn't immediately deleted again.
        const keepItemIds = [
          ...Object.keys(validatedPermissions),
          ...ancestorIds,
        ];

        if (keepItemIds.length > 0) {
          const deleteSql = buildDeletePermissionsNotInPayloadSql(
            "PermissionGroupAccessControls",
            permissionGroupId,
            keepItemIds,
          );
          if (deleteSql) {
            await tx.$executeRaw(deleteSql);
          }
        } else {
          // Empty payload + no ancestors → user is clearing all
          // permissions. Delete every row for this group.
          await tx.permissionGroupAccessControls.deleteMany({
            where: { groupId: permissionGroupId },
          });
        }
      });

      // Revalidate ISR pages so viewers see the updated file list
      await revalidateLinksForPermissionGroup(permissionGroupId);

      return res.status(200).json({ permissionGroup });
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
