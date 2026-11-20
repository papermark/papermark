import type { NextApiRequest, NextApiResponse } from "next";

import {
  DATAROOM_TEMPLATES,
  FolderTemplate,
} from "@/ee/features/templates/constants/dataroom-templates";
import { applyTemplateSchema } from "@/ee/features/templates/schemas/dataroom-templates";
import { authOptions } from "@/lib/auth/auth-options";
import { getServerSession } from "next-auth/next";

import prisma from "@/lib/prisma";
import { safeSlugify } from "@/lib/utils";
import { CustomUser } from "@/lib/types";

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "POST") {
    // POST /api/teams/:teamId/datarooms/:id/apply-template
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      res.status(401).end("Unauthorized");
      return;
    }

    const userId = (session.user as CustomUser).id;
    const { teamId, id: dataroomId } = req.query as {
      teamId: string;
      id: string;
    };

    // Validate request body using Zod schema for SSRF protection
    const validationResult = applyTemplateSchema.safeParse(req.body);

    if (!validationResult.success) {
      return res.status(400).json({
        message: "Invalid template type.",
        errors: validationResult.error.flatten().fieldErrors,
      });
    }

    const { type } = validationResult.data;

    try {
      // Check if the user is part of the team and has access to the dataroom
      const dataroom = await prisma.dataroom.findUnique({
        where: {
          id: dataroomId,
          teamId: teamId,
          team: {
            users: {
              some: {
                userId: userId,
              },
            },
          },
        },
      });

      if (!dataroom) {
        return res.status(401).end("Unauthorized");
      }

      const template = DATAROOM_TEMPLATES[type];

      // Update dataroom name and create folders in a transaction
      await prisma.$transaction(async (tx) => {
        // Update dataroom name to match template
        await tx.dataroom.update({
          where: { id: dataroom.id },
          data: {
            name: `${template.name} Data Room`,
          },
        });

        // Helper function to create folders recursively
        const createFolders = async (
          folders: FolderTemplate[],
          parentPath: string = "",
          parentId: string | null = null,
        ): Promise<void> => {
          for (const folder of folders) {
            const folderPath = parentPath + "/" + safeSlugify(folder.name);

            // Create the folder
            const createdFolder = await tx.dataroomFolder.create({
              data: {
                name: folder.name,
                path: folderPath,
                parentId: parentId,
                dataroomId: dataroom.id,
              },
            });

            // If the folder has subfolders, create them recursively
            if (folder.subfolders && folder.subfolders.length > 0) {
              await createFolders(
                folder.subfolders,
                folderPath,
                createdFolder.id,
              );
            }
          }
        };

        await createFolders(template.folders);
      });

      res.status(200).json({
        message: "Template applied successfully",
      });
    } catch (error) {
      console.error("Error applying template:", error);
      return res.status(500).json({ error: "Error applying template" });
    }
  } else {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
