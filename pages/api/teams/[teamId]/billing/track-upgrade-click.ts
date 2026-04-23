import { NextApiRequest, NextApiResponse } from "next";

import { waitUntil } from "@vercel/functions";
import { getServerSession } from "next-auth/next";

import prisma from "@/lib/prisma";
import { redis } from "@/lib/redis";
import { sendUpgradeIntentEmailTask } from "@/lib/trigger/send-scheduled-email";
import { CustomUser } from "@/lib/types";

import { authOptions } from "../../../auth/[...nextauth]";

export const config = {
  supportsResponseStreaming: true,
};

const THREE_DAYS_IN_SECONDS = 3 * 24 * 60 * 60;
const REQUIRED_CLICKS = 3;

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "POST") {
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      return res.status(401).end("Unauthorized");
    }

    const { teamId } = req.query as { teamId: string };
    const { trigger } = req.body as { trigger?: string };
    const {
      id: userId,
      email: userEmail,
      name: userName,
    } = session.user as CustomUser;

    // Verify user belongs to team
    const userTeam = await prisma.userTeam.findFirst({
      where: {
        teamId,
        userId,
      },
    });

    if (!userTeam) {
      return res.status(404).end("Team not found");
    }

    // Check if team is already on a paid plan
    const team = await prisma.team.findUnique({
      where: { id: teamId },
      select: { plan: true },
    });

    if (!team) {
      return res.status(404).end("Team not found");
    }

    const paidPlans = [
      "pro",
      "business",
      "datarooms",
      "datarooms-plus",
      "datarooms-premium",
    ];
    const isPaidPlan = paidPlans.some((plan) => team.plan.includes(plan));

    if (isPaidPlan) {
      // Team already on paid plan, no need to track
      return res.status(200).json({ tracked: false, reason: "already_paid" });
    }

    const upgradeClicksKey = `upgrade:clicks:${teamId}`;
    const upgradeTriggersKey = `upgrade:triggers:${teamId}`;
    const now = Date.now();
    const threeDaysAgo = now - THREE_DAYS_IN_SECONDS * 1000;

    // Get existing clicks
    const existingClicks = await redis.zrange(upgradeClicksKey, 0, -1, {
      withScores: true,
    });

    // Filter clicks within the last 3 days
    const recentClicks: number[] = [];
    for (let i = 0; i < existingClicks.length; i += 2) {
      const timestamp = existingClicks[i + 1] as number;
      if (timestamp > threeDaysAgo) {
        recentClicks.push(timestamp);
      }
    }

    // Add new click
    await redis.zadd(upgradeClicksKey, { score: now, member: now.toString() });

    // Store the trigger if provided
    if (trigger) {
      await redis.sadd(upgradeTriggersKey, trigger);
      await redis.expire(upgradeTriggersKey, THREE_DAYS_IN_SECONDS);
    }

    // Remove old clicks (older than 3 days)
    await redis.zremrangebyscore(upgradeClicksKey, 0, threeDaysAgo);

    // Set expiry on the key (3 days from now)
    await redis.expire(upgradeClicksKey, THREE_DAYS_IN_SECONDS);

    const totalRecentClicks = recentClicks.length + 1;

    // If this is the 3rd click (or more) within 3 days, schedule the email
    if (totalRecentClicks >= REQUIRED_CLICKS) {
      // Check if we already scheduled an email for this session
      const emailScheduledKey = `upgrade:email-scheduled:${teamId}`;
      const alreadyScheduled = await redis.get(emailScheduledKey);

      if (!alreadyScheduled) {
        // Get all triggers the user clicked on
        const triggers = (await redis.smembers(upgradeTriggersKey)) as string[];

        // Mark as scheduled
        await redis.set(emailScheduledKey, "1", { ex: THREE_DAYS_IN_SECONDS });

        // Schedule email for 1 day after the last click
        waitUntil(
          sendUpgradeIntentEmailTask.trigger(
            {
              to: userEmail as string,
              name: userName as string,
              teamId,
              triggers,
            },
            {
              delay: "1d",
            },
          ),
        );

        return res.status(200).json({
          tracked: true,
          clicks: totalRecentClicks,
          triggers,
          emailScheduled: true,
        });
      }
    }

    return res.status(200).json({
      tracked: true,
      clicks: totalRecentClicks,
      emailScheduled: false,
    });
  } else {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
