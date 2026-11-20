import { NextApiRequest, NextApiResponse } from "next";

import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { ItemType } from "@prisma/client";
import cuid from "cuid";
import { getServerSession } from "next-auth/next";

import {
  buildBulkUpsertPermissionsSql,
  buildFindAncestorFolderIdsSql,
  buildUpsertAncestorVisibilitySql,
  extractVisibleItemIds,
  type AncestorUpsertRow,
  type PermissionUpsertRow,
} from "@/lib/dataroom/permissions-sql";
import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";

// Saving thousands of permission rows in a single payload is a normal
// operation here (think "select all" on a large dataroom). With the bulk-SQL
// path below this is now ~3 round-trips total, but we still bump the
// platform timeout to be safe — same as the neighbouring `invite.ts`.
export const config = {
  maxDuration: 300,
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  // POST /api/teams/:teamId/datarooms/:id/groups/:groupId/permissions
  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    res.status(401).end("Unauthorized");
    return;
  }

  const userId = (session.user as CustomUser).id;
  const {
    teamId,
    id: dataroomId,
    groupId,
  } = req.query as {
    teamId: string;
    id: string;
    groupId: string;
  };

  try {
    const { permissions } = req.body as {
      permissions: Record<
        string,
        { itemType: ItemType; view: boolean; download: boolean }
      >;
    };

    if (!permissions || typeof permissions !== "object") {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const team = await prisma.team.findUnique({
      where: {
        id: teamId,
        users: {
          some: {
            userId,
          },
        },
      },
    });

    if (!team) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const group = await prisma.viewerGroup.findFirst({
      where: { id: groupId, dataroomId, teamId },
      select: { id: true },
    });

    if (!group) {
      return res.status(404).json({ message: "Group not found" });
    }

    const upsertRows: PermissionUpsertRow[] = Object.entries(permissions).map(
      ([itemId, itemPermissions]) => ({
        id: cuid(),
        itemId,
        itemType: itemPermissions.itemType,
        canView: Boolean(itemPermissions.view),
        canDownload: Boolean(itemPermissions.download),
      }),
    );

    const bulkUpsertSql = buildBulkUpsertPermissionsSql(
      "ViewerGroupAccessControls",
      groupId,
      upsertRows,
    );

    const { visibleDocumentIds, visibleFolderIds } =
      extractVisibleItemIds(permissions);

    const findAncestorsSql = buildFindAncestorFolderIdsSql(
      dataroomId,
      visibleDocumentIds,
      visibleFolderIds,
    );

    // Single interactive transaction so the invariant "every visible item
    // has visible ancestors" is never half-applied. Each step is a single
    // bulk SQL round-trip, so total wall-clock is well below Prisma's
    // 5s interactive-transaction window even for very large payloads.
    await prisma.$transaction(async (tx) => {
      if (bulkUpsertSql) {
        await tx.$executeRaw(bulkUpsertSql);
      }

      if (findAncestorsSql) {
        const ancestorRows = await tx.$queryRaw<{ folder_id: string }[]>(
          findAncestorsSql,
        );

        if (ancestorRows.length > 0) {
          const ancestors: AncestorUpsertRow[] = ancestorRows.map((r) => ({
            id: cuid(),
            folderId: r.folder_id,
          }));

          const ancestorUpsertSql = buildUpsertAncestorVisibilitySql(
            "ViewerGroupAccessControls",
            groupId,
            ancestors,
          );
          if (ancestorUpsertSql) {
            await tx.$executeRaw(ancestorUpsertSql);
          }
        }
      }
    });

    res.status(200).json({ message: "Permissions updated successfully" });
  } catch (error) {
    console.error("Error updating permissions:", error);
    res.status(500).json({ message: "Internal server error" });
  }
}
