import { NextApiRequest, NextApiResponse } from "next";

import { resolveOwnedBrandId } from "@/ee/features/branding/lib/resolve-base-brand";
import { DefaultPermissionStrategy, RootItemAccess } from "@prisma/client";

import { withTeamApi } from "@/lib/api/auth/with-session-team";
import { errorhandler } from "@/lib/errorHandler";
import { getFeatureFlags } from "@/lib/featureFlags";
import { isRequestListEnabled } from "@/lib/featureFlags/request-list";
import prisma from "@/lib/prisma";

// GET /api/teams/:teamId/datarooms/:id
const getHandler = withTeamApi(
  async ({ req, res, teamId }) => {
    const { id: dataroomId } = req.query as { id: string };

    try {
      const dataroom = await prisma.dataroom.findUnique({
        where: {
          id: dataroomId,
          teamId,
        },
        include: {
          _count: { select: { viewerGroups: true, permissionGroups: true } },
          frozenByUser: {
            select: {
              name: true,
              email: true,
            },
          },
          tags: {
            include: {
              tag: {
                select: {
                  id: true,
                  name: true,
                  color: true,
                  description: true,
                },
              },
            },
          },
        },
      });

      if (!dataroom) {
        return res.status(404).json({
          error: "Not Found",
          message: "The requested dataroom does not exist",
        });
      }

      return res.status(200).json(dataroom);
    } catch (error) {
      errorhandler(error, res);
    }
  },
  { requiredPermissions: ["datarooms.read"], dataroomParam: "id" },
);

