import { logger, task } from "@trigger.dev/sdk";

import { sendUpgradeOneMonthCheckinEmail } from "@/lib/emails/send-upgrade-month-checkin";
import prisma from "@/lib/prisma";

export const sendUpgradeOneMonthCheckinEmailTask = task({
  id: "send-upgrade-one-month-checkin-email",
  retry: { maxAttempts: 3 },
  run: async (payload: { to: string; name: string; teamId: string }) => {
    try {
      const team = await prisma.team.findUnique({
        where: { id: payload.teamId },
        select: {
          plan: true,
        },
      });

      if (!team) {
        logger.error("Team not found", { teamId: payload.teamId });
        return;
      }

      if (
        ![
          "pro",
          "business",
          "datarooms",
          "datarooms-plus",
          "datarooms-premium",
          "datarooms-unlimited",
        ].includes(team.plan)
      ) {
        logger.info("Team not on paid plan - no further action", {
          teamId: payload.teamId,
          plan: team.plan,
        });
        return;
      }

      await sendUpgradeOneMonthCheckinEmail({
        user: { email: payload.to, name: payload.name },
      });
      const [localPart, domain] = payload.to.split("@");
      const maskedTo =
        localPart && domain
          ? `${localPart[0]}***@${domain}`
          : "***";
      logger.info("Email sent", {
        teamId: payload.teamId,
        to: maskedTo,
      });
    } catch (error) {
      logger.error("Error sending upgrade one month checkin email", { error });
      return;
    }
  },
});
