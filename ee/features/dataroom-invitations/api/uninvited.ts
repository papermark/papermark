import { NextApiRequest, NextApiResponse } from "next";

import { authOptions } from "@/lib/auth/auth-options";
import { getServerSession } from "next-auth/next";

import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).end("Unauthorized");
  }

  const user = session.user as CustomUser;
  const {
    teamId,
    id: dataroomId,
    groupId,
  } = req.query as {
    teamId: string;
    id: string;
    groupId: string;
  };

  try {
    const teamAccess = await prisma.userTeam.findUnique({
      where: {
        userId_teamId: {
          userId: user.id,
          teamId,
        },
      },
    });

    if (!teamAccess) {
      return res.status(401).end("Unauthorized");
    }

    const group = await prisma.viewerGroup.findFirst({
      where: {
        id: groupId,
        dataroomId,
        teamId,
      },
      select: {
        members: {
          select: {
            viewer: {
              select: {
                id: true,
                email: true,
              },
            },
          },
        },
      },
    });

    if (!group) {
      return res.status(404).json({ error: "Group not found" });
    }

    const viewerIds = group.members.map((member) => member.viewer.id);

    if (viewerIds.length === 0) {
      return res.status(200).json({
        count: 0,
        emails: [],
      });
    }

    const existingInvitations = await prisma.viewerInvitation.findMany({
      where: {
        groupId,
        viewerId: {
          in: viewerIds,
        },
      },
      select: {
        viewerId: true,
      },
    });

    const invitedViewerIds = new Set(
      existingInvitations.map((record) => record.viewerId),
    );

    const uninvitedEmails = group.members
      .filter((member) => !invitedViewerIds.has(member.viewer.id))
      .map((member) => member.viewer.email)
      .filter((email): email is string => Boolean(email));

    return res.status(200).json({
      count: uninvitedEmails.length,
      emails: uninvitedEmails,
    });
  } catch (error) {
    console.error("Error fetching uninvited members", error);
    return res.status(500).json({
      error: "Failed to load uninvited members",
    });
  }
}
