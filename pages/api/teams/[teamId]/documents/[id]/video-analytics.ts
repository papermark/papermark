import { NextApiRequest, NextApiResponse } from "next";

import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { getServerSession } from "next-auth/next";

import { enforceDocumentMemberScope } from "@/lib/api/rbac/guard";
import prisma from "@/lib/prisma";
import { getVideoEventsByDocument } from "@/lib/tinybird/pipes";
import { CustomUser } from "@/lib/types";
import {
  countablePlaybackEvents,
  documentViewDistribution,
  resolveVideoLength,
  watchTimeSeconds,
} from "@/lib/video-analytics/playback";

interface AnalyticsResponse {
  overall: {
    unique_views: number;
    total_views: number;
    total_watch_time: number;
    avg_view_duration: number;
    last_viewed_at: string;
    first_viewed_at: string;
    view_distribution: Array<{
      start_time: number;
      unique_views: number;
      total_views: number;
    }>;
  } | null;
}

function calculateAnalytics(
  events: Array<{
    timestamp: string;
    view_id: string;
    event_type: string;
    start_time: number;
    end_time: number;
    playback_rate: number;
    volume: number;
    is_muted: number;
    is_focused: number;
    is_fullscreen: number;
  }>,
  videoLength: number,
): AnalyticsResponse {
  if (!events || events.length === 0) {
    return {
      overall: null,
    };
  }

  try {
    const validEvents = countablePlaybackEvents(
      events.filter((event) => event?.view_id && event.start_time >= 0),
    );
    const timelineLength = resolveVideoLength(videoLength, validEvents);
    const uniqueViewIds = new Set(events.map((e) => e.view_id));
    const { total: totalWatchTime } = watchTimeSeconds(validEvents);

    const sortedEvents = [...validEvents].sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );

    return {
      overall: {
        unique_views: uniqueViewIds.size,
        total_views: uniqueViewIds.size,
        total_watch_time: totalWatchTime,
        avg_view_duration:
          uniqueViewIds.size > 0 ? totalWatchTime / uniqueViewIds.size : 0,
        first_viewed_at:
          sortedEvents.length > 0 ? sortedEvents[0].timestamp : "",
        last_viewed_at:
          sortedEvents.length > 0
            ? sortedEvents[sortedEvents.length - 1].timestamp
            : "",
        view_distribution: documentViewDistribution(
          validEvents,
          timelineLength,
        ),
      },
    };
  } catch (error) {
    console.error("Error calculating analytics:", error);
    console.error("Events data:", JSON.stringify(events, null, 2));
    throw error;
  }
}

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    const session = await getServerSession(req, res, authOptions);
    const user = session?.user as CustomUser;

    if (!user?.id) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const { teamId, id: documentId } = req.query as {
      teamId: string;
      id: string;
    };

    // Scoped members may only read analytics for documents in their assigned rooms.
    if (
      await enforceDocumentMemberScope({
        userId: user.id,
        teamId,
        documentId,
        res,
      })
    ) {
      return;
    }

    // Check if user has access to this document and team
    const document = await prisma.document.findFirst({
      where: {
        id: documentId,
        teamId,
        team: {
          users: {
            some: {
              userId: user.id,
            },
          },
        },
      },
      include: {
        versions: {
          where: {
            isPrimary: true,
          },
          select: {
            length: true,
          },
        },
      },
    });

    if (!document) {
      return res.status(404).json({ message: "Document not found" });
    }

    const videoLength = document.versions[0]?.length ?? 0;

    try {
      // Fetch video events from Tinybird
      const response = await getVideoEventsByDocument({
        document_id: documentId,
      });

      if (!response || !response.data) {
        console.error("Invalid response from Tinybird:", response);
        return res
          .status(500)
          .json({ message: "Invalid response from analytics service" });
      }

      // Validate that response.data is an array
      if (!Array.isArray(response.data)) {
        console.error("Response data is not an array:", response.data);
        return res
          .status(500)
          .json({ message: "Invalid data format from analytics service" });
      }

      const analytics = calculateAnalytics(response.data, videoLength);
      return res.status(200).json(analytics);
    } catch (error) {
      console.error("Tinybird error details:", {
        error,
        message: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
      });
      return res.status(500).json({
        message: "Error fetching video analytics",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  } catch (error) {
    console.error(
      "Error in /api/teams/[teamId]/documents/[id]/video-analytics:",
      {
        error,
        message: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
      },
    );
    return res.status(500).json({
      message: "Internal Server Error",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
