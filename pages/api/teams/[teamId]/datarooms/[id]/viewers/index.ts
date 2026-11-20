import { NextApiRequest, NextApiResponse } from "next";

import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { getServerSession } from "next-auth/next";

import { enforceDataroomMemberScope } from "@/lib/api/rbac/guard";
import { errorhandler } from "@/lib/errorHandler";
import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";
import { log } from "@/lib/utils";

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "GET") {
    // GET /api/teams/:teamId/datarooms/:id/viewers
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      return res.status(401).end("Unauthorized");
    }

    const { teamId, id: dataroomId } = req.query as {
      teamId: string;
      id: string;
    };
    const userId = (session.user as CustomUser).id;

    // Scoped members may only read viewers for their assigned rooms.
    if (await enforceDataroomMemberScope({ userId, teamId, dataroomId, res })) {
      return;
    }

    try {
      const team = await prisma.team.findUnique({
        where: {
          id: teamId,
          users: {
            some: { userId },
          },
        },
        select: {
          id: true,
        },
      });

      if (!team) {
        return res.status(403).end("Unauthorized to access this team");
      }

      const viewers = await prisma.viewer.findMany({
        where: {
          teamId: teamId,
          views: {
            some: {
              dataroomId: dataroomId,
              viewType: "DATAROOM_VIEW",
            },
          },
        },
        select: {
          id: true,
          teamId: true,
          email: true,
          verified: true,
          views: {
            where: {
              dataroomId: dataroomId,
              viewType: "DATAROOM_VIEW",
            },
            orderBy: {
              viewedAt: "desc",
            },
            select: {
              id: true,
              viewedAt: true,
              downloadedAt: true,
              viewerName: true,
            },
          },
        },
      });

      const dataroom = await prisma.dataroom.findUnique({
        where: {
          id: dataroomId,
          teamId: teamId,
        },
        select: {
          name: true,
        },
      });

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

      const returnViews = viewers.map((viewer) => {
        // Get the name from the most recent view that has a name
        const viewerName = viewer.views.find((v) => v.viewerName)?.viewerName;
        
        return {
          ...viewer,
          dataroomName: dataroom?.name,
          lastViewedAt:
            viewer.views.length > 0 ? viewer.views[0].viewedAt : null,
          viewerName: viewerName || null,
          internal: users.some((user) => user.email === viewer.email), // set internal to true if view.viewerEmail is in the users list
        };
      });

      return res.status(200).json(returnViews);
    } catch (error) {
      log({
        message: `Failed to get viewers for dataroom: _${dataroomId}_. \n\n ${error} \n\n*Metadata*: \`{teamId: ${teamId}, userId: ${userId}}\``,
        type: "error",
      });
      errorhandler(error, res);
    }
  } else {
    // We only allow GET requests
    res.setHeader("Allow", ["GET"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
