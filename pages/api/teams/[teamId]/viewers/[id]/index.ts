import { NextApiRequest, NextApiResponse } from "next";

import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { getServerSession } from "next-auth/next";

import { errorhandler } from "@/lib/errorHandler";
import { getVisitors } from "@/lib/api/visitors/get-visitors";
import prisma from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { getDocumentDurationPerViewer } from "@/lib/tinybird";
import { CustomUser } from "@/lib/types";
import { Prisma } from "@prisma/client";

async function fetchAndCacheDurations(
  groupedViews: Array<{ documentId: string; viewIds: string[] }>,
  teamId: string,
  viewerId: string,
  cacheKey: string
): Promise<Record<string, number>> {
  let durationsMap: Record<string, number> = {};
  const cachedDurations = await redis.get(cacheKey);

  if (cachedDurations) {
    const parsedDurations = typeof cachedDurations === 'string' ? JSON.parse(cachedDurations) : cachedDurations;
    durationsMap = parsedDurations;
  } else {
    const batchSize = 10; 
    for (let i = 0; i < groupedViews.length; i += batchSize) {
      const batch = groupedViews.slice(i, i + batchSize);

      const batchPromises = batch.map(async (view) => {
        try {
          const durationResult = await getDocumentDurationPerViewer({
            documentId: view.documentId,
            viewIds: view.viewIds.join(","),
          });
          return {
            documentId: view.documentId,
            totalDuration: durationResult.data[0]?.sum_duration || 0,
          };
        } catch (error) {
          console.error(`Error fetching duration for document ${view.documentId}:`, error);
          return {
            documentId: view.documentId,
            totalDuration: 0,
          };
        }
      });

      const batchResults = await Promise.all(batchPromises);
      batchResults.forEach(result => {
        durationsMap[result.documentId] = result.totalDuration;
      });
    }

    await redis.set(cacheKey, JSON.stringify(durationsMap), { ex: 600 });
  }

  return durationsMap;
}

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "GET") {
    // GET /api/teams/:teamId/viewers/:id
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      return res.status(401).end("Unauthorized");
    }

    const { teamId, id, page, pageSize, sortBy, sortOrder, withDuration } = req.query as {
      teamId: string;
      id: string;
      page?: string;
      pageSize?: string;
      sortBy?: string;
      sortOrder?: string;
      withDuration?: string;
    };

    // Parse pagination parameters
    const currentPage = parseInt(page || "1", 10);
    const limit = Math.min(parseInt(pageSize || "10", 10), 100); // Cap at 100 for performance
    const offset = (currentPage - 1) * limit;

    // Parse sorting parameters
    const validSortFields = ["lastViewed", "totalDuration", "viewCount"];
    const validSortOrders = ["asc", "desc"];
    const sort = validSortFields.includes(sortBy || "") ? sortBy : "lastViewed";
    const order = validSortOrders.includes(sortOrder || "") ? sortOrder : "desc";

    const userId = (session.user as CustomUser).id;

    try {
      const team = await prisma.team.findUnique({
        where: {
          id: teamId,
          users: {
            some: {
              userId,
            },
          },
        },
        select: { id: true, plan: true },
      });

      if (!team || team.plan === "free") {
        return res.status(404).json({ message: "Team not found" });
      }

      const viewer = await prisma.viewer.findUnique({
        where: { id, teamId },
        select: {
          id: true,
          email: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      if (!viewer) {
        return res.status(404).json({ message: "Viewer not found" });
      }

      // Enhanced cache key
      const cacheKey = `viewer-details:${teamId}:${id}:${currentPage}:${limit}:${sort}:${order}:v2`;

      let groupedViews: Array<{
        documentId: string;
        viewCount: number;
        lastViewed: Date;
        documentName: string | null;
        documentType: string | null;
        documentContentType: string | null;
        viewIds: string[];
        totalDuration?: number;
      }>;

      let orderByClause: Prisma.Sql;
      if (sort === "lastViewed") {
        orderByClause = order === "desc"
          ? Prisma.sql`"lastViewed" DESC`
          : Prisma.sql`"lastViewed" ASC`;
      } else if (sort === "viewCount") {
        orderByClause = order === "desc"
          ? Prisma.sql`"viewCount" DESC, "lastViewed" DESC`
          : Prisma.sql`"viewCount" ASC, "lastViewed" DESC`;
      } else {
        orderByClause = Prisma.sql`"lastViewed" DESC`;
      }

      if (sort === "totalDuration") {
        const allDocuments = await prisma.$queryRaw`
          WITH viewer_documents AS (
            SELECT 
              v."documentId",
              COUNT(v.id)::int as "viewCount",
              MAX(v."viewedAt") as "lastViewed",
              d.name as "documentName",
              d.type as "documentType",
              d."contentType" as "documentContentType",
              ARRAY_AGG(v.id ORDER BY v."viewedAt" DESC) as "viewIds"
            FROM "View" v
            INNER JOIN "Document" d ON v."documentId" = d.id
            WHERE v."viewerId" = ${id}
              AND v."documentId" IS NOT NULL
            GROUP BY v."documentId", d.name, d.type, d."contentType"
          )
          SELECT * FROM viewer_documents
          ORDER BY "lastViewed" DESC
        ` as Array<{
          documentId: string;
          viewCount: number;
          lastViewed: Date;
          documentName: string | null;
          documentType: string | null;
          documentContentType: string | null;
          viewIds: string[];
        }>;

        const durationCacheKey = `durations:${teamId}:${id}:all:duration-sort`;
        const durationsMap = await fetchAndCacheDurations(allDocuments, teamId, id, durationCacheKey);

        const documentsWithDurations = allDocuments.map(doc => ({
          ...doc,
          totalDuration: durationsMap[doc.documentId] || 0
        }));

        // Sort by duration efficiently
        documentsWithDurations.sort((a, b) => {
          return order === "asc"
            ? a.totalDuration - b.totalDuration
            : b.totalDuration - a.totalDuration;
        });

        // Apply pagination after sorting
        groupedViews = documentsWithDurations.slice(offset, offset + limit);

      } else {
        // Optimized query leveraging our performance indexes
        groupedViews = await prisma.$queryRaw`
          WITH viewer_documents AS (
            SELECT 
              v."documentId",
              COUNT(v.id)::int as "viewCount",
              MAX(v."viewedAt") as "lastViewed",
              d.name as "documentName",
              d.type as "documentType",
              d."contentType" as "documentContentType",
              ARRAY_AGG(v.id ORDER BY v."viewedAt" DESC) as "viewIds"
            FROM "View" v
            INNER JOIN "Document" d ON v."documentId" = d.id
            WHERE v."viewerId" = ${id}
              AND v."documentId" IS NOT NULL
            GROUP BY v."documentId", d.name, d.type, d."contentType"
          )
          SELECT * FROM viewer_documents
          ORDER BY ${orderByClause}
          LIMIT ${limit}
          OFFSET ${offset}
        ` as Array<{
          documentId: string;
          viewCount: number;
          lastViewed: Date;
          documentName: string | null;
          documentType: string | null;
          documentContentType: string | null;
          viewIds: string[];
        }>;
      }

      const totalCountResult = await prisma.$queryRaw`
        SELECT COUNT(DISTINCT v."documentId")::int as count
        FROM "View" v
        WHERE v."viewerId" = ${id}
          AND v."documentId" IS NOT NULL
      ` as Array<{ count: number }>;

      const totalItems = totalCountResult[0]?.count || 0;
      const totalPages = Math.ceil(totalItems / limit);

      // If withDuration=true, return only duration data for faster response
      if (withDuration === "true") {
        try {
          const durationCacheKey = `durations:${teamId}:${id}:${currentPage}:${limit}:${sort}:${order}`;
          const durationsMap = await fetchAndCacheDurations(groupedViews, teamId, id, durationCacheKey);

          // Per-viewer data behind auth: keep it out of shared/CDN caches.
          res.setHeader("Cache-Control", "private, no-store");
          return res.status(200).json({ durations: durationsMap });

        } catch (error) {
          console.error("Error processing duration batches:", error);
          // Return empty durations on error
          const emptyDurationsMap = Object.fromEntries(
            groupedViews.map(view => [view.documentId, 0])
          );
          return res.status(200).json({ durations: emptyDurationsMap });
        }
      }

      // Standard response without durations
      const formattedViews = groupedViews.map((view) => ({
        documentId: view.documentId,
        viewCount: view.viewCount,
        lastViewed: view.lastViewed,
        document: {
          id: view.documentId,
          name: view.documentName,
          type: view.documentType,
          contentType: view.documentContentType,
        },
        totalDuration: view.totalDuration || 0,
      }));

      // How this person can reach the team's content: groups, allow lists,
      // invitations, blocks. Never fatal — the profile still renders without it.
      let access: Awaited<ReturnType<typeof getVisitors>>["visitors"][number] | null =
        null;
      try {
        const { visitors } = await getVisitors({
          teamId,
          email: viewer.email ?? undefined,
          pageSize: 1,
        });
        access = visitors[0] ?? null;
      } catch (accessError) {
        access = null;
      }

      const newViewer = {
        ...viewer,
        access,
        views: formattedViews,
        pagination: {
          currentPage,
          pageSize: limit,
          totalItems,
          totalPages,
          hasNext: currentPage < totalPages,
          hasPrev: currentPage > 1,
        },
        sorting: {
          sortBy: sort,
          sortOrder: order,
        },
      };

      if (withDuration !== "true") {
        await redis.set(cacheKey, JSON.stringify(formattedViews), { ex: 600 }); // 10 min cache
      }
      // Per-viewer data behind auth: keep it out of shared/CDN caches.
      res.setHeader("Cache-Control", "private, no-store");

      return res.status(200).json(newViewer);
    } catch (error) {
      console.error('Viewer Details API Error:', error);
      errorhandler(error, res);
    }
  } else {
    // We only allow GET requests
    res.setHeader("Allow", ["GET"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
