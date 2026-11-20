import { NextApiRequest, NextApiResponse } from "next";

import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { getServerSession } from "next-auth/next";

import { enforceDataroomMemberScope } from "@/lib/api/rbac/guard";
import { errorhandler } from "@/lib/errorHandler";
import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "DELETE") {
    // DELETE /api/teams/:teamId/datarooms/[:id]/folders/manage
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const {
      teamId,
      id: dataroomId,
      folderId,
    } = req.query as {
      teamId: string;
      id: string;
      folderId: string;
    };

    const userId = (session.user as CustomUser).id;

    // Scoped members may only manage folders within their assigned rooms.
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

      const folder = await prisma.dataroomFolder.findUnique({
        where: {
          id: folderId,
          dataroomId: dataroomId,
        },
      });

      if (!folder) {
        return res.status(404).json({
          message: "Folder not found",
        });
      }

      // Delete the folder and its contents recursively
      await deleteFolderAndContents(folderId);

      return res.status(204).end(); // 204 No Content response for successful deletes
    } catch (error) {
      errorhandler(error, res);
    }
  } else {
    // We only allow DELETE requests
    res.setHeader("Allow", ["DELETE"]);
    return res
      .status(405)
      .json({ message: `Method ${req.method} Not Allowed` });
  }
}

async function deleteFolderAndContents(folderId: string) {
  const childFoldersToDelete = await prisma.dataroomFolder.findMany({
    where: {
      parentId: folderId,
    },
  });

  console.log("Deleting folder and contents", childFoldersToDelete);

  for (const folder of childFoldersToDelete) {
    await deleteFolderAndContents(folder.id);
  }

  await prisma.dataroomDocument.deleteMany({
    where: {
      folderId: folderId,
    },
  });

  await prisma.dataroomFolder.delete({
    where: {
      id: folderId,
    },
  });
}
