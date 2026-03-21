import { NextApiRequest, NextApiResponse } from "next";

import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { getServerSession } from "next-auth/next";

import { errorhandler } from "@/lib/errorHandler";
import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";
import { log } from "@/lib/utils";

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "GET") {
    // GET /api/teams/:teamId/datarooms/:id/views
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
      const team = await prisma.team.findUnique({
        where: {
          id: teamId,
          users: {
            some: {
              userId: (session.user as CustomUser).id,
            },
          },
        },
        select: {
          id: true,
          pauseStartsAt: true,
        },
      });

      if (!team) {
        return res.status(403).end("Unauthorized to access this team");
      }

      const dataroom = await prisma.dataroom.findUnique({
        where: {
          id: dataroomId,
          teamId: teamId,
        },
        select: {
          id: true,
          teamId: true,
          name: true,
         views: {
  where: {
    OR: [
      {
        viewType: "DATAROOM_VIEW",
        ...(team.pauseStartsAt && {
          viewedAt: { lt: team.pauseStartsAt },
        }),
      },
      {
        viewType: "DOCUMENT_VIEW",
        downloadType: { in: ["FOLDER", "BULK"] },
        dataroomId: dataroomId,
        ...(team.pauseStartsAt && {
          viewedAt: { lt: team.pauseStartsAt },
        }),
      },
    ],
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
              agreementResponse: {
                select: {
                  id: true,
                  agreementId: true,
                  agreement: {
                    select: {
                      name: true,
                    },
                  },
                },
              },
            },
          },
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

      // Calculate hidden views due to pause (views after pause date)
      const hiddenViewsFromPause = team.pauseStartsAt
        ? await prisma.view.count({
            where: {
  dataroomId: dataroomId,
  OR: [
    { viewType: "DATAROOM_VIEW" },
    { viewType: "DOCUMENT_VIEW", downloadType: { in: ["FOLDER", "BULK"] } },
  ],
  viewedAt: {
    gte: team.pauseStartsAt,
  },
},
          })
        : 0;

      const views = dataroom?.views || [];

      const returnViews = views.map((view) => {
        return {
          ...view,
          dataroomName: dataroom?.name,
          internal: users.some((user) => user.email === view.viewerEmail), // set internal to true if view.viewerEmail is in the users list
        };
      });

      return res.status(200).json({
        views: returnViews,
        hiddenFromPause: hiddenViewsFromPause,
      });
    } catch (error) {
      log({
        message: `Failed to get views for dataroom: _${dataroomId}_. \n\n ${error} \n\n*Metadata*: \`{teamId: ${teamId}, userId: ${userId}}\``,
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
