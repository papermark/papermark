import { NextApiRequest, NextApiResponse } from "next";

import { isTeamPaused } from "@/ee/features/billing/cancellation/lib/is-team-paused";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { Prisma, View } from "@prisma/client";
import { JsonValue } from "@prisma/client/runtime/library";
import { getServerSession } from "next-auth/next";

import { enforceDocumentMemberScope } from "@/lib/api/rbac/guard";
import { isDataroomScopedRole } from "@/lib/api/rbac/permissions";
import { LIMITS } from "@/lib/constants";
import { errorhandler } from "@/lib/errorHandler";
import prisma from "@/lib/prisma";
import { getViewPageDuration } from "@/lib/tinybird";
import { getVideoEventsByDocument } from "@/lib/tinybird/pipes";
import { CustomUser } from "@/lib/types";
import { log } from "@/lib/utils";
import {
  countablePlaybackEvents,
  completionRate,
  eventsForView,
  resolveVideoLength,
  watchTimeSeconds,
} from "@/lib/video-analytics/playback";

type DocumentVersion = {
  versionNumber: number;
  createdAt: Date;
  numPages: number | null;
  type: string | null;
  length: number | null;
};

type Document = {
  id: string;
  versions: DocumentVersion[];
  numPages: number | null;
  type: string | null;
  ownerId: string | null;
  _count: {
    views: number;
  };
};

type VideoEvent = {
  view_id: string;
  start_time: number;
  end_time: number;
  event_type: string;
};

type ViewWithExtras = View & {
  link: { name: string | null };
  feedbackResponse: {
    id: string;
    data: JsonValue;
  } | null;
  agreementResponse: {
    id: string;
    agreementId: string;
    signingStatus: string;
    signedAt: Date | null;
    completedAt: Date | null;
    agreement: {
      name: string;
      contentType: string;
      signingProvider: string;
    };
  } | null;
};

async function getVideoViews(
  views: ViewWithExtras[],
  document: Document,
  videoEvents: { data: VideoEvent[] },
) {
  const countable = countablePlaybackEvents(videoEvents?.data);
  const videoLength = resolveVideoLength(
    document.versions[0]?.length,
    countable,
  );

  const durationsPromises = views.map((view) => {
    const { total, unique } = watchTimeSeconds(
      eventsForView(countable, view.id),
    );

    return {
      data: [],
      totalWatchTime: total,
      uniqueWatchTime: unique,
      videoLength,
    };
  });

  const durations = await Promise.all(durationsPromises);

  return views.map((view, index) => {
    const relevantDocumentVersion = document.versions.find(
      (version) => version.createdAt <= view.viewedAt,
    );

    const duration = durations[index];

    return {
      ...view,
      duration: durations[index],
      totalDuration: duration.totalWatchTime * 1000,
      completionRate: completionRate(
        duration.uniqueWatchTime,
        duration.videoLength,
      ).toFixed(),
      versionNumber: relevantDocumentVersion?.versionNumber || 1,
      versionNumPages: 0,
    };
  });
}

