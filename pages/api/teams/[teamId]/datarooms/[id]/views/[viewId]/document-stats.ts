import { NextApiRequest, NextApiResponse } from "next";

import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { getServerSession } from "next-auth/next";

import { errorhandler } from "@/lib/errorHandler";
import prisma from "@/lib/prisma";
import { getDataroomViewDocumentStats, getViewPageDuration } from "@/lib/tinybird";
import { getVideoEventsByDocument } from "@/lib/tinybird/pipes";
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
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      return res.status(401).end("Unauthorized");
    }

    const {
      teamId,
      id: dataroomId,
      viewId,
    } = req.query as {
      teamId: string;
      id: string;
      viewId: string;
    };

    const documentViewId = req.query.documentViewId as string | undefined;
    const documentId = req.query.documentId as string | undefined;

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
        select: { id: true },
      });

      if (!team) {
        return res.status(403).end("Unauthorized to access this team");
      }

      const dataroom = await prisma.dataroom.findUnique({
        where: { id: dataroomId, teamId },
        select: { id: true },
      });

      if (!dataroom) {
        return res.status(403).end("Unauthorized to access this dataroom");
      }

      const view = await prisma.view.findUnique({
        where: { id: viewId, dataroomId },
        select: { id: true },
      });

      if (!view) {
        return res.status(403).end("Unauthorized to access this view");
      }

      // If documentViewId and documentId are provided, return per-page stats
      if (documentViewId && documentId) {
        const documentView = await prisma.view.findUnique({
          where: {
            id: documentViewId,
            dataroomId,
            viewType: "DOCUMENT_VIEW",
          },
          select: { id: true },
        });

        if (!documentView) {
          return res
            .status(403)
            .end("Unauthorized to access this document view");
        }

        const duration = await getViewPageDuration({
          documentId,
          viewId: documentViewId,
          since: 0,
        });

        return res.status(200).json({ duration });
      }

      // Otherwise return summary stats for all document views under this dataroom view
      const documentViews = await prisma.view.findMany({
        where: {
          dataroomViewId: viewId,
          dataroomId,
          viewType: "DOCUMENT_VIEW",
        },
        select: {
          id: true,
          documentId: true,
          document: {
            select: {
              id: true,
              name: true,
              type: true,
              versions: {
                where: { isPrimary: true },
                take: 1,
                select: { numPages: true, length: true, type: true },
              },
            },
          },
        },
      });

      if (!documentViews.length) {
        return res.status(200).json({ documentStats: [] });
      }

      const viewIds = documentViews.map((v) => v.id).join(",");

      const videoDocumentIds = [
        ...new Set(
          documentViews
            .filter(
              (dv) =>
                (dv.document?.type ?? dv.document?.versions?.[0]?.type) ===
                "video",
            )
            .map((dv) => dv.documentId)
            .filter((id): id is string => Boolean(id)),
        ),
      ];

      const [tinybirdStats, videoEventsByDocument] = await Promise.all([
        getDataroomViewDocumentStats({ viewIds }),
        Promise.all(
          videoDocumentIds.map(async (id) => {
            const response = await getVideoEventsByDocument({
              document_id: id,
            });
            return [id, countablePlaybackEvents(response.data)] as const;
          }),
        ),
      ]);

      const statsMap = new Map(
        tinybirdStats.data.map((s) => [`${s.viewId}:${s.documentId}`, s]),
      );
      const videoEvents = new Map(videoEventsByDocument);

      const documentStats = documentViews.map((dv) => {
        const documentType =
          dv.document?.type ?? dv.document?.versions?.[0]?.type ?? null;
        if (documentType === "video") {
          const events = videoEvents.get(dv.documentId ?? "") ?? [];
          const viewEvents = eventsForView(events, dv.id);
          const { total, unique } = watchTimeSeconds(viewEvents);
          const videoLength = resolveVideoLength(
            dv.document?.versions?.[0]?.length,
            events,
          );
          return {
            viewId: dv.id,
            documentId: dv.documentId,
            totalDuration: total * 1000,
            pagesViewed: unique,
            totalPages: 0,
            completionRate: Math.round(completionRate(unique, videoLength)),
            documentType: "video",
          };
        }

        const stats = statsMap.get(`${dv.id}:${dv.documentId}`);
        const totalPages = dv.document?.versions?.[0]?.numPages ?? 0;
        const pagesViewed = stats?.pages_viewed ?? 0;
        const pageCompletion =
          totalPages > 0 ? Math.round((pagesViewed / totalPages) * 100) : 0;

        return {
          viewId: dv.id,
          documentId: dv.documentId,
          totalDuration: stats?.sum_duration ?? 0,
          pagesViewed,
          totalPages,
          completionRate: pageCompletion,
          documentType,
        };
      });

      return res.status(200).json({ documentStats });
    } catch (error) {
      errorhandler(error, res);
    }
  } else {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
