import { NextApiRequest, NextApiResponse } from "next";

import { isTeamPausedById } from "@/ee/features/billing/cancellation/lib/is-team-paused";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { getServerSession } from "next-auth/next";

import { errorhandler } from "@/lib/errorHandler";
import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";
import { log } from "@/lib/utils";

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  // POST /api/teams/:teamId/datarooms/:id/groups/:groupId/duplicate
  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).end("Unauthorized");
  }

  const {
    teamId,
    id: dataroomId,
    groupId,
  } = req.query as {
    teamId: string;
    id: string;
    groupId: string;
  };
  const userId = (session.user as CustomUser).id;

  try {
    const teamAccess = await prisma.userTeam.findUnique({
      where: {
        userId_teamId: { userId, teamId },
      },
    });

    if (!teamAccess) {
      return res.status(403).end("Unauthorized to access this team");
    }

    const teamIsPaused = await isTeamPausedById(teamId);
    if (teamIsPaused) {
      return res.status(403).json({
        error: "Team is currently paused. Duplicating groups is not available.",
      });
    }

    const sourceGroup = await prisma.viewerGroup.findUnique({
      where: {
        id: groupId,
        dataroomId,
        teamId,
      },
      include: {
        accessControls: {
          select: {
            itemId: true,
            itemType: true,
            canView: true,
            canDownload: true,
          },
        },
        members: {
          select: {
            viewerId: true,
          },
        },
      },
    });

    if (!sourceGroup) {
      return res.status(404).json({ message: "Group not found" });
    }

    // Find a non-conflicting copy name
    const baseName = `${sourceGroup.name} (Copy)`;
    let candidateName = baseName;
    let counter = 1;
    const MAX_RETRIES = 50;

    while (counter <= MAX_RETRIES) {
      const existing = await prisma.viewerGroup.findFirst({
        where: { dataroomId, name: candidateName },
        select: { id: true },
      });
      if (!existing) break;
      counter += 1;
      candidateName = `${baseName} (${counter})`;
    }

    if (counter > MAX_RETRIES) {
      return res.status(400).json({
        message:
          "Could not duplicate group: too many duplicates with similar names.",
      });
    }

    const duplicatedGroup = await prisma.$transaction(async (tx) => {
      const newGroup = await tx.viewerGroup.create({
        data: {
          name: candidateName,
          dataroomId,
          teamId,
          allowAll: sourceGroup.allowAll,
          domains: sourceGroup.domains,
        },
      });

      if (sourceGroup.accessControls.length > 0) {
        await tx.viewerGroupAccessControls.createMany({
          data: sourceGroup.accessControls.map((ac) => ({
            groupId: newGroup.id,
            itemId: ac.itemId,
            itemType: ac.itemType,
            canView: ac.canView,
            canDownload: ac.canDownload,
          })),
          skipDuplicates: true,
        });
      }

      if (sourceGroup.members.length > 0) {
        await tx.viewerGroupMembership.createMany({
          data: sourceGroup.members.map((member) => ({
            groupId: newGroup.id,
            viewerId: member.viewerId,
          })),
          skipDuplicates: true,
        });
      }

      return newGroup;
    });

    return res.status(201).json(duplicatedGroup);
  } catch (error) {
    log({
      message: `Failed to duplicate group: _${groupId}_ in dataroom _${dataroomId}_. \n\n ${error} \n\n*Metadata*: \`{teamId: ${teamId}, userId: ${userId}}\``,
      type: "error",
    });
    errorhandler(error, res);
  }
}
