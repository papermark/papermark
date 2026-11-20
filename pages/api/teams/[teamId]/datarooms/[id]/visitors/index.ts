import { NextApiRequest, NextApiResponse } from "next";

import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { getServerSession } from "next-auth/next";

import { enforceDataroomMemberScope } from "@/lib/api/rbac/guard";
import { getVisitors } from "@/lib/api/visitors/get-visitors";
import { errorhandler } from "@/lib/errorHandler";
import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";
import { log } from "@/lib/utils";

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "GET") {
    // GET /api/teams/:teamId/datarooms/:id/visitors
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      return res.status(401).end("Unauthorized");
    }

    const {
      teamId,
      id: dataroomId,
      query,
      page,
      pageSize,
      sortBy,
      sortOrder,
      status,
    } = req.query as {
      teamId: string;
      id: string;
      query?: string;
      page?: string;
      pageSize?: string;
      sortBy?: string;
      sortOrder?: string;
      status?: string;
    };
    const userId = (session.user as CustomUser).id;

    // Scoped members may only read visitors for their assigned rooms.
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
        select: { id: true, pauseStartsAt: true },
      });

      if (!team) {
        return res.status(403).end("Unauthorized to access this team");
      }

      const dataroom = await prisma.dataroom.findUnique({
        where: { id: dataroomId, teamId: teamId },
        select: { id: true, name: true },
      });

      if (!dataroom) {
        return res.status(404).json({ error: "Dataroom not found" });
      }

      const { visitors, anonymous, pagination, sorting } = await getVisitors({
        teamId,
        dataroomId,
        page: parseInt(page || "1", 10),
        pageSize: parseInt(pageSize || "10", 10),
        sortBy,
        sortOrder,
        query,
        status,
        pauseStartsAt: team.pauseStartsAt,
      });

      const viewerIds = visitors
        .map((visitor) => visitor.id)
        .filter((id): id is string => !!id);

      // Dataroom sessions for the current page of visitors, used only to name
      // the links each person actually came through.
      const views = viewerIds.length
        ? await prisma.view.findMany({
            where: {
              dataroomId: dataroomId,
              viewerId: { in: viewerIds },
              viewType: "DATAROOM_VIEW",
              isArchived: false,
              ...(team.pauseStartsAt && {
                viewedAt: { lt: team.pauseStartsAt },
              }),
            },
            orderBy: { viewedAt: "desc" },
            select: {
              viewerId: true,
              viewedAt: true,
              link: { select: { id: true, name: true } },
            },
          })
        : [];

      const viewsByViewer = new Map<string, typeof views>();
      views.forEach((view) => {
        if (!view.viewerId) return;
        const existing = viewsByViewer.get(view.viewerId);
        if (existing) {
          existing.push(view);
        } else {
          viewsByViewer.set(view.viewerId, [view]);
        }
      });

      const formattedVisitors = visitors.map((visitor) => {
        const visitorViews = visitor.id
          ? (viewsByViewer.get(visitor.id) ?? [])
          : [];

        // Links the person actually came through, most recent first; people who
        // have not visited fall back to the link that granted or invited them.
        const accessedLinks = Array.from(
          new Set(
            visitorViews.map(
              (view) =>
                view.link?.name ||
                (view.link?.id ? `Link #${view.link.id.slice(-5)}` : "a link"),
            ),
          ),
        );
        const namesFor = (types: string[]) =>
          Array.from(
            new Set(
              visitor.accessSources
                .filter((source) => types.includes(source.type))
                .map((source) => source.name),
            ),
          );

        const blockedLinks = namesFor(["DENY_LIST"]);
        const grantedLinks = namesFor(["ALLOW_LIST", "INVITATION"]);

        // People who have not visited fall back to the link that granted,
        // invited, or blocked them.
        let linkNames = accessedLinks;
        if (!linkNames.length) {
          linkNames =
            visitor.status === "BLOCKED" ? blockedLinks : grantedLinks;
        }

        return {
          ...visitor,
          dataroomName: dataroom.name,
          linkNames,
          hasVisitedLinks: accessedLinks.length > 0,
        };
      });

      return res.status(200).json({
        visitors: formattedVisitors,
        anonymous,
        pagination,
        sorting,
      });
    } catch (error) {
      log({
        message: `Failed to get visitors for dataroom: _${dataroomId}_. \n\n ${error} \n\n*Metadata*: \`{teamId: ${teamId}, userId: ${userId}}\``,
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
