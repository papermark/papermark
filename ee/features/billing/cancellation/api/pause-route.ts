import { NextApiRequest, NextApiResponse } from "next";

import { PAUSE_COUPON_ID } from "@/ee/features/billing/cancellation/constants";
import { sendPauseResumeNotificationTask } from "@/ee/features/billing/cancellation/lib/trigger/pause-resume-notification";
import { automaticUnpauseTask } from "@/ee/features/billing/cancellation/lib/trigger/unpause-task";
import { stripeInstance } from "@/ee/stripe";
import { authOptions } from "@/lib/auth/auth-options";
import { waitUntil } from "@vercel/functions";
import { getServerSession } from "next-auth/next";

import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";
import { log } from "@/lib/utils";

export const config = {
  // in order to enable `waitUntil` function
  supportsResponseStreaming: true,
};

export async function handleRoute(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "POST") {
    // POST /api/teams/:teamId/billing/pause – pause a user's subscription
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      res.status(401).end("Unauthorized");
      return;
    }

    const userId = (session.user as CustomUser).id;
    const { teamId } = req.query as { teamId: string };

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
          stripeId: true,
          subscriptionId: true,
          endsAt: true,
          plan: true,
          limits: true,
        },
      });

      if (!team) {
        return res.status(400).json({ error: "Team does not exist" });
      }

      if (!team.stripeId) {
        return res.status(400).json({ error: "No Stripe customer ID" });
      }

      if (!team.subscriptionId) {
        return res.status(400).json({ error: "No subscription ID" });
      }

      const isOldAccount = team.plan.includes("+old");
      const stripe = stripeInstance(isOldAccount);

      // Fetch the subscription from Stripe to get the actual current_period_end
      // This ensures we don't use stale data from the database
      const subscription = await stripe.subscriptions.retrieve(
        team.subscriptionId,
      );

      // Use the actual current_period_end from Stripe, ensuring pause starts at next billing cycle
      // Never allow retroactive pausing - pauseStartsAt must be in the future
      const now = new Date();
      const stripePeriodEnd = new Date(subscription.current_period_end * 1000);
      const pauseStartsAt = stripePeriodEnd > now ? stripePeriodEnd : now;

      const pauseEndsAt = new Date(pauseStartsAt);
      // Use 3 calendar months instead of 90 days to properly align with billing cycles
      pauseEndsAt.setMonth(pauseStartsAt.getMonth() + 3);
      const reminderAt = new Date(pauseEndsAt);
      reminderAt.setDate(pauseEndsAt.getDate() - 3);

      // Pause the subscription in Stripe
      await stripe.subscriptions.update(team.subscriptionId, {
        discounts: [
          {
            coupon:
              PAUSE_COUPON_ID[isOldAccount ? "old" : "new"][
                process.env.VERCEL_ENV === "production" ? "prod" : "test"
              ],
          },
        ],
        metadata: {
          pause_starts_at: pauseStartsAt.toISOString(),
          pause_ends_at: pauseEndsAt.toISOString(),
          paused_reason: "user_request",
          original_plan: team.plan,
          pause_coupon_id:
            PAUSE_COUPON_ID[isOldAccount ? "old" : "new"][
              process.env.VERCEL_ENV === "production" ? "prod" : "test"
            ],
        },
      });

      await prisma.team.update({
        where: { id: teamId },
        data: {
          pausedAt: new Date(),
          pauseStartsAt,
          pauseEndsAt,
        },
      });

      waitUntil(
        Promise.all([
          // Schedule the pause resume notifications
          sendPauseResumeNotificationTask.trigger(
            { teamId },
            {
              delay: reminderAt, // 3 days before pause ends
              tags: [`team_${teamId}`],
              idempotencyKey: `pause-resume-${teamId}-${new Date().getTime()}`,
            },
          ),
          // Schedule automatic unpause when the 3-month pause period ends
          automaticUnpauseTask.trigger(
            { teamId },
            {
              delay: pauseEndsAt, // Exactly when pause period ends
              tags: [`team_${teamId}`],
              idempotencyKey: `automatic-unpause-${teamId}-${new Date().getTime()}`,
            },
          ),

          log({
            message: `Team ${teamId} (${team.plan}) paused their subscription for 3 months.`,
            type: "info",
          }),
        ]),
      );

      res.status(200).json({
        success: true,
        message: "Subscription paused successfully",
        pauseStartsAt: pauseStartsAt.toISOString(),
        pauseEndsAt: pauseEndsAt.toISOString(),
      });
    } catch (error) {
      console.error("Error pausing subscription:", error);
      await log({
        message: `Error pausing subscription for team ${teamId}: ${error}`,
        type: "error",
      });
      res.status(500).json({ error: "Failed to pause subscription" });
    }
  } else {
    res.setHeader("Allow", ["POST"]);
    res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
