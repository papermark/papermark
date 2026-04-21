import { NextApiRequest, NextApiResponse } from "next";

import { isTeamPaused } from "@/ee/features/billing/cancellation/lib/is-team-paused";
import { stripeInstance } from "@/ee/stripe";
import { isOldAccount } from "@/ee/stripe/utils";
import { authOptions } from "@/lib/auth/auth-options";
import { waitUntil } from "@vercel/functions";
import { getServerSession } from "next-auth/next";

import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";
import { log } from "@/lib/utils";

export async function handleRoute(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "POST") {
    // POST /api/teams/:teamId/billing/reactivate – reactivate a user's subscription
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
              role: {
                in: ["ADMIN", "MANAGER"],
              },
            },
          },
        },
        select: {
          id: true,
          stripeId: true,
          subscriptionId: true,
          plan: true,
          pausedAt: true,
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

      const stripe = stripeInstance(isOldAccount(team.plan));

      const subscription = await stripe.subscriptions.update(
        team.subscriptionId,
        {
          cancel_at_period_end: false,
          // Clear any scheduled cancellation (e.g. cancellation scheduled
          // during a paused period).
          cancel_at: null,
        },
      );

      // Preserve the pause state if the team is still within a paused period.
      // Reactivating a cancellation scheduled during a pause should only
      // remove the scheduled cancellation, not end the pause early.
      const teamIsPaused = isTeamPaused(team);

      await prisma.team.update({
        where: { id: teamId },
        data: {
          cancelledAt: null,
          ...(teamIsPaused ? {} : { pauseStartsAt: null }),
        },
      });

      waitUntil(
        log({
          message: `Team ${teamId} reactivated their subscription.`,
          type: "info",
        }),
      );

      return res.status(200).json({ success: true });
    } catch (error) {
      console.error("Error reactivating subscription:", error);
      await log({
        message: `Error reactivating subscription for team ${teamId}: ${error}`,
        type: "error",
      });
      res.status(500).json({ error: "Failed to reactivate subscription" });
    }
  } else {
    res.setHeader("Allow", ["POST"]);
    res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
