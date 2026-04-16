import { NextApiRequest, NextApiResponse } from "next";

import {
  MAX_INVITATION_EMAILS_PER_DAY,
  MAX_INVITATION_EMAILS_PER_REQUEST,
  SendGroupInvitationSchema,
} from "@/ee/features/dataroom-invitations/lib/schema/dataroom-invitations";
import { authOptions } from "@/lib/auth/auth-options";
import { LinkAudienceType, LinkType } from "@prisma/client";
import { getServerSession } from "next-auth/next";

import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";
import { constructLinkUrl } from "@/lib/utils/link-url";

import { sendDataroomViewerInvite } from "../emails/lib/send-dataroom-viewer-invite";

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
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

  const parseResult = SendGroupInvitationSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({
      error: "Invalid request body",
      details: parseResult.error.flatten(),
    });
  }

  const { linkId, customMessage, emails } = parseResult.data;

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

    const team = await prisma.team.findUnique({
      where: { id: teamId },
      select: { plan: true },
    });

    const plan = team?.plan ?? "";
    const hasAccess =
      plan.includes("datarooms-plus") ||
      plan.includes("datarooms-premium") ||
      plan.includes("datarooms-unlimited");

    if (!team || !hasAccess) {
      return res.status(403).json({
        error: "Email invitations require a Data Rooms Plus plan or higher",
      });
    }

    const group = await prisma.viewerGroup.findUnique({
      where: {
        id: groupId,
        dataroomId,
        teamId,
      },
      select: {
        id: true,
        dataroom: {
          select: {
            name: true,
          },
        },
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

    const link = await prisma.link.findUnique({
      where: {
        id: linkId,
        dataroomId,
        teamId,
        linkType: LinkType.DATAROOM_LINK,
        audienceType: LinkAudienceType.GROUP,
        groupId,
        isArchived: false,
      },
      select: {
        id: true,
        domainId: true,
        domainSlug: true,
        slug: true,
        allowList: true,
      },
    });

    if (!link) {
      return res
        .status(404)
        .json({ error: "Link not found or not associated with this group" });
    }

    const teamMember = await prisma.user.findUnique({
      where: { id: user.id },
      select: { email: true },
    });

    if (!teamMember?.email) {
      return res.status(400).json({ error: "Sender email not available" });
    }

    const availableEmails = group.members
      .map((member) => member.viewer.email)
      .filter(Boolean);

    const targetEmails = Array.from(
      new Set(
        (emails ?? availableEmails).filter((email) =>
          availableEmails.includes(email),
        ),
      ),
    );

    if (targetEmails.length === 0) {
      return res
        .status(400)
        .json({ error: "No valid group member emails provided" });
    }

    if (targetEmails.length > MAX_INVITATION_EMAILS_PER_REQUEST) {
      return res.status(400).json({
        error: `Maximum ${MAX_INVITATION_EMAILS_PER_REQUEST} recipients per request`,
      });
    }

    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const dailySentCount = await prisma.viewerInvitation.count({
      where: {
        invitedBy: user.id,
        createdAt: { gte: oneDayAgo },
        status: "SENT",
      },
    });

    if (dailySentCount + targetEmails.length > MAX_INVITATION_EMAILS_PER_DAY) {
      return res.status(429).json({
        error: `Daily limit of ${MAX_INVITATION_EMAILS_PER_DAY} invitations reached. Contact support@papermark.com to increase your limit.`,
      });
    }

    const viewers = await prisma.viewer.findMany({
      where: {
        teamId,
        email: {
          in: targetEmails,
        },
      },
      select: {
        id: true,
        email: true,
      },
    });

    const viewerByEmail = viewers.reduce<Record<string, { id: string }>>(
      (acc, viewer) => {
        if (viewer.email) {
          acc[viewer.email] = { id: viewer.id };
        }
        return acc;
      },
      {},
    );

    const linkUrl = constructLinkUrl(link);

    const successes: string[] = [];
    const failures: { email: string; error: string }[] = [];

    for (const email of targetEmails) {
      const viewer = viewerByEmail[email];
      if (!viewer) {
        failures.push({
          email,
          error: "Viewer not found",
        });
        continue;
      }

      try {
        await sendDataroomViewerInvite({
          dataroomName: group.dataroom.name,
          senderEmail: teamMember.email,
          to: email,
          url: linkUrl,
          customMessage,
        });

        await prisma.viewerInvitation.create({
          data: {
            viewerId: viewer.id,
            linkId: link.id,
            groupId,
            invitedBy: user.id,
            customMessage,
            status: "SENT",
          },
        });

        successes.push(email);
      } catch (error: any) {
        failures.push({
          email,
          error: error?.message ?? "Unknown error",
        });

        await prisma.viewerInvitation.create({
          data: {
            viewerId: viewer.id,
            linkId: link.id,
            groupId,
            invitedBy: user.id,
            customMessage,
            status: "FAILED",
          },
        });
      }
    }

    return res.status(200).json({
      success: successes,
      failed: failures,
    });
  } catch (error) {
    console.error("Error sending viewer invitations", error);
    return res.status(500).json({
      error: "Failed to send invitations",
    });
  }
}
