import { NextApiRequest, NextApiResponse } from "next";

import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { getServerSession } from "next-auth/next";

import { enforceDataroomMemberScope } from "@/lib/api/rbac/guard";
import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).end("Unauthorized");
  }

  const { teamId, id } = req.query as {
    teamId: string;
    id: string;
  };
  const groupId = req.query.groupId as string | undefined;
  const userId = (session.user as CustomUser).id;

  // Scoped members may only read counts for their assigned rooms.
  if (
    await enforceDataroomMemberScope({ userId, teamId, dataroomId: id, res })
  ) {
    return;
  }

  if (req.method === "GET") {
    try {
      // Verify user has access to the dataroom
      const dataroom = await prisma.dataroom.findFirst({
        where: {
          id: id,
          teamId: teamId,
          team: {
            users: {
              some: {
                userId: userId,
              },
            },
          },
        },
        select: {
          id: true,
        },
      });

      if (!dataroom) {
        return res.status(404).json({ error: "Dataroom not found" });
      }

      // Build the where clause for views
      const whereClause = {
        dataroomId: id,
        ...(groupId && { groupId }),
      };

      const viewCount = await prisma.view.count({
        where: whereClause,
      });

      return res.status(200).json({ count: viewCount });
    } catch (error) {
      console.error("Error fetching view count:", error);
      return res.status(500).json({ error: "Failed to fetch view count" });
    }
  }

  res.setHeader("Allow", ["GET"]);
  return res.status(405).end(`Method ${req.method} Not Allowed`);
}
