import { NextApiRequest, NextApiResponse } from "next";

import { ItemType } from "@prisma/client";
import cuid from "cuid";
import { getServerSession } from "next-auth/next";
import { z } from "zod";

import {
  revalidateLinkById,
  revalidateLinksForPermissionGroup,
} from "@/lib/api/links/revalidate";
import {
  buildFindAncestorFolderIdsSql,
  buildUpsertAncestorVisibilitySql,
  extractVisibleItemIds,
  type AncestorUpsertRow,
} from "@/lib/dataroom/permissions-sql";
import { errorhandler } from "@/lib/errorHandler";
import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";

import { authOptions } from "../../../../../auth/[...nextauth]";

// Same payload-size considerations as the PUT route — bump the timeout so
// large datarooms saving full permission state at create time don't trip
// the platform default.
export const config = {
  maxDuration: 300,
};

// Mirrors the schema used by the PUT handler in
// `[permissionGroupId].ts` so the same validation rules apply to creates.
const itemPermissionSchema = z.object({
  view: z.boolean(),
  download: z.boolean(),
  itemType: z.nativeEnum(ItemType),
});

const permissionsSchema = z.record(z.string(), itemPermissionSchema);

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "GET") {
    // GET /api/teams/:teamId/datarooms/:id/permission-groups
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      return res.status(401).end("Unauthorized");
    }

    const { teamId, id: dataroomId } = req.query as {
      teamId: string;
      id: string;
    };

    const userId = (session.user as CustomUser).id;

    try {
      const teamAccess = await prisma.userTeam.findUnique({
        where: {
          userId_teamId: {
            userId: userId,
            teamId: teamId,
          },
        },
      });

      if (!teamAccess) {
        return res.status(401).end("Unauthorized");
      }

      const dataroom = await prisma.dataroom.findUnique({
        where: {
          id: dataroomId,
          teamId: teamId,
        },
      });

      if (!dataroom) {
        return res.status(404).json({ error: "Dataroom not found" });
      }

      // First, get permission groups without expensive nested data
      const permissionGroups = await prisma.permissionGroup.findMany({
        where: {
          dataroomId: dataroomId,
          teamId: teamId,
        },
        orderBy: {
          createdAt: "desc",
        },
      });

      // Then, get nested data efficiently with separate queries
      const groupIds = permissionGroups.map((g) => g.id);

      const [accessControls, links] = await Promise.all([
        prisma.permissionGroupAccessControls.findMany({
          where: {
            groupId: { in: groupIds },
          },
        }),
        prisma.link.findMany({
          where: {
            permissionGroupId: { in: groupIds },
            deletedAt: null,
          },
          select: {
            id: true,
            name: true,
            permissionGroupId: true,
          },
        }),
      ]);

      // Create lookup maps for nested data
      const accessControlsMap = new Map<string, any[]>();
      const linksMap = new Map<string, any[]>();

      // Group access controls by groupId
      accessControls.forEach((ac) => {
        if (!accessControlsMap.has(ac.groupId)) {
          accessControlsMap.set(ac.groupId, []);
        }
        accessControlsMap.get(ac.groupId)!.push(ac);
      });

      // Group links by permissionGroupId
      links.forEach((link) => {
        if (link.permissionGroupId && !linksMap.has(link.permissionGroupId)) {
          linksMap.set(link.permissionGroupId, []);
        }
        if (link.permissionGroupId) {
          linksMap.get(link.permissionGroupId)!.push({
            id: link.id,
            name: link.name,
          });
        }
      });

      // Combine permission groups with their nested data
      const permissionGroupsWithData = permissionGroups.map((group) => ({
        ...group,
        accessControls: accessControlsMap.get(group.id) || [],
        links: linksMap.get(group.id) || [],
        _count: {
          accessControls: (accessControlsMap.get(group.id) || []).length,
          links: (linksMap.get(group.id) || []).length,
        },
      }));

      return res.status(200).json(permissionGroupsWithData);
    } catch (error) {
      errorhandler(error, res);
    }
  } else if (req.method === "POST") {
    // POST /api/teams/:teamId/datarooms/:id/permission-groups
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      return res.status(401).end("Unauthorized");
    }

    const { teamId, id: dataroomId } = req.query as {
      teamId: string;
      id: string;
    };
    const { permissions, linkId } = req.body;

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

      // Validate permissions payload using Zod before any DB work so
      // malformed bodies fail closed and never reach raw-SQL builders or
      // the interactive transaction below.
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

      const typedPermissions = validationResult.data;

      // Compute the recursive-CTE ancestor walk *before* opening the
      // transaction so the interactive transaction stays as short as
      // possible. The CTE only reads `DataroomFolder` / `DataroomDocument`
      // — both immutable from this caller's perspective — so doing it
      // outside the tx is safe.
      const { visibleDocumentIds, visibleFolderIds } =
        extractVisibleItemIds(typedPermissions);
      const findAncestorsSql = buildFindAncestorFolderIdsSql(
        dataroomId,
        visibleDocumentIds,
        visibleFolderIds,
      );

      let ancestorFolderIds: string[] = [];
      if (findAncestorsSql) {
        const ancestorRows = await prisma.$queryRaw<{ folder_id: string }[]>(
          findAncestorsSql,
        );
        ancestorFolderIds = ancestorRows.map((r) => r.folder_id);
      }

      // Create permission group and access controls in a transaction
      const result = await prisma.$transaction(async (tx) => {
        // Create the permission group
        const permissionGroup = await tx.permissionGroup.create({
          data: {
            name: `Link Permissions ${Date.now()}`,
            description: "Auto-generated permission group for link",
            dataroomId: dataroomId,
            teamId: teamId,
          },
        });

        // Prepare access control data for batch insert
        const accessControlData = Object.entries(typedPermissions).map(
          ([itemId, perm]) => ({
            groupId: permissionGroup.id,
            itemId: itemId,
            itemType: perm.itemType,
            canView: perm.view,
            canDownload: perm.download,
            canDownloadOriginal: false,
          }),
        );

        // Create all access controls in a single batch operation
        await tx.permissionGroupAccessControls.createMany({
          data: accessControlData,
        });

        // Server-side safety net for "visible item ⇒ visible ancestors".
        // Defence-in-depth: with the shared `permissions-tree` helpers the
        // client already includes ancestors, but a buggy/old client or an
        // external API caller might not. We force `canView=true` on those
        // ancestor folders without touching `canDownload` so we don't
        // clobber any ancestor's existing download grant.
        if (ancestorFolderIds.length > 0) {
          const ancestors: AncestorUpsertRow[] = ancestorFolderIds.map(
            (folderId) => ({
              id: cuid(),
              folderId,
            }),
          );
          const ancestorUpsertSql = buildUpsertAncestorVisibilitySql(
            "PermissionGroupAccessControls",
            permissionGroup.id,
            ancestors,
          );
          if (ancestorUpsertSql) {
            await tx.$executeRaw(ancestorUpsertSql);
          }
        }

        // Fetch the created access controls for return data
        const accessControls = await tx.permissionGroupAccessControls.findMany({
          where: {
            groupId: permissionGroup.id,
          },
        });

        // Update the link with the permission group
        if (linkId) {
          await tx.link.update({
            where: { id: linkId, teamId: teamId },
            data: {
              permissionGroupId: permissionGroup.id,
            },
          });
        }

        return {
          permissionGroup,
          accessControls,
        };
      });

      // Revalidate ISR pages for the linked link so viewers see the correct files
      if (linkId) {
        await revalidateLinkById(linkId);
      }
      if (result.permissionGroup?.id) {
        await revalidateLinksForPermissionGroup(result.permissionGroup.id);
      }

      return res.status(200).json(result);
    } catch (error) {
      errorhandler(error, res);
    }
  }

  // We only allow GET and POST requests
  res.setHeader("Allow", ["GET", "POST"]);
  return res.status(405).end(`Method ${req.method} Not Allowed`);
}
