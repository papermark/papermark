import { NextApiRequest, NextApiResponse } from "next";

import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { getServerSession } from "next-auth/next";

import { enforceDataroomMemberScope } from "@/lib/api/rbac/guard";
import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "PATCH") {
    // PATCH /api/teams/:teamId/datarooms/:id/documents/:documentId
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const userId = (session.user as CustomUser).id;
    const {
      teamId,
      id: dataroomId,
      documentId,
    } = req.query as { teamId: string; id: string; documentId: string };
    const { folderId, currentPathName } = req.body as {
      folderId: string;
      currentPathName: string;
    };

    // Scoped members may only manage documents within their assigned rooms.
    if (
      await enforceDataroomMemberScope({ userId, teamId, dataroomId, res })
    ) {
      return;
    }

    try {
      // Check if the user is part of the team
      const team = await prisma.team.findUnique({
        where: {
          id: teamId,
          users: {
            some: {
              userId: userId,
            },
          },
        },
      });

      if (!team) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const document = await prisma.dataroomDocument.update({
        where: {
          id: documentId,
          dataroomId: dataroomId,
        },
        data: {
          folderId: folderId,
        },
        select: {
          folder: {
            select: {
              path: true,
            },
          },
        },
      });

      if (!document) {
        return res.status(404).json({ message: "Document not found" });
      }

      return res.status(200).json({
        message: "Document moved successfully",
        newPath: document.folder?.path,
        oldPath: currentPathName,
      });
    } catch (error) {}
  } else if (req.method === "DELETE") {
    /// DELETE /api/teams/:teamId/datarooms/:id/documents/:documentId
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const userId = (session.user as CustomUser).id;
    const {
      teamId,
      id: dataroomId,
      documentId,
    } = req.query as { teamId: string; id: string; documentId: string };

    // Scoped members may only manage documents within their assigned rooms.
    if (
      await enforceDataroomMemberScope({ userId, teamId, dataroomId, res })
    ) {
      return;
    }

    try {
      const teamAccess = await prisma.userTeam.findUnique({
        where: {
          userId_teamId: {
            userId: userId,
            teamId: teamId,
          },
        },
        select: {
          role: true,
        },
      });
      if (!teamAccess) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const dataroom = await prisma.dataroom.findUnique({
        where: {
          id: dataroomId,
          teamId,
        },
      });

      if (!dataroom) {
        return res.status(404).json({ message: "Dataroom not found" });
      }

      const document = await prisma.dataroomDocument.delete({
        where: {
          id: documentId,
          dataroomId: dataroomId,
        },
      });

      if (!document) {
        return res.status(404).json({ message: "Document not found" });
      }

      return res.status(204).end(); // No Content
    } catch (error) {}
  } else {
    // We only allow PATCH and DELETE requests
    res.setHeader("Allow", ["PATCH", "DELETE"]);
    return res
      .status(405)
      .json({ message: `Method ${req.method} Not Allowed` });
  }
}
