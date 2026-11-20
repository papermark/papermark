import { NextApiRequest, NextApiResponse } from "next";

import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { getServerSession } from "next-auth/next";

import { enforceDocumentMemberScope } from "@/lib/api/rbac/guard";
import prisma from "@/lib/prisma";
import { getVideoEventsByView } from "@/lib/tinybird/pipes";
import { CustomUser } from "@/lib/types";
import {
  countablePlaybackEvents,
  resolveVideoLength,
  viewPlaybackTimeline,
} from "@/lib/video-analytics/playback";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const {
      teamId,
      id: documentId,
      viewId,
    } = req.query as {
      teamId: string;
      id: string;
      viewId: string;
    };
    const userId = (session.user as CustomUser).id;

    // Scoped members may only read views for documents in their assigned rooms.
    if (
      await enforceDocumentMemberScope({
        userId,
        teamId,
        documentId,
        res,
      })
    ) {
      return;
    }

    // Check document access
    const doc = await prisma.document.findFirst({
      where: {
        id: documentId,
        teamId,
        team: {
          users: {
            some: {
              userId,
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

    if (!doc) {
      return res.status(404).json({ error: "Document not found" });
    }

    const storedLength = doc.versions[0]?.length ?? 0;

    const response = await getVideoEventsByView({
      view_id: viewId,
      document_id: documentId,
    });

    if (!response?.data) {
      return res.status(200).json({ data: [] });
    }

    const validEvents = countablePlaybackEvents(response.data);
    const videoLength = resolveVideoLength(storedLength, validEvents);

    return res.status(200).json({
      data: viewPlaybackTimeline(validEvents, videoLength),
    });
  } catch (error) {
    console.error("Error fetching video stats:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
