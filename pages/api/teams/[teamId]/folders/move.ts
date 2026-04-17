import { NextApiRequest, NextApiResponse } from "next";

import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { safeSlugify } from "@/lib/utils";
import { getServerSession } from "next-auth/next";

import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "PATCH") {
    // PATCH /api/teams/:teamId/folders/move
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      res.status(401).end("Unauthorized");
      return;
    }
    const userId = (session.user as CustomUser).id;
    const { teamId } = req.query as { teamId: string };
    const { folderIds, selectedFolder, selectedFolderPath } = req.body as {
      folderIds: string[];
      selectedFolder: string | null;
      selectedFolderPath: string;
    };

    // Ensure the user is an admin of the team
    const teamAccess = await prisma.userTeam.findUnique({
      where: {
        userId_teamId: {
          userId: userId,
          teamId: teamId,
        },
      },
    });

    if (!teamAccess) {
      return res.status(403).end("Forbidden");
    }

    try {
      let updatedFolders: any[] = [];
      await prisma.$transaction(async (prisma) => {
        const foldersToMove = await prisma.folder.findMany({
          where: {
            id: { in: folderIds },
            teamId,
          },
        });

        // Prevent moving a folder into itself or one of its descendants.
        if (selectedFolder) {
          const allFolders = await prisma.folder.findMany({
            where: { teamId },
            select: { id: true, parentId: true },
          });
          const parentMap = new Map(
            allFolders.map((f) => [f.id, f.parentId]),
          );
          const folderIdSet = new Set(folderIds);
          const visited = new Set<string>();
          let currentId: string | null = selectedFolder;
          while (currentId) {
            if (folderIdSet.has(currentId)) {
              throw new Error("MOVE_INVALID_PARENT");
            }
            if (visited.has(currentId)) break;
            visited.add(currentId);
            currentId = parentMap.get(currentId) ?? null;
          }
        }

        const existingFolders = await prisma.folder.findMany({
          where: {
            teamId,
            parentId: selectedFolder, // Check only inside the target folder can be null
          },
          select: { name: true },
        });
        if (existingFolders.length > 0) {
          const existingFolderNames = new Set(
            existingFolders.map((f) => f.name),
          );
          const duplicateNames = foldersToMove
            .map((folder) => folder.name)
            .filter((name) => existingFolderNames.has(name));

          if (duplicateNames.length > 0) {
            throw new Error(
              `MOVE_DUPLICATE_NAMES:${duplicateNames.join(", ")}`,
            );
          }
        }
        // Fetch all nested subfolders of the selected folders (excluding the folders themselves)
        const allSubfolders = await prisma.folder.findMany({
          where: {
            teamId,
            OR: foldersToMove.map((folder) => ({
              path: { startsWith: `${folder.path}/` },
            })),
          },
        });
        const folderPathUpdates = new Map();
        // Generate new paths for the folders being moved
        foldersToMove.forEach((folder) => {
          const newPath =
            selectedFolderPath !== "/"
              ? `${selectedFolderPath}/${safeSlugify(folder.name)}`
              : `/${safeSlugify(folder.name)}`;

          folderPathUpdates.set(folder.id, newPath);
        });

        // Update all subfolder paths dynamically
        const updates = allSubfolders.map((subfolder) => {
          // Find the parent folder it belongs to
          const parentFolder = foldersToMove.find((folder) =>
            subfolder.path.startsWith(folder.path),
          );

          if (!parentFolder) return null;

          // Get the new base path for the parent
          const newParentPath = folderPathUpdates.get(parentFolder.id);

          // Calculate the new subfolder path by replacing the old path with the new one
          const relativePath = subfolder.path
            .replace(parentFolder.path, "")
            .trim();
          const newSubfolderPath = `${newParentPath}${relativePath}`;

          return prisma.folder.update({
            where: { id: subfolder.id, teamId },
            data: { path: newSubfolderPath },
          });
        });

        // Update each folder individually with its new path
        const updateMainFolders = folderIds.map((folderId) =>
          prisma.folder.update({
            where: {
              id: folderId,
              teamId,
            },
            data: {
              parentId: selectedFolder,
              path: folderPathUpdates.get(folderId),
            },
          }),
        );

        await Promise.all(updates);
        updatedFolders = await Promise.all(updateMainFolders);

        // Get new path for folder unless selectedFolder is null
      });
      if (updatedFolders.length === 0) {
        return res.status(404).end("No Folder were updated");
      }

      let folder: { path: string } | null = null;
      if (selectedFolder) {
        folder = await prisma.folder.findUnique({
          where: { id: selectedFolder, teamId },
          select: { path: true },
        });
      }

      return res.status(200).json({
        message: "Folder moved successfully",
        updatedCount: updatedFolders.length,
        newPath: folder?.path,
      });
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === "MOVE_INVALID_PARENT") {
          return res.status(400).json({
            message:
              "Cannot move a folder into itself or one of its subfolders",
          });
        }
        if (error.message.startsWith("MOVE_DUPLICATE_NAMES:")) {
          const names = error.message.slice("MOVE_DUPLICATE_NAMES:".length);
          return res.status(409).json({
            message: `Cannot move folders: Duplicate names found inside target folder - ${names}`,
          });
        }
      }
      console.error(error);
      return res.status(500).end("Failed to move folder");
    }
  } else {
    // We only allow PATCH requests
    res.setHeader("Allow", ["PATCH"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
