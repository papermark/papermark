import { NextApiRequest, NextApiResponse } from "next";

import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { DefaultPermissionStrategy } from "@prisma/client";
import { getServerSession } from "next-auth/next";

import { errorhandler } from "@/lib/errorHandler";
import { getFeatureFlags } from "@/lib/featureFlags";
import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "GET") {
    // GET /api/teams/:teamId/datarooms/:id
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
  } else if (req.method === "PATCH") {
    // PATCH /api/teams/:teamId/datarooms/:id
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
      // Check if the user is part of the team
      const team = await prisma.team.findUnique({
        where: {
          id: teamId,
          users: {
            some: {
              userId: userId,
            },
          },
        },
        select: {
          id: true,
          plan: true,
        },
      });

      if (!team) {
        return res.status(401).end("Unauthorized");
      }

      const {
        name,
        internalName,
        enableChangeNotifications,
        defaultPermissionStrategy,
        allowBulkDownload,
        showLastUpdated,
        tags,
        agentsEnabled,
        introductionEnabled,
        introductionContent,
      } = req.body as {
        name?: string;
        internalName?: string | null;
        enableChangeNotifications?: boolean;
        defaultPermissionStrategy?: DefaultPermissionStrategy;
        allowBulkDownload?: boolean;
        showLastUpdated?: boolean;
        tags?: string[];
        agentsEnabled?: boolean;
        introductionEnabled?: boolean;
        introductionContent?: any;
      };

      const featureFlags = await getFeatureFlags({ teamId: team.id });
      const isDataroomsPlus = team.plan.includes("datarooms-plus") || team.plan.includes("datarooms-premium");
      const isTrial = team.plan.includes("drtrial");

      if (
        enableChangeNotifications !== undefined &&
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

      const updatedDataroom = await prisma.$transaction(async (tx) => {
        const dataroom = await tx.dataroom.update({
          where: {
            id: dataroomId,
          },
          data: {
            ...(name && { name }),
            ...(internalName !== undefined && { 
              internalName: internalName === null || internalName === "" ? null : internalName.trim() 
            }),
            ...(typeof enableChangeNotifications === "boolean" && {
              enableChangeNotifications,
            }),
            ...(defaultPermissionStrategy && { defaultPermissionStrategy }),
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
  } else if (req.method === "DELETE") {
    // DELETE /api/teams/:teamId/datarooms/:id
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      return res.status(401).end("Unauthorized");
    }

    const userId = (session.user as CustomUser).id;
    const { teamId, id: dataroomId } = req.query as {
      teamId: string;
      id: string;
    };

    try {
      const teamAccess = await prisma.userTeam.findUnique({
        where: {
          userId_teamId: {
            userId: userId,
            teamId: teamId,
          },
        },
        select: {
          role: true,
        },
      });

      if (!teamAccess) {
        return res.status(401).end("Unauthorized");
      }

      if (teamAccess.role !== "ADMIN" && teamAccess.role !== "MANAGER") {
        return res.status(403).json({
          message:
            "You are not permitted to perform this action. Only admin and managers can delete datarooms.",
        });
      }

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
  } else {
    // We only allow GET, and PATCH requests
    res.setHeader("Allow", ["GET", "PATCH"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
