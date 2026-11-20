import { NextApiRequest, NextApiResponse } from "next";

import { stripeInstance } from "@/ee/stripe";
import { getCouponFromPlan } from "@/ee/stripe/functions/get-coupon-from-plan";
import { isOldAccount } from "@/ee/stripe/utils";
import { authOptions } from "@/lib/auth/auth-options";
import { waitUntil } from "@vercel/functions";
import { getServerSession } from "next-auth/next";

import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";
import { log } from "@/lib/utils";

export async function handleRoute(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === "POST") {
    // POST /api/teams/:teamId/billing/retention-offer – apply retention offer
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
          startsAt: true,
          endsAt: true,
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

      let isAnnualPlan = false;
      if (team?.startsAt && team?.endsAt) {
        const durationInDays = Math.round(
          (team.endsAt.getTime() - team.startsAt.getTime()) /
            (1000 * 60 * 60 * 24),
        );
        // If duration is more than 31 days, consider it yearly
        isAnnualPlan = durationInDays > 31;
      }

      const stripe = stripeInstance(isOldAccount(team.plan));
      const couponId = getCouponFromPlan(team.plan, isAnnualPlan);

      await stripe.subscriptions.update(team.subscriptionId, {
        discounts: [
          {
            coupon: couponId,
          },
        ],
      });

      waitUntil(
        log({
          message: `Retention offer applied to team ${teamId}: 30% off for ${
            isAnnualPlan ? "12 months" : "3 months"
          }`,
          type: "info",
        }),
      );

      return res.status(200).json({ success: true });
    } catch (error) {
      console.error("Error applying retention offer:", error);
      await log({
        message: `Error applying retention offer for team ${teamId}: ${error}`,
        type: "error",
      });
      res.status(500).json({ error: "Failed to apply retention offer" });
    }
  } else {
    res.setHeader("Allow", ["POST"]);
    res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
