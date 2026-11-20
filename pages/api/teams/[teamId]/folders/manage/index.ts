import { NextApiRequest, NextApiResponse } from "next";

import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { getServerSession } from "next-auth/next";

import {
  ALLOWED_FOLDER_COLORS,
  ALLOWED_FOLDER_ICONS,
} from "@/lib/constants/folder-constants";
import { safeSlugify } from "@/lib/utils";
import { errorhandler } from "@/lib/errorHandler";
import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "PUT") {
    // PUT /api/teams/:teamId/folders/manage
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      res.status(401).end("Unauthorized");
      return;
    }
    const userId = (session.user as CustomUser).id;
    const { teamId } = req.query as { teamId: string };
    const { folderId, name, icon, color } = req.body as {
      folderId: string;
      name: string;
      icon?: string | null;
      color?: string | null;
    };

    try {
      // Validate icon if provided
      if (icon !== undefined && icon !== null && !ALLOWED_FOLDER_ICONS.includes(icon as any)) {
        return res.status(400).json({ message: "Invalid folder icon" });
      }

      // Validate color if provided
      if (color !== undefined && color !== null && !ALLOWED_FOLDER_COLORS.includes(color as any)) {
        return res.status(400).json({ message: "Invalid folder color" });
      }

      // Validate name
      if (!name || name.trim().length === 0) {
        return res.status(400).json({ message: "Folder name is required" });
      }

      if (name.trim().length > 256) {
        return res.status(400).json({ message: "Folder name must be 256 characters or less" });
      }

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
        return res.status(401).end("Unauthorized");
      }

      const folder = await prisma.folder.findFirst({
        where: {
          id: folderId,
          teamId,
        },
        select: {
          id: true,
          name: true,
          path: true,
          icon: true,
          color: true,
        },
      });

      if (!folder) {
        return res.status(404).json({ message: "Folder not found" });
      }

      // take the old path and replace the last part with the new name
      const oldPath = folder.path;
      const newPathParts = folder.path.split("/");
      newPathParts.pop();
      newPathParts.push(safeSlugify(name.trim()));
      const newPath = newPathParts.join("/");

      // Build update data object with only changed fields
      const updateData: {
        name: string;
        path: string;
        icon?: string | null;
        color?: string | null;
      } = {
        name: name.trim(),
        path: newPath,
      };

      // Only include icon and color in update if they were provided
      if (icon !== undefined) {
        updateData.icon = icon;
      }
      if (color !== undefined) {
        updateData.color = color;
      }

      // Use a transaction to update descendant paths and the folder atomically
      const updatedFolder = await prisma.$transaction(async (tx) => {
        // If the path is changing, we need to update all descendant folder paths
        if (oldPath !== newPath) {
          // Fetch all descendant folders whose path starts with the old path
          const descendantFolders = await tx.folder.findMany({
            where: {
              teamId: teamId,
              path: { startsWith: `${oldPath}/` },
            },
            select: {
              id: true,
              path: true,
            },
          });

          // Update all descendant paths by replacing the old prefix with the new one
          // Update descendants first to avoid unique constraint violations
          if (descendantFolders.length > 0) {
            const descendantUpdates = descendantFolders.map((descendant) => {
              // Replace the old path prefix with the new path
              const relativePath = descendant.path.slice(oldPath.length);
              const newDescendantPath = `${newPath}${relativePath}`;

              return tx.folder.update({
                where: { id: descendant.id },
                data: { path: newDescendantPath },
              });
            });

            await Promise.all(descendantUpdates);
          }
        }

        // Now update the renamed folder itself
        return tx.folder.update({
          where: {
            id: folder.id,
          },
          data: updateData,
        });
      });

      // Get parent folder path for cache invalidation
      const parentFolderPath = folder.path.substring(
        0,
        folder.path.lastIndexOf("/"),
      );

      return res.status(200).json({
        message: "Folder updated successfully",
        parentFolderPath: parentFolderPath || "/",
        folder: updatedFolder,
      });
    } catch (error) {
      errorhandler(error, res);
    }
  } else {
    // We only allow PUT requests
    res.setHeader("Allow", ["PUT"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
