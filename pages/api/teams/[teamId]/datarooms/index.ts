import { NextApiRequest, NextApiResponse } from "next";

import { isTeamPausedById } from "@/ee/features/billing/cancellation/lib/is-team-paused";
import { getLimits } from "@/ee/limits/server";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { Prisma } from "@prisma/client";
import { getServerSession } from "next-auth/next";

import { newId } from "@/lib/id-helper";
import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";

export const config = {
  maxDuration: 180,
};

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "GET") {
    // GET /api/teams/:teamId/datarooms
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      return res.status(401).end("Unauthorized");
    }

    const userId = (session.user as CustomUser).id;
    const { teamId, search, status, tags, simple } = req.query as {
      teamId: string;
      search?: string;
      status?: string;
      tags?: string;
      simple?: string;
    };

    // Simple mode: return minimal data without filters, tags, or aggregations
    const isSimpleMode = simple === "true";

    try {
      const teamAccess = await prisma.userTeam.findUnique({
        where: {
          userId_teamId: {
            userId: userId,
            teamId: teamId,
          },
        },
        select: {
          teamId: true,
        },
      });

      if (!teamAccess) {
        return res.status(401).end("Unauthorized");
      }

      // Simple mode: return minimal data without filters, tags, or aggregations
      if (isSimpleMode) {
        const datarooms = await prisma.dataroom.findMany({
          where: {
            teamId: teamId,
          },
          select: {
            id: true,
            name: true,
            internalName: true,
            isFrozen: true,
            createdAt: true,
          },
          orderBy: {
            createdAt: "desc",
          },
        });

        return res.status(200).json({ datarooms });
      }

      const now = new Date();
      const activeLinkFilter: Prisma.LinkWhereInput = {
        linkType: "DATAROOM_LINK",
        deletedAt: null,
        isArchived: false,
        OR: [{ expiresAt: null }, { expiresAt: { gte: now } }],
      };

      // Build where clause based on filters
      const whereClause: Prisma.DataroomWhereInput = {
        teamId: teamId,
      };

      // Search filter - search both name and internalName
      if (search) {
        whereClause.OR = [
          {
            name: {
              contains: search,
              mode: "insensitive",
            },
          },
          {
            internalName: {
              contains: search,
              mode: "insensitive",
            },
          },
        ];
      }

      // Tags filter
      if (tags) {
        const tagNames = tags.split(",").filter(Boolean);
        if (tagNames.length > 0) {
          whereClause.tags = {
            some: {
              tag: {
                name: {
                  in: tagNames,
                },
              },
            },
          };
        }
      }

      // if (status === "active") {
      //   whereClause.links = { some: activeLinkFilter };
      // } else if (status === "inactive") {
      //   whereClause.links = { none: activeLinkFilter };
      // }

      const [totalCount, datarooms] = await Promise.all([
        prisma.dataroom.count({
          where: {
            teamId: teamId,
          },
        }),
        prisma.dataroom.findMany({
          where: whereClause,
          select: {
            id: true,
            name: true,
            isFrozen: true,
            createdAt: true,
            _count: {
              select: { documents: true, views: true },
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
          orderBy: {
            createdAt: "desc",
          },
        }),
      ]);

      const dataroomIds = datarooms.map((dataroom) => dataroom.id);
      const [activeLinkCounts, lastViewedAtByDataroom] = dataroomIds.length
        ? await Promise.all([
            prisma.link.groupBy({
              by: ["dataroomId"],
              where: {
                dataroomId: { in: dataroomIds },
                ...activeLinkFilter,
              },
              _count: {
                _all: true,
              },
            }),
            prisma.view.groupBy({
              by: ["dataroomId"],
              where: {
                dataroomId: { in: dataroomIds },
              },
              _max: {
                viewedAt: true,
              },
            }),
          ])
        : [[], []];

      const activeLinkCountMap = new Map(
        activeLinkCounts.map((entry) => [entry.dataroomId, entry._count._all]),
      );
      const lastViewedAtMap = new Map(
        lastViewedAtByDataroom.map((entry) => [
          entry.dataroomId,
          entry._max.viewedAt,
        ]),
      );

      const dataroomsWithStats = datarooms.map((dataroom) => ({
        ...dataroom,
        activeLinkCount: activeLinkCountMap.get(dataroom.id) ?? 0,
        lastViewedAt: lastViewedAtMap.get(dataroom.id) ?? null,
      }));

      return res.status(200).json({
        datarooms: dataroomsWithStats,
        totalCount,
      });
    } catch (error) {
      console.error("Request error", error);
      return res.status(500).json({ error: "Error fetching datarooms" });
    }
  } else if (req.method === "POST") {
    // POST /api/teams/:teamId/datarooms
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      res.status(401).end("Unauthorized");
      return;
    }

    const userId = (session.user as CustomUser).id;

    const { teamId } = req.query as { teamId: string };
    const { name, internalName } = req.body as { name: string; internalName?: string };

    try {
      // Check if the user is part of the team
      const team = await prisma.team.findUnique({
        where: {
          id: teamId,
          plan: {
            in: [
              "business",
              "datarooms",
              "datarooms-plus",
              "datarooms-premium",
              "datarooms-unlimited",
              "business+old",
              "datarooms+old",
              "datarooms-plus+old",
              "datarooms-premium+old",
              "datarooms-unlimited+old",
              "free+drtrial",
              "datarooms+drtrial",
              "business+drtrial",
              "datarooms-plus+drtrial",
              "datarooms-premium+drtrial",
              "datarooms-unlimited+drtrial",
            ],
          },
          users: {
            some: {
              userId: userId,
            },
          },
        },
      });

      if (!team) {
        return res.status(401).end("Unauthorized");
      }

      // Check if team is paused
      const teamIsPaused = await isTeamPausedById(teamId);
      if (teamIsPaused) {
        return res.status(403).json({
          error:
            "Team is currently paused. New dataroom creation is not available.",
        });
      }

      // Limits: Check if the user has reached the limit of datarooms in the team
      const dataroomCount = await prisma.dataroom.count({
        where: {
          teamId: teamId,
        },
      });

      const limits = await getLimits({ teamId, userId });

      if (limits && limits.datarooms !== null && dataroomCount >= limits.datarooms) {
        return res
          .status(403)
          .json({ message: "You have reached the limit of datarooms" });
      }

      const pId = newId("dataroom");

      const dataroom = await prisma.dataroom.create({
        data: {
          name: name,
          teamId: teamId,
          pId: pId,
          ...(internalName && { internalName: internalName.trim() }),
        },
      });

      const dataroomWithCount = {
        ...dataroom,
        _count: { documents: 0 },
      };

      res.status(201).json({ dataroom: dataroomWithCount });
    } catch (error) {
      console.error("Request error", error);
      res.status(500).json({ error: "Error creating dataroom" });
    }
  } else {
    // We only allow POST requests
    res.setHeader("Allow", ["GET", "POST"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
