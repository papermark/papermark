import type { NextApiRequest, NextApiResponse } from "next";

import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { getServerSession } from "next-auth/next";

import { getFeatureFlags } from "@/lib/featureFlags";
import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";
import { calculateAndUpdateHierarchicalIndexes } from "@/lib/utils/calculate-hierarchical-indexes";

export const config = {
  maxDuration: 300,
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).end("Unauthorized");
  }

  const { teamId, id: dataroomId } = req.query as {
    teamId: string;
    id: string;
  };
  const userId = (session.user as CustomUser).id;

  if (!dataroomId || typeof dataroomId !== "string") {
    return res.status(400).json({ message: "Invalid dataroom ID" });
  }

  if (!teamId || typeof teamId !== "string") {
    return res.status(400).json({ message: "Invalid team ID" });
  }

  try {
    // Verify user has access to this dataroom and get team plan
    const dataroom = await prisma.dataroom.findUnique({
      where: {
        id: dataroomId,
        teamId,
        team: {
          users: {
            some: {
              userId: userId,
            },
          },
        },
      },
      select: {
        id: true,
        name: true,
        team: {
          select: {
            plan: true,
          },
        },
      },
    });

    if (!dataroom) {
      return res.status(404).json({ message: "Dataroom not found" });
    }

    // Check if user has access: feature flag enabled OR datarooms-plus plan
    const featureFlags = await getFeatureFlags({ teamId });
    const hasDataroomsPlusPlan =
      dataroom.team.plan === "datarooms-plus" ||
      dataroom.team.plan === "datarooms-plus+old" ||
      dataroom.team.plan === "datarooms-premium" ||
      dataroom.team.plan === "datarooms-premium+old" ||
      dataroom.team.plan === "datarooms-unlimited" ||
      dataroom.team.plan === "datarooms-unlimited+old";

    if (!featureFlags.dataroomIndex && !hasDataroomsPlusPlan) {
      return res.status(403).json({
        message: "This feature requires a Data Rooms Plus plan",
      });
    }

    // Calculate and update hierarchical indexes
    const result = await calculateAndUpdateHierarchicalIndexes(dataroomId);

    res.status(200).json({
      message: "Hierarchical indexes calculated successfully",
      foldersUpdated: result.foldersUpdated,
      documentsUpdated: result.documentsUpdated,
      totalUpdated: result.foldersUpdated + result.documentsUpdated,
    });
  } catch (error) {
    console.error("Error calculating hierarchical indexes:", error);
    res.status(500).json({
      message: "Error calculating hierarchical indexes",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
