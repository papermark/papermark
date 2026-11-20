import { NextApiRequest, NextApiResponse } from "next";

import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { getServerSession } from "next-auth/next";

import { errorhandler } from "@/lib/errorHandler";
import { deleteFile } from "@/lib/files/delete-file-server";
import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "DELETE") {
    // DELETE /api/teams/:teamId/folders/manage/:folderId
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const { teamId, folderId } = req.query as {
      teamId: string;
      folderId: string;
    };

    const userId = (session.user as CustomUser).id;

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

      if (teamAccess.role !== "ADMIN" && teamAccess.role !== "MANAGER") {
        return res.status(403).json({
          message:
            "You are not permitted to perform this action. Only admin and managers can delete folders.",
        });
      }

      const folder = await prisma.folder.findFirst({
        where: {
          id: folderId,
          teamId,
        },
        select: {
          id: true,
        },
      });

      if (!folder) {
        return res.status(404).json({
          message: "Folder not found",
        });
      }

      await deleteFolderAndContents(folder.id, teamId);

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

async function deleteFolderAndContents(folderId: string, teamId: string) {
  const childFoldersToDelete = await prisma.folder.findMany({
    where: {
      parentId: folderId,
      teamId,
    },
    select: {
      id: true,
    },
  });

  for (const childFolder of childFoldersToDelete) {
    await deleteFolderAndContents(childFolder.id, teamId);
  }

  // Delete all documents in the folder. Notion and web-link documents store an
  // external URL rather than a real storage object, so they're excluded from
  // the storage cleanup below (deleteFile would fail on their URL).
  const documents = await prisma.document.findMany({
    where: {
      folderId: folderId,
      teamId,
      type: {
        notIn: ["notion", "link"],
      },
    },
    include: {
      versions: {
        select: {
          id: true,
          file: true,
          type: true,
          storageType: true,
        },
      },
    },
  });

  for (const documentVersions of documents) {
    for (const version of documentVersions.versions) {
      await deleteFile({
        type: version.storageType,
        data: version.file,
        teamId,
      });
    }
  }

  await prisma.document.deleteMany({
    where: {
      folderId: folderId,
      teamId,
    },
  });

  await prisma.folder.deleteMany({
    where: {
      id: folderId,
      teamId,
    },
  });
}
