import { NextApiRequest, NextApiResponse } from "next";

import { stripeInstance } from "@/ee/stripe";
import { authOptions } from "@/lib/auth/auth-options";
import { runs } from "@trigger.dev/sdk";
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
    // POST /api/teams/:teamId/billing/unpause – unpause a user's subscription
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
          pauseStartsAt: true,
          pauseEndsAt: true,
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

      if (!team.pauseStartsAt || !team.pauseEndsAt) {
        return res.status(400).json({ error: "Subscription is not paused" });
      }

      const isOldAccount = team.plan.includes("+old");
      const stripe = stripeInstance(isOldAccount);

      // First, check the subscription to determine if it was paused with old method or new method
      const subscription = await stripe.subscriptions.retrieve(
        team.subscriptionId,
      );

      const now = new Date();
      const originalPauseStart = team.pauseStartsAt;

      // Determine if we're still in the original billing cycle or have moved to the next one
      const isInOriginalBillingCycle = now <= originalPauseStart;

      // Check if this subscription was paused using the old pause_collection method
      const isOldPauseMethod = subscription.pause_collection !== null;

      if (isOldPauseMethod) {
        if (isInOriginalBillingCycle) {
          await stripe.subscriptions.update(team.subscriptionId, {
            pause_collection: "", // Remove pause_collection (unpause)
          });
        } else {
          await stripe.subscriptions.update(team.subscriptionId, {
            pause_collection: "", // Remove pause_collection (unpause)
          });
          await stripe.subscriptions.update(team.subscriptionId, {
            proration_behavior: "create_prorations", // Create prorations for immediate billing
            billing_cycle_anchor: "now", // Reset billing cycle to start immediately
          });
        }
      } else {
        // Handle new coupon-based method
        if (isInOriginalBillingCycle) {
          // Scenario 1: Still within the original billing cycle where user paused
          // Just remove the coupon, no billing cycle reset needed
          await stripe.subscriptions.deleteDiscount(team.subscriptionId);
        } else {
          // Scenario 2: We're already in the next billing cycle (or beyond)
          // Remove coupon and reset billing cycle to charge immediately
          await stripe.subscriptions.deleteDiscount(team.subscriptionId);
          await stripe.subscriptions.update(team.subscriptionId, {
            proration_behavior: "create_prorations", // Create prorations for immediate billing
            billing_cycle_anchor: "now", // Reset billing cycle to start immediately
          });
        }
      }

      await prisma.team.update({
        where: { id: teamId },
        data: {
          pausedAt: null,
          pauseStartsAt: null,
          pauseEndsAt: null,
        },
      });

      // Get all delayed and queued runs for this team (both notification and automatic unpause)
      const allRuns = await runs.list({
        taskIdentifier: [
          "send-pause-resume-notification",
          "automatic-unpause-subscription",
        ],
        tag: [`team_${teamId}`],
        status: ["DELAYED", "QUEUED"],
        period: "90d",
      });

      // Cancel any existing unsent notification and automatic unpause runs
      waitUntil(
        Promise.all([
          allRuns.data.map((run) => runs.cancel(run.id)),
          log({
            message: `Team ${teamId} (${team.plan}) manually unpaused their subscription using ${isOldPauseMethod ? "pause_collection method" : "coupon method"}${!isOldPauseMethod ? (isInOriginalBillingCycle ? " within original billing cycle" : " with billing cycle reset") : ""}.`,
            type: "info",
          }),
        ]),
      );

      res.status(200).json({
        success: true,
        message: "Subscription unpaused successfully",
      });
    } catch (error) {
      console.error("Error unpausing subscription:", error);
      await log({
        message: `Error unpausing subscription for team ${teamId}: ${error}`,
        type: "error",
      });
      res.status(500).json({ error: "Failed to unpause subscription" });
    }
  } else {
    res.setHeader("Allow", ["POST"]);
    res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
