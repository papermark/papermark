import { NextApiRequest, NextApiResponse } from "next";

import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { getServerSession } from "next-auth";

import { errorhandler } from "@/lib/errorHandler";
import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "DELETE") {
    // DELETE /api/teams/:teamId/datarooms/:id/groups/:groupId/members/:memberId
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      return res.status(401).end("Unauthorized");
    }

    const {
      teamId,
      id: dataroomId,
      groupId,
      memberId,
    } = req.query as {
      teamId: string;
      id: string;
      groupId: string;
      memberId: string;
    };
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
      });

      if (!team) {
        return res.status(401).json("Unauthorized");
      }

      // Confirm the target membership belongs to a group inside THIS team's dataroom.
      const membership = await prisma.viewerGroupMembership.findFirst({
        where: {
          id: memberId,
          group: {
            id: groupId,
            dataroom: {
              id: dataroomId,
              teamId: teamId,
            },
          },
        },
        select: { id: true },
      });

      if (!membership) {
        return res.status(404).json({ error: "Member not found" });
      }

      await prisma.viewerGroupMembership.delete({
        where: { id: membership.id },
      });
      return res.status(204).end();
    } catch (error) {
      errorhandler(error, res);
    }
  } else {
    res.setHeader("Allow", ["DELETE"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
