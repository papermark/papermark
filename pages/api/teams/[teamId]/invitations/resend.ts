import { NextApiRequest, NextApiResponse } from "next";

import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { getServerSession } from "next-auth";
import { z } from "zod";

import { hashToken } from "@/lib/api/auth/token";
import { sendTeammateInviteEmail } from "@/lib/emails/send-teammate-invite";
import { errorhandler } from "@/lib/errorHandler";
import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";
import { generateChecksum } from "@/lib/utils/generate-checksum";
import { generateJWT } from "@/lib/utils/generate-jwt";

const emailSchema = z.string().trim().email();

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "PUT") {
    // PUT /api/teams/:teamId/invitations/resend
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      res.status(401).end("Unauhorized");
      return;
    }

    const { teamId } = req.query as { teamId: string };

    const emailResult = emailSchema.safeParse(req.body?.email);
    if (!emailResult.success) {
      return res.status(400).json("A valid email is required");
    }
    const email = emailResult.data;

    try {
      // check if currentUser is part of the team with the teamId
      const userTeam = await prisma.userTeam.findUnique({
        where: {
          userId_teamId: {
            userId: (session.user as CustomUser).id,
            teamId,
          },
        },
      });

      if (!userTeam) {
        res.status(403).json("You are not part of this team");
        return;
      }

      const isUserAdmin = userTeam.role === "ADMIN";
      if (!isUserAdmin) {
        res.status(403).json("Only admins can resend the invitation!");
        return;
      }

      // get current team
      const team = await prisma.team.findUnique({
        where: {
          id: teamId,
        },
        select: {
          name: true,
        },
      });

      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 168); // invitation expires in 7 days

      const invitation = await prisma.invitation.findUnique({
        where: {
          email_teamId: {
            email,
            teamId,
          },
        },
        select: {
          token: true,
        },
      });

      if (!invitation) {
        return res.status(404).json("Invitation not found");
      }

      await prisma.invitation.update({
        where: {
          email_teamId: {
            email,
            teamId,
          },
        },
        data: {
          expires: expiresAt,
        },
      });

      const verificationTokenRecord = await prisma.verificationToken.findUnique(
        {
          where: { token: hashToken(invitation.token) },
        },
      );

      if (!verificationTokenRecord) {
        await prisma.verificationToken.create({
          data: {
            expires: expiresAt,
            token: hashToken(invitation.token),
            identifier: email,
          },
        });
      } else {
        await prisma.verificationToken.update({
          where: { token: hashToken(invitation.token) },
          data: {
            expires: expiresAt,
          },
        });
      }

      // send invite email
      const sender = session.user as CustomUser;

      // invitation acceptance URL
      const invitationUrl = `/api/teams/${teamId}/invitations/accept?token=${invitation.token}&email=${email}`;
      const fullInvitationUrl = `${process.env.NEXT_PUBLIC_BASE_URL}${invitationUrl}`;

      // magic link
      const magicLinkParams = new URLSearchParams({
        email,
        token: invitation.token,
        callbackUrl: fullInvitationUrl,
      });

      const magicLink = `${process.env.NEXT_PUBLIC_BASE_URL}/api/auth/callback/email?${magicLinkParams.toString()}`;

      const verifyParams = new URLSearchParams({
        verification_url: magicLink,
        email,
        token: invitation.token,
        teamId,
        type: "invitation",
        expiresAt: expiresAt.toISOString(),
      });

      const verifyParamsObject = Object.fromEntries(verifyParams.entries());

      const jwtToken = generateJWT(verifyParamsObject);

      const verifyUrl = `${process.env.NEXT_PUBLIC_BASE_URL}/verify/invitation?token=${jwtToken}`;

      sendTeammateInviteEmail({
        senderName: sender.name || "",
        senderEmail: sender.email || "",
        teamName: team?.name || "",
        to: email,
        url: verifyUrl,
      });

      res.status(200).json("Invitation sent again!");
      return;
    } catch (error) {
      errorhandler(error, res);
    }
  }
}