// PATCH /api/teams/:teamId/datarooms/:id
const patchHandler = withTeamApi(
  async ({ req, res, teamId, userId, team }) => {
    const { id: dataroomId } = req.query as { id: string };

    try {
      const {
        name,
        internalName,
        enableChangeNotifications,
        enableVisitorUploadChangeNotifications,
        defaultPermissionStrategy,
        defaultGroupPermissionStrategy,
        defaultRootItemAccess,
        defaultGroupRootItemAccess,
        allowBulkDownload,
        showLastUpdated,
        tags,
        agentsEnabled,
        introductionEnabled,
        introductionContent,
        requestListEnabled,
        brandId,
      } = req.body as {
        name?: string;
        internalName?: string | null;
        enableChangeNotifications?: boolean;
        enableVisitorUploadChangeNotifications?: boolean;
        defaultPermissionStrategy?: DefaultPermissionStrategy;
        defaultGroupPermissionStrategy?: DefaultPermissionStrategy;
        defaultRootItemAccess?: RootItemAccess;
        defaultGroupRootItemAccess?: RootItemAccess;
        allowBulkDownload?: boolean;
        showLastUpdated?: boolean;
        tags?: string[];
        agentsEnabled?: boolean;
        introductionEnabled?: boolean;
        introductionContent?: any;
        requestListEnabled?: boolean;
        brandId?: string | null;
      };

      const featureFlags = await getFeatureFlags({ teamId: team.id });
      const isDataroomsPlus =
        team.plan.includes("datarooms-plus") ||
        team.plan.includes("datarooms-premium") ||
        team.plan.includes("datarooms-unlimited");
      const isTrial = team.plan.includes("drtrial");

      if (
        (enableChangeNotifications !== undefined ||
          enableVisitorUploadChangeNotifications !== undefined) &&
        !isDataroomsPlus &&
        !isTrial &&
        !featureFlags.roomChangeNotifications
      ) {
        return res.status(403).json({
          message: "This feature is not available in your plan",
        });
      }

      if (agentsEnabled !== undefined && !featureFlags.ai) {
        return res.status(403).json({
          message: "This feature is not available in your plan",
        });
      }

      if (
        requestListEnabled !== undefined &&
        !isRequestListEnabled({
          requestListFlag: featureFlags.requestList,
          teamPlan: team.plan,
        })
      ) {
        return res.status(403).json({
          message: "This feature is not available in your plan",
        });
      }

      for (const value of [defaultRootItemAccess, defaultGroupRootItemAccess]) {
        if (
          value !== undefined &&
          !Object.values(RootItemAccess).includes(value)
        ) {
          return res.status(400).json({
            message: "Invalid root item access value",
          });
        }
      }

      const nextBrandId =
        brandId === undefined
          ? undefined
          : await resolveOwnedBrandId(team.id, brandId);

      const updatedDataroom = await prisma.$transaction(async (tx) => {
        const dataroom = await tx.dataroom.update({
          where: {
            id: dataroomId,
            teamId: team.id,
          },
          data: {
            ...(nextBrandId !== undefined && { brandId: nextBrandId }),
            ...(name && { name }),
            ...(internalName !== undefined && {
              internalName:
                internalName === null || internalName === ""
                  ? null
                  : internalName.trim(),
            }),
            ...(typeof enableChangeNotifications === "boolean" && {
              enableChangeNotifications,
            }),
            ...(typeof enableVisitorUploadChangeNotifications === "boolean" && {
              enableVisitorUploadChangeNotifications,
            }),
            ...(defaultPermissionStrategy && { defaultPermissionStrategy }),
            ...(defaultGroupPermissionStrategy && {
              defaultGroupPermissionStrategy,
            }),
            ...(defaultRootItemAccess && { defaultRootItemAccess }),
            ...(defaultGroupRootItemAccess && {
              defaultGroupRootItemAccess,
            }),
            ...(typeof allowBulkDownload === "boolean" && {
              allowBulkDownload,
            }),
            ...(typeof showLastUpdated === "boolean" && {
              showLastUpdated,
            }),
            ...(typeof agentsEnabled === "boolean" && {
              agentsEnabled,
            }),
            ...(typeof introductionEnabled === "boolean" && {
              introductionEnabled,
            }),
            ...(introductionContent !== undefined && {
              introductionContent,
            }),
            ...(typeof requestListEnabled === "boolean" && {
              requestListEnabled,
            }),
          },
        });

        // Handle tags if provided
        if (tags !== undefined) {
          // Validate that all tags exist and belong to the same team
          if (tags.length > 0) {
            const validTags = await tx.tag.findMany({
              where: {
                id: { in: tags },
                teamId: teamId,
              },
              select: { id: true },
            });
            const validTagIds = new Set(validTags.map((t) => t.id));
            const invalidTags = tags.filter((id) => !validTagIds.has(id));
            if (invalidTags.length > 0) {
              throw new Error(`Invalid tag IDs: ${invalidTags.join(", ")}`);
            }
          }

          // First, delete all existing tags for this dataroom
          await tx.tagItem.deleteMany({
            where: {
              dataroomId: dataroomId,
              dataroom: {
                is: {
                  teamId: team.id,
                },
              },
              itemType: "DATAROOM_TAG",
            },
          });

          // Then create the new tags (if any)
          if (tags.length > 0) {
            await tx.tagItem.createMany({
              data: tags.map((tagId: string) => ({
                tagId,
                itemType: "DATAROOM_TAG",
                dataroomId: dataroomId,
                taggedBy: userId,
              })),
            });
          }
        }

        // Fetch the updated dataroom with tags
        const dataroomTags = await tx.tag.findMany({
          where: {
            items: {
              some: { dataroomId: dataroom.id },
            },
          },
          select: {
            id: true,
            name: true,
            color: true,
            description: true,
          },
        });

        return { ...dataroom, tags: dataroomTags };
      });

      return res.status(200).json(updatedDataroom);
    } catch (error) {
      errorhandler(error, res);
    }
  },
  { requiredPermissions: ["datarooms.write"], dataroomParam: "id" },
);

// DELETE /api/teams/:teamId/datarooms/:id
const deleteHandler = withTeamApi(
  async ({ req, res, teamId }) => {
    const { id: dataroomId } = req.query as { id: string };

    try {
      await prisma.dataroom.delete({
        where: {
          id: dataroomId,
          teamId,
        },
      });

      return res.status(204).end();
    } catch (error) {
      errorhandler(error, res);
    }
  },
  // Deleting a dataroom stays an ADMIN/MANAGER-only structural operation.
  { requiredRoles: ["ADMIN", "MANAGER"] },
);

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "GET") {
    return getHandler(req, res);
  } else if (req.method === "PATCH") {
    return patchHandler(req, res);
  } else if (req.method === "DELETE") {
    return deleteHandler(req, res);
  } else {
    res.setHeader("Allow", ["GET", "PATCH", "DELETE"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
