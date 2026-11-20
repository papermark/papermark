import { NextApiRequest, NextApiResponse } from "next";

import { isTeamPausedById } from "@/ee/features/billing/cancellation/lib/is-team-paused";
import { resolveDefaultBrandId } from "@/ee/features/branding/lib/resolve-base-brand";
import { getLimits } from "@/ee/limits/server";
import { Prisma } from "@prisma/client";

import { withTeamApi } from "@/lib/api/auth/with-session-team";
import { isDataroomScopedRole } from "@/lib/api/rbac/permissions";
import { newId } from "@/lib/id-helper";
import prisma from "@/lib/prisma";

export const config = {
  maxDuration: 180,
};

const DATAROOM_PLANS = [
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
];

// GET /api/teams/:teamId/datarooms
const getHandler = withTeamApi(
  async ({ req, res, teamId, role, allowedDataroomIds }) => {
    const { search, tags, simple } = req.query as {
      search?: string;
      tags?: string;
      simple?: string;
    };

    const isSimpleMode = simple === "true";
    const scoped = isDataroomScopedRole(role);

    try {
      // Simple mode: return minimal data without filters, tags, or aggregations
      if (isSimpleMode) {
        const datarooms = await prisma.dataroom.findMany({
          where: {
            teamId: teamId,
            ...(scoped ? { id: { in: allowedDataroomIds } } : {}),
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
        // Dataroom-scoped members only ever see their assigned rooms.
        ...(scoped ? { id: { in: allowedDataroomIds } } : {}),
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

      const countWhere: Prisma.DataroomWhereInput = {
        teamId: teamId,
        ...(scoped ? { id: { in: allowedDataroomIds } } : {}),
      };

      const [totalCount, datarooms] = await Promise.all([
        prisma.dataroom.count({
          where: countWhere,
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
  },
  { requiredPermissions: ["datarooms.read"] },
);

// POST /api/teams/:teamId/datarooms
const postHandler = withTeamApi(
  async ({ req, res, teamId, userId, team }) => {
    const { name, internalName } = req.body as {
      name: string;
      internalName?: string;
    };

    try {
      if (!DATAROOM_PLANS.includes(team.plan)) {
        return res.status(403).end("Forbidden");
      }

      // Check if team is paused
      const teamIsPaused = await isTeamPausedById(teamId);
      if (teamIsPaused) {
        return res.status(403).json({
          error:
            "Team is currently paused. New dataroom creation is not available.",
        });
      }

      const [dataroomCount, limits, defaultBrandId] = await Promise.all([
        prisma.dataroom.count({
          where: {
            teamId: teamId,
          },
        }),
        getLimits({ teamId, userId }),
        resolveDefaultBrandId(teamId),
      ]);

      if (
        limits &&
        limits.datarooms !== null &&
        dataroomCount >= limits.datarooms
      ) {
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
          brandId: defaultBrandId,
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
  },
  {
    // Creating a dataroom is a team-level structural action; scoped members are
    // excluded (they hold datarooms.write only for rooms they already manage).
    requiredPermissions: ["datarooms.write"],
    requiredRoles: ["ADMIN", "MANAGER", "MEMBER"],
  },
);

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "GET") {
    return getHandler(req, res);
  } else if (req.method === "POST") {
    return postHandler(req, res);
  } else {
    res.setHeader("Allow", ["GET", "POST"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
