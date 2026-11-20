import { NextApiRequest, NextApiResponse } from "next";

import {
  sendDataroomTrial24hReminderEmailTask,
  sendDataroomTrialExpiredEmailTask,
  sendDataroomTrialInfoEmailTask,
} from "@/ee/features/billing/dataroom-trial/lib/trigger/send-scheduled-email";
import { resolveDefaultBrandId } from "@/ee/features/branding/lib/resolve-base-brand";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { waitUntil } from "@vercel/functions";
import { getServerSession } from "next-auth/next";

import { sendDataroomTrialWelcome } from "@/lib/emails/send-dataroom-trial";
import { newId } from "@/lib/id-helper";
import prisma from "@/lib/prisma";
import { companyTeamName, isGeneratedTeamName } from "@/lib/team-name";
import { CustomUser } from "@/lib/types";
import { log, logStore } from "@/lib/utils";

export const config = {
  // in order to enable `waitUntil` function
  supportsResponseStreaming: true,
};

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "POST") {
    // POST /api/teams/:teamId/datarooms/trial
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      res.status(401).end("Unauthorized");
      return;
    }

    const userId = (session.user as CustomUser).id;
    const email = (session.user as CustomUser).email;

    const { teamId } = req.query as { teamId: string };
    const { name, fullName, companyName, useCase, companySize, tools } =
      req.body as {
        name: string;
        fullName: string;
        companyName: string;
        useCase: string;
        companySize: string;
        tools: string;
      };

    try {
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
          name: true,
          plan: true,
          _count: {
            select: {
              datarooms: true,
            },
          },
        },
      });

      if (!team) {
        return res.status(401).end("Unauthorized");
      }

      if (team.plan.includes("drtrial") || team._count.datarooms > 0) {
        return res
          .status(400)
          .json({ message: "Trial data room already exists" });
      }

      await log({
        message: `Dataroom Trial: ${teamId} \n\nEmail: ${email} \nName: ${fullName} \nCompany Name: ${companyName} \nUse Case: ${useCase} \nCompany Size: ${companySize} \nTools: ${tools}`,
        type: "trial",
        mention: true,
      });

      await logStore({
        object: {
          teamId: teamId,
          email: email,
          fullName: fullName,
          companyName: companyName,
          useCase: useCase,
          companySize: companySize,
          tools: tools,
        },
      });

      // The trial form is the first place we learn who the team actually is, so
      // "Personal Team" becomes "Acme Team". A name they chose is left alone.
      const renamed = isGeneratedTeamName(team.name, fullName)
        ? companyTeamName(companyName)
        : "";

      const pId = newId("dataroom");
      const defaultBrandId = await resolveDefaultBrandId(teamId);

      const dataroom = await prisma.$transaction(async (tx) => {
        await tx.team.update({
          where: { id: teamId },
          data: {
            plan: `${team.plan}+drtrial`,
            ...(renamed ? { name: renamed } : {}),
          },
        });

        return tx.dataroom.create({
          data: {
            name: name,
            teamId: teamId,
            pId: pId,
            brandId: defaultBrandId,
          },
        });
      });

      const dataroomWithCount = {
        ...dataroom,
        _count: { documents: 0 },
      };

      /** Emails
       *
       * 1. Send welcome email
       * 2. Send dataroom info email after 1 day
       * 3. Send 24h reminder after 6 days
       * 4. Send expired trial email after 7 days
       *
       * Capture the reminder + expiry run ids so the trial can later be
       * extended (see scripts/extend-trial.ts).
       */
      waitUntil(sendDataroomTrialWelcome({ fullName, to: email! }));
      waitUntil(
        sendDataroomTrialInfoEmailTask.trigger(
          { to: email!, useCase, name: fullName.split(" ")[0] },
          { delay: "1d", tags: [`team_${teamId}`] },
        ),
      );
      waitUntil(
        (async () => {
          try {
            const reminderHandle =
              await sendDataroomTrial24hReminderEmailTask.trigger(
                { to: email!, name: fullName.split(" ")[0], teamId },
                { delay: "6d", tags: [`team_${teamId}`] },
              );
            const expiredHandle =
              await sendDataroomTrialExpiredEmailTask.trigger(
                { to: email!, name: fullName.split(" ")[0], teamId },
                { delay: "7d", tags: [`team_${teamId}`] },
              );
            await prisma.team.update({
              where: { id: teamId },
              data: {
                trialReminderRunId: reminderHandle.id,
                trialExpiredRunId: expiredHandle.id,
              },
            });
          } catch (error) {
            console.error(
              `[dataroom-trial] Failed to schedule trial emails or persist run IDs for team ${teamId}:`,
              error,
            );
            await log({
              message: `:x: Dataroom Trial: failed to schedule trial emails or persist run IDs for team \`${teamId}\`\n\n\`\`\`${
                error instanceof Error ? error.message : String(error)
              }\`\`\``,
              type: "error",
              mention: true,
            });
          }
        })(),
      );

      res.status(201).json(dataroomWithCount);
    } catch (error) {
      console.error("Request error", error);
      res.status(500).json({ error: "Error creating dataroom" });
    }
  } else {
    // We only allow POST requests
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
