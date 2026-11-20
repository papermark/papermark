import { NextApiRequest, NextApiResponse } from "next";

import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { getServerSession } from "next-auth/next";

import { getVisitors } from "@/lib/api/visitors/get-visitors";
import { errorhandler } from "@/lib/errorHandler";
import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "GET") {
    // GET /api/teams/:teamId/viewers
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      return res.status(401).end("Unauthorized");
    }

    const { query, page, pageSize, sortBy, sortOrder, status } =
      req.query as {
        query?: string;
        page?: string;
        pageSize?: string;
        sortBy?: string;
        sortOrder?: string;
        status?: string;
      };

    const { teamId } = req.query as { teamId: string };

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
        return res.status(404).json({ error: "Team not found" });
      }

      const { visitors, anonymous, pagination, sorting } = await getVisitors({
        teamId,
        page: parseInt(page || "1", 10),
        pageSize: parseInt(pageSize || "10", 10),
        sortBy,
        sortOrder,
        query,
        status,
      });

      // Per-team data behind auth: never let shared/CDN caches store it, or a
      // cache hit could serve one team's list to another user before the auth
      // check runs. Client-side SWR still handles perceived speed.
      res.setHeader("Cache-Control", "private, no-store");

      return res.status(200).json({
        viewers: visitors,
        anonymous,
        pagination,
        sorting,
      });
    } catch (error) {
      errorhandler(error, res);
    }
  } else {
    // We only allow GET requests
    res.setHeader("Allow", ["GET"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
