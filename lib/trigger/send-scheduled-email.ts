import { logger, task } from "@trigger.dev/sdk";

import { sendAbandonedCheckoutEmail } from "@/lib/emails/send-abandoned-checkout";
import { sendDataroomInfoEmail } from "@/lib/emails/send-dataroom-info";
import { sendDataroomTrial24hReminderEmail } from "@/lib/emails/send-dataroom-trial-24h";
import { sendDataroomTrialEndEmail } from "@/lib/emails/send-dataroom-trial-end";
import { sendUpgradeIntentEmail } from "@/lib/emails/send-upgrade-intent";
import { sendUpgradeOneMonthCheckinEmail } from "@/lib/emails/send-upgrade-month-checkin";
import prisma from "@/lib/prisma";
import { redis } from "@/lib/redis";

export const sendDataroomTrialInfoEmailTask = task({
  id: "send-dataroom-trial-info-email",
  retry: { maxAttempts: 3 },
  run: async (payload: { to: string; useCase: string }) => {
    await sendDataroomInfoEmail(
      {
        user: { email: payload.to, name: "Marc" },
      },
      payload.useCase,
    );
    logger.info("Email sent", { to: payload.to });
  },
});

export const sendDataroomTrial24hReminderEmailTask = task({
  id: "send-dataroom-trial-24h-reminder-email",
  retry: { maxAttempts: 3 },
  run: async (payload: { to: string; name: string; teamId: string }) => {
    const team = await prisma.team.findUnique({
      where: {
        id: payload.teamId,
      },
      select: {
        plan: true,
      },
    });

    if (!team) {
      logger.error("Team not found", { teamId: payload.teamId });
      return;
    }

    // Only send reminder email if team still has trial plan
    if (team.plan.includes("drtrial")) {
      await sendDataroomTrial24hReminderEmail({
        email: payload.to,
        name: payload.name,
      });
      logger.info("Email sent", { to: payload.to, teamId: payload.teamId });
    } else {
      logger.info("Team upgraded - no trial reminder needed", {
        teamId: payload.teamId,
        plan: team.plan,
      });
    }
  },
});

export const sendDataroomTrialExpiredEmailTask = task({
  id: "send-dataroom-trial-expired-email",
  retry: { maxAttempts: 3 },
  run: async (payload: { to: string; name: string; teamId: string }) => {
    const team = await prisma.team.findUnique({
      where: {
        id: payload.teamId,
      },
      select: {
        plan: true,
      },
    });

    if (!team) {
      logger.error("Team not found", { teamId: payload.teamId });
      return;
    }

    if (team.plan.includes("drtrial")) {
      // send email to the user
      await sendDataroomTrialEndEmail({
        email: payload.to,
        name: payload.name,
      });
      logger.info("Email sent", { to: payload.to, teamId: payload.teamId });

      // remove trial on the plan
      const updatedTeam = await prisma.team.update({
        where: { id: payload.teamId },
        data: { plan: team.plan.replace("+drtrial", "") },
      });

      const isPaid = [
        "pro",
        "business",
        "datarooms",
        "datarooms-plus",
        "datarooms-premium",
        "datarooms-unlimited",
      ].includes(updatedTeam.plan);

      if (!isPaid) {
        // remove branding
        await prisma.brand.deleteMany({
          where: {
            teamId: payload.teamId,
          },
        });
        logger.info("Branding removed after trial expired", {
          teamId: payload.teamId,
        });

        // block all non-admin users
        const blockedUsers = await prisma.userTeam.updateMany({
          where: {
            teamId: payload.teamId,
            role: { not: "ADMIN" },
          },
          data: {
            status: "BLOCKED_TRIAL_EXPIRED",
            blockedAt: new Date(),
          },
        });
        logger.info("Team members blocked after trial expired", {
          teamId: payload.teamId,
          usersCount: blockedUsers.count,
        });
      }

      logger.info("Trial removed", { teamId: payload.teamId });
      return;
    }

    logger.info("Team upgraded - no further action", {
      teamId: payload.teamId,
      plan: team.plan,
    });
    return;
  },
});

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
        !["pro", "business", "datarooms", "datarooms-plus", "datarooms-premium", "datarooms-unlimited"].includes(team.plan)
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
      logger.info("Email sent", { to: payload.to });
    } catch (error) {
      logger.error("Error sending upgrade one month checkin email", { error });
      return;
    }
  },
});

export const sendAbandonedCheckoutEmailTask = task({
  id: "send-abandoned-checkout-email",
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

      // If team already upgraded to a paid plan, don't send abandoned checkout email
      const paidPlans = [
        "pro",
        "business",
        "datarooms",
        "datarooms-plus",
        "datarooms-premium",
      ];
      const isPaidPlan = paidPlans.some((plan) => team.plan.includes(plan));

      if (isPaidPlan) {
        logger.info("Team already on paid plan - no abandoned checkout email needed", {
          teamId: payload.teamId,
          plan: team.plan,
        });
        return;
      }

      await sendAbandonedCheckoutEmail({
        user: { email: payload.to, name: payload.name },
      });
      logger.info("Abandoned checkout email sent", { to: payload.to });
    } catch (error) {
      logger.error("Error sending abandoned checkout email", { error });
      return;
    }
  },
});

export const sendUpgradeIntentEmailTask = task({
  id: "send-upgrade-intent-email",
  retry: { maxAttempts: 3 },
  run: async (payload: {
    to: string;
    name: string;
    teamId: string;
    triggers?: string[];
  }) => {
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

      // If team already upgraded to a paid plan or proceeded to checkout, don't send email
      const paidPlans = [
        "pro",
        "business",
        "datarooms",
        "datarooms-plus",
        "datarooms-premium",
      ];
      const isPaidPlan = paidPlans.some((plan) => team.plan.includes(plan));

      if (isPaidPlan) {
        logger.info("Team already on paid plan - no upgrade intent email needed", {
          teamId: payload.teamId,
          plan: team.plan,
        });
        return;
      }

      // Check if user proceeded to checkout (by checking if they have checkout session started)
      const checkoutKey = `checkout:started:${payload.teamId}`;
      const checkoutStarted = await redis.get(checkoutKey);

      if (checkoutStarted) {
        logger.info("User already proceeded to checkout - no upgrade intent email needed", {
          teamId: payload.teamId,
        });
        return;
      }

      await sendUpgradeIntentEmail({
        user: { email: payload.to, name: payload.name },
        triggers: payload.triggers,
      });
      logger.info("Upgrade intent email sent", {
        to: payload.to,
        triggers: payload.triggers,
      });

      // Clear the upgrade clicks and triggers after sending email
      const upgradeClicksKey = `upgrade:clicks:${payload.teamId}`;
      const upgradeTriggersKey = `upgrade:triggers:${payload.teamId}`;
      await redis.del(upgradeClicksKey);
      await redis.del(upgradeTriggersKey);
    } catch (error) {
      logger.error("Error sending upgrade intent email", { error });
      return;
    }
  },
});
