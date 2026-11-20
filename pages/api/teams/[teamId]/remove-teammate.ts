import { NextApiRequest, NextApiResponse } from "next";

import { getServerSession } from "next-auth";

import { revokeUserBoundTeamTokens } from "@/lib/api/auth/restricted-tokens";
import { errorhandler } from "@/lib/errorHandler";
import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";

import { authOptions } from "../../auth/[...nextauth]";

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "DELETE") {
    // DELETE /api/teams/:teamId/remove-teammate
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      return res.status(401).end("Unauthorized");
    }

    const { teamId } = req.query as { teamId: string };
    const userId = (session.user as CustomUser).id;

    const { userToBeDeleted } = req.body;

    try {
      const userTeam = await prisma.userTeam.findUnique({
        where: {
          userId_teamId: {
            userId,
            teamId,
          },
        },
      });

      if (!userTeam) {
        return res.status(401).json("Unauthorized");
      }

      const isSelfRemoval = userTeam.userId === userToBeDeleted;

      if (!isSelfRemoval && userTeam.role !== "ADMIN") {
        return res.status(403).json("Only admins can remove teammates");
      }

      if (isSelfRemoval && userTeam.role === "ADMIN") {
        const adminCount = await prisma.userTeam.count({
          where: {
            teamId,
            role: "ADMIN",
          },
        });

        if (adminCount <= 1) {
          return res.status(403).json("You can't remove the last admin");
        }
      }

      await Promise.all([
        // update all documents owned by the user to be deleted to be owned by the team
        prisma.document.updateMany({
          where: {
            teamId,
            ownerId: userToBeDeleted,
          },
          data: {
            ownerId: null,
          },
        }),
        // update all links owned by the user to have no owner
        prisma.link.updateMany({
          where: {
            teamId,
            ownerId: userToBeDeleted,
          },
          data: {
            ownerId: null,
          },
        }),
        revokeUserBoundTeamTokens(userToBeDeleted, teamId),
        // remove any dataroom-scoped assignments for this user in this team
        // (UserDataroom has no FK to UserTeam, so it isn't covered by cascade)
        prisma.userDataroom.deleteMany({
          where: {
            userId: userToBeDeleted,
            teamId,
          },
        }),
        // delete the user from the team
        prisma.userTeam.delete({
          where: {
            userId_teamId: {
              userId: userToBeDeleted,
              teamId,
            },
          },
        }),
      ]);

      return res.status(204).end();
    } catch (error) {
      errorhandler(error, res);
    }
  } else {
    res.setHeader("Allow", ["DELETE"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
