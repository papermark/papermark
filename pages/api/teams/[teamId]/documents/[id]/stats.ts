import { NextApiRequest, NextApiResponse } from "next";

import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { View } from "@prisma/client";
import { getServerSession } from "next-auth/next";

import { assertDocumentAccess } from "@/lib/api/rbac/entitlements";
import { errorhandler } from "@/lib/errorHandler";
import prisma from "@/lib/prisma";
import {
  getTotalAvgPageDuration,
  getTotalDocumentDuration,
} from "@/lib/tinybird";
import {
  getVideoEventsByDocument,
  getViewCompletionStats,
} from "@/lib/tinybird/pipes";
import { CustomUser } from "@/lib/types";
import {
  countablePlaybackEvents,
  completionRate,
  eventsForView,
  resolveVideoLength,
  watchTimeSeconds,
} from "@/lib/video-analytics/playback";

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "GET") {
    // GET /api/teams/:teamId/documents/:id/stats
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      return res.status(401).end("Unauthorized");
    }

    const {
      teamId,
      id: docId,
      excludeTeamMembers,
      dataroomId,
    } = req.query as {
      teamId: string;
      id: string;
      excludeTeamMembers?: string;
      // When provided, stats are scoped to this data room's visits only,
      // treating the document's direct-link visits as out of scope.
      dataroomId?: string;
    };

    const userId = (session.user as CustomUser).id;

    try {
      const teamHasUser = await prisma.team.findUnique({
        where: { id: teamId, users: { some: { userId } } },
      });

      if (!teamHasUser) {
        return res.status(401).end("Unauthorized");
      }

      // Dataroom-scoped members may only read stats for a document in one of
      // their assigned rooms.
      const membership = await prisma.userTeam.findUnique({
        where: { userId_teamId: { userId, teamId } },
        select: { role: true },
      });
      const hasDocumentAccess = await assertDocumentAccess({
        role: membership?.role ?? "",
        userId,
        teamId,
        documentId: docId,
      });
      if (!hasDocumentAccess) {
        return res.status(403).end("Forbidden");
      }

      // First check if document exists and get basic info
      const document = await prisma.document.findUnique({
        where: {
          id: docId,
          teamId,
        },
        select: {
          id: true,
          teamId: true,
          numPages: true,
          type: true,
          versions: {
            orderBy: { createdAt: "desc" },
            select: {
              versionNumber: true,
              createdAt: true,
              numPages: true,
              type: true,
              length: true,
            },
          },
          _count: {
            select: {
              views: { where: { isArchived: false } },
            },
          },
        },
      });

      if (!document) {
        return res.status(404).json({ error: "Document not found" });
      }

      // Early return for documents with no views - avoid expensive queries
      if (document._count.views === 0) {
        return res.status(200).json({
          views: [],
          duration: { data: [] },
          total_duration: 0,
          avgCompletionRate: 0,
          totalViews: 0,
        });
      }

      // Only fetch views and users if we have views
      const [views, users] = await Promise.all([
        prisma.view.findMany({
          where: {
            documentId: docId,
          },
        }),
        excludeTeamMembers
          ? prisma.user.findMany({
              where: {
                teams: {
                  some: {
                    teamId: teamId,
                  },
                },
              },
              select: {
                email: true,
              },
            })
          : Promise.resolve([]),
      ]);

      const activeViews = views.filter((view) => !view.isArchived);
      const archivedViews = views.filter((view) => view.isArchived);

      // exclude views from the team's members
      let internalViews: View[] = [];
      if (excludeTeamMembers) {
        internalViews = activeViews.filter((view) => {
          return users.some((user) => user.email === view.viewerEmail);
        });
      }

      // When scoped to a data room, the document's direct-link visits (and any
      // visits belonging to other rooms) are out of scope and excluded.
      const outOfScopeViews: View[] = dataroomId
        ? activeViews.filter((view) => view.dataroomId !== dataroomId)
        : [];

      // combined archived, internal, and out-of-scope views (deduped by id)
      const excludedViewIdSet = new Set<string>();
      for (const view of [
        ...internalViews,
        ...archivedViews,
        ...outOfScopeViews,
      ]) {
        excludedViewIdSet.add(view.id);
      }
      const excludedViewIds = Array.from(excludedViewIdSet);
      const excludedViewIdsString = excludedViewIds.join(",");

      // filter out the excluded views
      const filteredViews = views.filter(
        (view) => !excludedViewIdSet.has(view.id),
      );

      const [duration, totalDocumentDuration] = await Promise.all([
        getTotalAvgPageDuration({
          documentId: docId,
          excludedLinkIds: "",
          excludedViewIds: excludedViewIdsString,
          since: 0,
        }),
        getTotalDocumentDuration({
          documentId: docId,
          excludedLinkIds: "",
          excludedViewIds: excludedViewIdsString,
          since: 0,
        }),
      ]);

      // Calculate average completion rate for all filtered views
      let avgCompletionRate = 0;
      if (filteredViews.length > 0) {
        if (document.type === "video") {
          // For video documents, calculate based on unique watch time
          const videoEvents = await getVideoEventsByDocument({
            document_id: docId,
          });

          const countable = countablePlaybackEvents(videoEvents?.data);
          const videoLength = resolveVideoLength(
            document.versions[0]?.length,
            countable,
          );

          const completionRates = filteredViews.map((view) => {
            const { unique } = watchTimeSeconds(
              eventsForView(countable, view.id),
            );
            return completionRate(unique, videoLength);
          });

          avgCompletionRate =
            completionRates.reduce((sum, rate) => sum + rate, 0) /
            completionRates.length;
        } else {
          // For document type, calculate based on pages viewed
          const completionStats = await getViewCompletionStats({
            documentId: docId,
            excludedViewIds: excludedViewIdsString,
            since: 0,
          });

          // Build lookup map for O(1) access: viewId -> { versionNumber, pages_viewed }
          const statsMap = new Map(
            completionStats.data.map((s) => [
              s.viewId,
              { versionNumber: s.versionNumber, pagesViewed: s.pages_viewed },
            ]),
          );

          const completionRates = filteredViews.map((view) => {
            const viewStats = statsMap.get(view.id);
            if (!viewStats) return 0;

            // Find the version that matches the versionNumber from Tinybird
            const relevantVersion = document.versions.find(
              (version) => version.versionNumber === viewStats.versionNumber,
            );
            const numPages =
              relevantVersion?.numPages || document.numPages || 0;

            return numPages > 0 ? (viewStats.pagesViewed / numPages) * 100 : 0;
          });

          avgCompletionRate =
            completionRates.reduce((sum, rate) => sum + rate, 0) /
            completionRates.length;
        }
      }

      const stats = {
        views: filteredViews,
        duration,
        total_duration:
          filteredViews.length > 0
            ? ((totalDocumentDuration.data[0]?.sum_duration ?? 0) * 1.0) /
              filteredViews.length
            : 0,
        avgCompletionRate: Math.round(avgCompletionRate),
        totalViews: filteredViews.length,
      };

      return res.status(200).json(stats);
    } catch (error) {
      errorhandler(error, res);
    }
  } else {
    // We only allow GET requests
    res.setHeader("Allow", ["GET"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
