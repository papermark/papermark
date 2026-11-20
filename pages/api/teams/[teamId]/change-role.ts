import { NextApiRequest, NextApiResponse } from "next";

import { getServerSession } from "next-auth";

import { errorhandler } from "@/lib/errorHandler";
import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";

import { authOptions } from "../../auth/[...nextauth]";

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "PUT") {
    // DELETE /api/teams/:teamId/change-role
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      return res.status(401).end("Unauthorized");
    }

    const { teamId } = req.query as { teamId: string };
    const userId = (session.user as CustomUser).id;

    const {
      userToBeChanged,
      role,
      dataroomIds: rawDataroomIds,
    } = req.body as {
      userToBeChanged: string;
      role: "MEMBER" | "MANAGER" | "ADMIN" | "DATAROOM_MEMBER";
      dataroomIds?: string[];
    };

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

      // Only ADMINs can change roles
      if (role === "ADMIN" && userTeam.role !== "ADMIN") {
        return res.status(403).json("Only admins can change user roles");
      }

      // Managing the dataroom-scoped role (and its room assignments) is an
      // ADMIN/MANAGER-only operation.
      if (
        role === "DATAROOM_MEMBER" &&
        userTeam.role !== "ADMIN" &&
        userTeam.role !== "MANAGER"
      ) {
        return res
          .status(403)
          .json("Only admins and managers can manage data room members");
      }

      if (userTeam?.role === "ADMIN" && userTeam.userId === userToBeChanged) {
        return res.status(401).json("You can't change the Admin");
      }

      const dataroomIds =
        role === "DATAROOM_MEMBER" && Array.isArray(rawDataroomIds)
          ? Array.from(
              new Set(rawDataroomIds.filter((id) => typeof id === "string")),
            )
          : [];

      if (role === "DATAROOM_MEMBER" && dataroomIds.length === 0) {
        return res
          .status(400)
          .json("Select at least one data room for a data room member.");
      }

      if (dataroomIds.length > 0) {
        const validDatarooms = await prisma.dataroom.findMany({
          where: { id: { in: dataroomIds }, teamId },
          select: { id: true },
        });
        if (validDatarooms.length !== dataroomIds.length) {
          return res.status(400).json("One or more data rooms are invalid.");
        }
      }

      await prisma.$transaction(async (tx) => {
        await tx.userTeam.update({
          where: {
            userId_teamId: {
              userId: userToBeChanged,
              teamId,
            },
          },
          data: {
            role,
          },
        });

        if (role === "DATAROOM_MEMBER") {
          // Replace the member's room assignments with the provided set.
          await tx.userDataroom.deleteMany({
            where: { userId: userToBeChanged, teamId },
          });
          await tx.userDataroom.createMany({
            data: dataroomIds.map((dataroomId) => ({
              userId: userToBeChanged,
              teamId,
              dataroomId,
            })),
            skipDuplicates: true,
          });
        } else {
          // Promoting away from the scoped role clears any assignments.
          await tx.userDataroom.deleteMany({
            where: { userId: userToBeChanged, teamId },
          });
        }
      });

      return res.status(204).end();
    } catch (error) {
      errorhandler(error, res);
    }
  } else {
    res.setHeader("Allow", ["PUT"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
