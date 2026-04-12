import type { NextApiRequest, NextApiResponse } from "next";

import { isTeamPausedById } from "@/ee/features/billing/cancellation/lib/is-team-paused";
import { FolderTemplate } from "@/ee/features/templates/constants/dataroom-templates";
import { getLimits } from "@/ee/limits/server";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { getServerSession } from "next-auth/next";

import { newId } from "@/lib/id-helper";
import { safeSlugify } from "@/lib/utils";
import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "POST") {
    // POST /api/teams/:teamId/datarooms/generate-ai
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      res.status(401).end("Unauthorized");
      return;
    }

    const userId = (session.user as CustomUser).id;
    const { teamId } = req.query as { teamId: string };
    const { name, folders, dataroomId: existingDataroomId } = req.body as {
      name: string;
      folders: FolderTemplate[];
      dataroomId?: string;
    };

    // Validate input
    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return res.status(400).json({
        message: "Dataroom name is required",
      });
    }

    if (name.length > 255) {
      return res.status(400).json({
        message: "Dataroom name is too long",
      });
    }

    if (!Array.isArray(folders) || folders.length === 0) {
      return res.status(400).json({
        message: "Folder structure is required",
      });
    }

    // Validate folder structure (max 2 levels: top-level + 1 subfolder level)
    const validateFolder = (folder: any, depth = 0): boolean => {
      if (depth >= 2) return false; // Max 2 levels deep
      if (!folder.name || typeof folder.name !== "string") return false;
      if (folder.name.length > 255) return false;
      if (folder.subfolders) {
        if (!Array.isArray(folder.subfolders)) return false;
        // Limit subfolders to 5 per folder
        if (folder.subfolders.length > 5) return false;
        return folder.subfolders.every((sub: any) =>
          validateFolder(sub, depth + 1),
        );
      }
      return true;
    };

    // Limit top-level folders to 8
    if (folders.length > 8) {
      return res.status(400).json({
        message: "Too many top-level folders (maximum 8)",
      });
    }

    if (!folders.every((folder) => validateFolder(folder))) {
      return res.status(400).json({
        message: "Invalid folder structure",
      });
    }

    try {
      // Check if the user is part of the team (without plan restriction first)
      const team = await prisma.team.findUnique({
        where: {
          id: teamId,
          users: {
            some: {
              userId: userId,
            },
          },
        },
        select: {
          id: true,
          plan: true,
        },
      });

      if (!team) {
        return res.status(401).end("Unauthorized");
      }

      // Check if team has access to datarooms (allow trial plans, paid plans, and free plan for onboarding)
      const allowedPlans = [
        "business",
        "datarooms",
        "datarooms-plus",
        "datarooms-premium",
        "datarooms-unlimited",
        "business+old",
        "datarooms+old",
        "datarooms-plus+old",
        "datarooms-premium+old",
        "datarooms-unlimited+old",
        "datarooms+drtrial",
        "business+drtrial",
        "datarooms-plus+drtrial",
        "datarooms-premium+drtrial",
        "datarooms-unlimited+drtrial",
        "free+drtrial",
      ];

      // Allow free plan (for onboarding) or any plan that includes allowed plans or drtrial
      const hasAccess =
        team.plan === "free" || // Allow free plan during onboarding
        team.plan.includes("drtrial") || // Allow any trial plan
        allowedPlans.some((plan) => team.plan.includes(plan));

      if (!hasAccess) {
        return res.status(403).json({
          message:
            "This feature requires a datarooms plan. Please upgrade to access AI-generated data rooms.",
        });
      }

      // Check if team is paused
      const teamIsPaused = await isTeamPausedById(teamId);
      if (teamIsPaused) {
        return res.status(403).json({
          error:
            "Team is currently paused. New dataroom creation is not available.",
        });
      }

      // Skip limit check when populating an existing dataroom
      if (!existingDataroomId) {
        // Limits: Check if the user has reached the limit of datarooms in the team
        const dataroomCount = await prisma.dataroom.count({
          where: {
            teamId: teamId,
          },
        });

        const limits = await getLimits({ teamId, userId });

        // Allow first dataroom creation on free plan during onboarding
        const isFreePlan = team.plan === "free" || team.plan === "free+drtrial";
        const isFirstDataroom = dataroomCount === 0;

        if (
          limits &&
          limits.datarooms !== null &&
          !(isFreePlan && isFirstDataroom) &&
          dataroomCount >= limits.datarooms
        ) {
          return res
            .status(403)
            .json({ message: "You have reached the limit of datarooms" });
        }
      }

      const dataroomName = name.trim();

      // Create the dataroom and folders in a transaction to prevent hanging results
      const dataroom = await prisma.$transaction(async (tx) => {
        let createdDataroom;

        if (existingDataroomId) {
          // Use existing dataroom (e.g. created during trial onboarding)
          const existing = await tx.dataroom.findUnique({
            where: { id: existingDataroomId, teamId },
          });

          if (!existing) {
            throw new Error("Dataroom not found");
          }

          // Remove any existing folders so a retry doesn't hit unique-path conflicts
          await tx.dataroomFolder.deleteMany({
            where: { dataroomId: existingDataroomId },
          });

          createdDataroom = await tx.dataroom.update({
            where: { id: existingDataroomId },
            data: { name: dataroomName },
          });
        } else {
          const pId = newId("dataroom");
          createdDataroom = await tx.dataroom.create({
            data: {
              name: dataroomName,
              teamId: teamId,
              pId: pId,
            },
          });
        }

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
                dataroomId: createdDataroom.id,
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

        await createFolders(folders);

        return createdDataroom;
      });

      const dataroomWithCount = {
        ...dataroom,
        _count: { documents: 0 },
      };

      res.status(201).json({
        dataroom: dataroomWithCount,
        message: "Dataroom generated successfully with AI",
      });
    } catch (error) {
      console.error("Error generating dataroom with AI:", error);
      return res.status(500).json({ error: "Error generating dataroom" });
    }
  } else {
    // We only allow POST requests
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
