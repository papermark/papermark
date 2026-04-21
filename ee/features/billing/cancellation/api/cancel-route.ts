import { NextApiRequest, NextApiResponse } from "next";

import { isTeamPaused } from "@/ee/features/billing/cancellation/lib/is-team-paused";
import { stripeInstance } from "@/ee/stripe";
import { isOldAccount } from "@/ee/stripe/utils";
import { authOptions } from "@/lib/auth/auth-options";
import { runs } from "@trigger.dev/sdk";
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

      // If the team is currently paused, schedule cancellation at the end of
      // the pause period (so the pause is honored in full) and keep the pause
      // coupon intact. Otherwise fall back to standard period-end cancellation.
      const teamIsPaused = isTeamPaused(team);
      const effectiveEndsAt =
        teamIsPaused && team.pauseEndsAt
          ? new Date(team.pauseEndsAt)
          : undefined;

      waitUntil(
        Promise.all([
          teamIsPaused && effectiveEndsAt
            ? stripe.subscriptions.update(team.subscriptionId, {
                cancel_at: Math.floor(effectiveEndsAt.getTime() / 1000),
              })
            : Promise.all([
                stripe.subscriptions.update(team.subscriptionId, {
                  cancel_at_period_end: true,
                }),
                // Only delete discounts for non-paused subscriptions. Paused
                // subscriptions rely on the pause coupon to remain at $0 for
                // the remainder of the pause period.
                stripe.subscriptions
                  .deleteDiscount(team.subscriptionId)
                  .catch(() => {
                    // Ignore – subscription may not have a discount applied
                  }),
              ]),
          prisma.team.update({
            where: { id: teamId },
            data: {
              cancelledAt: new Date(),
            },
          }),
          // When cancelling a paused subscription, also cancel any scheduled
          // automatic unpause / reminder tasks so they don't race with the
          // Stripe-driven cancellation at pauseEndsAt.
          teamIsPaused
            ? cancelScheduledUnpauseRuns(teamId)
            : Promise.resolve(),
          log({
            message: `Team ${teamId} cancelled their subscription${
              teamIsPaused ? " (paused – will end at pauseEndsAt)" : ""
            }.`,
            type: "info",
          }),
        ]),
      );

      return res.status(200).json({
        success: true,
        cancelAt: (effectiveEndsAt ?? null)?.toISOString() ?? null,
        isPaused: teamIsPaused,
      });
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

async function cancelScheduledUnpauseRuns(teamId: string) {
  try {
    const scheduled = await runs.list({
      taskIdentifier: [
        "send-pause-resume-notification",
        "automatic-unpause-subscription",
      ],
      tag: [`team_${teamId}`],
      status: ["DELAYED", "QUEUED"],
      period: "90d",
    });

    await Promise.all(scheduled.data.map((run) => runs.cancel(run.id)));
  } catch (error) {
    // Best-effort – do not fail cancellation if we can't clean up trigger runs.
    await log({
      message: `Failed to cancel scheduled unpause runs for team ${teamId}: ${error}`,
      type: "error",
    });
  }
}
