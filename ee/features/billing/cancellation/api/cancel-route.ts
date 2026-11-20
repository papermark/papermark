import { NextApiRequest, NextApiResponse } from "next";

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
    // POST /api/teams/:teamId/billing/cancel – cancel a user's subscription
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

      waitUntil(
        Promise.all([
          stripe.subscriptions.update(team.subscriptionId, {
            cancel_at_period_end: true,
          }),
          // Delete discount if one exists - catch errors since subscription may not have a discount
          stripe.subscriptions.deleteDiscount(team.subscriptionId).catch(() => {
            // Ignore error - subscription may not have a discount applied
          }),
          prisma.team.update({
            where: { id: teamId },
            data: {
              cancelledAt: new Date(),
            },
          }),
          log({
            message: `Team ${teamId} cancelled their subscription.`,
            type: "info",
          }),
        ]),
      );

      return res.status(200).json({ success: true });
    } catch (error) {
      console.error("Error cancelling subscription:", error);
      await log({
        message: `Error cancelling subscription for team ${teamId}: ${error}`,
        type: "error",
      });
      res.status(500).json({ error: "Failed to cancel subscription" });
    }
  } else {
    res.setHeader("Allow", ["POST"]);
    res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