async function getDocumentViews(views: ViewWithExtras[], document: Document) {
  const durationsPromises = views.map((view) => {
    return getViewPageDuration({
      documentId: document.id,
      viewId: view.id,
      since: 0,
    });
  });

  const durations = await Promise.all(durationsPromises);

  return views.map((view, index) => {
    const relevantDocumentVersion = document.versions.find(
      (version) => version.createdAt <= view.viewedAt,
    );

    const numPages =
      relevantDocumentVersion?.numPages || document.numPages || 0;
    const completionRate = numPages
      ? (durations[index].data.length / numPages) * 100
      : 0;

    return {
      ...view,
      duration: durations[index],
      totalDuration: durations[index].data.reduce(
        (total: number, data: { sum_duration: number }) =>
          total + data.sum_duration,
        0,
      ),
      completionRate: completionRate.toFixed(),
      versionNumber: relevantDocumentVersion?.versionNumber || 1,
      versionNumPages: numPages,
    };
  });
}

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "GET") {
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      return res.status(401).end("Unauthorized");
    }

    const { teamId, id: docId } = req.query as { teamId: string; id: string };

    // Optional dataroom scoping. When `dataroomId` is provided the views are
    // partitioned into the room's own visits ("dataroom") and the document's
    // direct-link visits ("other"). This powers the dataroom document page,
    // which shows room visits primarily and keeps direct-link visits separate.
    const dataroomId = (req.query.dataroomId as string) || undefined;
    const scope = (req.query.scope as string) || undefined;

    // Parse and validate pagination parameters
    const rawPage = Number.parseInt((req.query.page as string) || "1", 10);
    const rawLimit = Number.parseInt((req.query.limit as string) || "10", 10);

    // Apply defaults for invalid values and enforce constraints
    const page = Number.isNaN(rawPage) || rawPage < 1 ? 1 : rawPage;
    const limit =
      Number.isNaN(rawLimit) || rawLimit < 1
        ? 10
        : Math.min(Math.max(rawLimit, 1), 100); // Min 1, Max 100
    const offset = (page - 1) * limit;

    const userId = (session.user as CustomUser).id;

    if (
      await enforceDocumentMemberScope({ userId, teamId, documentId: docId, res })
    ) {
      return;
    }

    // Build the dataroom scope filter. "dataroom" → only this room's views;
    // "other" → only the document's direct-link visits (no dataroom).
    let scopeWhere: Prisma.ViewWhereInput = {};
    if (dataroomId) {
      if (scope === "other") {
        // Direct document-link visits must never be exposed to dataroom-scoped
        // members — they are only meaningful to full team members.
        const membership = await prisma.userTeam.findUnique({
          where: { userId_teamId: { userId, teamId } },
          select: { role: true },
        });
        if (membership && isDataroomScopedRole(membership.role)) {
          return res.status(200).json({
            viewsWithDuration: [],
            hiddenViewCount: 0,
            totalViews: 0,
          });
        }
        scopeWhere = { dataroomId: null };
      } else {
        scopeWhere = { dataroomId };
      }
    }

    try {
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
          plan: true,
          pausedAt: true,
          pauseStartsAt: true,
          pauseEndsAt: true,
        },
      });

      if (!team) {
        return res.status(404).end("Team not found");
      }

      const document = await prisma.document.findUnique({
        where: { id: docId, teamId: teamId },
        select: {
          id: true,
          ownerId: true,
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
              views: true,
            },
          },
        },
      });

      if (!document) {
        return res.status(404).end("Document not found");
      }

      const pauseStartedAt = team.pauseStartsAt;

      // Build where clause for views - if team is paused, only show views before pause date
      const viewsWhereClause = {
        documentId: docId,
        isArchived: false,
        ...scopeWhere,
        ...(pauseStartedAt && {
          viewedAt: {
            lt: pauseStartedAt,
          },
        }),
      };

      // Check if document has any views first to avoid expensive query
      const viewCount = await prisma.view.count({
        where: viewsWhereClause,
      });

      if (viewCount === 0) {
        return res.status(200).json({
          viewsWithDuration: [],
          hiddenViewCount: 0,
          totalViews: 0,
        });
      }

      const views = await prisma.view.findMany({
        skip: offset,
        take: limit,
        where: {
          documentId: docId,
          ...scopeWhere,
          ...(pauseStartedAt && {
            viewedAt: {
              lt: pauseStartedAt,
            },
          }),
        },
        orderBy: {
          viewedAt: "desc",
        },
        include: {
          link: {
            select: {
              name: true,
            },
          },
          feedbackResponse: {
            select: {
              id: true,
              data: true,
            },
          },
          agreementResponse: {
            select: {
              id: true,
              agreementId: true,
              signingStatus: true,
              signedAt: true,
              completedAt: true,
              agreement: {
                select: {
                  name: true,
                  contentType: true,
                  signingProvider: true,
                },
              },
            },
          },
        },
      });

      if (!views) {
        return res.status(404).end("Document has no views");
      }

      const users = await prisma.user.findMany({
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
      });

      // Get total view count (including views after pause date for accurate count)
      const totalViewCount = await prisma.view.count({
        where: {
          documentId: docId,
          isArchived: false,
          ...scopeWhere,
        },
      });

      // Calculate hidden views due to pause (views after pause date)
      const hiddenViewsFromPause = pauseStartedAt
        ? await prisma.view.count({
            where: {
              documentId: docId,
              isArchived: false,
              ...scopeWhere,
              viewedAt: {
                gte: pauseStartedAt,
              },
            },
          })
        : 0;

      // filter the last 20 views for free plan
      const limitedViews =
        team.plan === "free" && offset >= LIMITS.views ? [] : views;

      let viewsWithDuration;
      if (document.type === "video") {
        const videoEvents = await getVideoEventsByDocument({
          document_id: docId,
        });
        viewsWithDuration = await getVideoViews(
          limitedViews,
          document,
          videoEvents,
        );
      } else {
        viewsWithDuration = await getDocumentViews(limitedViews, document);
      }

      // Add internal flag to all views
      viewsWithDuration = viewsWithDuration.map((view) => ({
        ...view,
        internal: users.some((user) => user.email === view.viewerEmail),
      }));

      // Calculate total hidden views (free plan limits + paused team filtering)
      const hiddenFromFreePlan = views.length - limitedViews.length;
      const totalHiddenViews = hiddenFromFreePlan + hiddenViewsFromPause;

      return res.status(200).json({
        viewsWithDuration,
        hiddenViewCount: totalHiddenViews,
        totalViews: totalViewCount,
        hiddenFromPause: hiddenViewsFromPause, // Optional: to show specific pause-related hidden count
      });
    } catch (error) {
      log({
        message: `Failed to get views for document: _${docId}_. \n\n ${error} \n\n*Metadata*: \`{teamId: ${teamId}, userId: ${userId}}\``,
        type: "error",
      });
      errorhandler(error, res);
    }
  } else {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
