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
  if (req.method === "GET") {
    // GET /api/teams/:teamId/invitations
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      return res.status(401).end("Unauthorized");
    }

    const { teamId } = req.query as { teamId: string };

    try {
      // check if currentUser is part of the team with the teamId
      const userTeam = await prisma.userTeam.findUnique({
        where: {
          userId_teamId: {
            userId: (session.user as CustomUser).id,
            teamId,
          },
        },
      });

      if (!userTeam) {
        return res.status(403).json("You are not part of this team");
      }

      // get current invitations for the team
      const invitations = await prisma.invitation.findMany({
        where: {
          teamId: teamId,
        },
        select: {
          email: true,
          expires: true,
        },
      });

      if (!invitations) {
        return res.status(404).json("No invitations found for this team");
      }

      res.status(200).json(invitations);
      return;
    } catch (error) {
      errorhandler(error, res);
    }
  } else if (req.method === "DELETE") {
    // DELETE /api/teams/:teamId/invitations
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      return res.status(401).end("Unauthorized");
    }

    const { teamId } = req.query as { teamId: string };

    const { email } = req.body as { email: string };

    try {
      // check if currentUser is part of the team with the teamId
      const userTeam = await prisma.userTeam.findUnique({
        where: {
          userId_teamId: {
            userId: (session.user as CustomUser).id,
            teamId,
          },
        },
      });

      if (!userTeam) {
        return res.status(403).json("You are not part of this team");
      }

      if (userTeam.role !== "ADMIN") {
        return res.status(403).json("Only admins can revoke invitations");
      }

      // delete invitation
      await prisma.invitation.delete({
        where: {
          email_teamId: {
            teamId: teamId,
            email: email,
          },
        },
      });

      res.status(204).end();
      return;
    } catch (error) {
      errorhandler(error, res);
    }
  }
}
