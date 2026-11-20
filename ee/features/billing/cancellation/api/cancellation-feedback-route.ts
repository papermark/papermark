import { NextApiRequest, NextApiResponse } from "next";

import { CancellationReason } from "@/ee/features/billing/cancellation/lib/constants";
import { stripeInstance } from "@/ee/stripe";
import { isOldAccount } from "@/ee/stripe/utils";
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
    // POST /api/teams/:teamId/billing/cancellation-feedback – submit cancellation feedback
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      res.status(401).end("Unauthorized");
      return;
    }

    const userId = (session.user as CustomUser).id;
    const { teamId } = req.query as { teamId: string };
    const { reason, feedback } = req.body as {
      reason: CancellationReason;
      feedback: string;
    };

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

      const reasonLabels: Record<CancellationReason, string> = {
        too_expensive: "Too expensive",
        unused: "Not used enough",
        missing_features: "Missing features",
        switched_service: "Switched to another service",
        other: "Other reason",
      };

      // Prepare feedback data for logging and analytics
      const feedbackData = {
        reason,
        reasonLabel: reasonLabels[reason],
        feedback: feedback || "",
        timestamp: new Date().toISOString(),
      };

      // Update the subscription cancellation details
      if (team.stripeId && team.subscriptionId) {
        const stripe = stripeInstance(isOldAccount(team.plan));

        waitUntil(
          stripe.subscriptions.update(team.subscriptionId, {
            cancellation_details: {
              feedback: reason,
              comment: feedback || "",
            },
          }),
        );
      }

      // Log to Slack
      waitUntil(
        log({
          message: `💔 **Cancellation Feedback Received**\n\n**Team:** ${teamId} (${team.plan})\n**Reason:** ${reasonLabels[reason]}\n**Feedback:** ${feedback || "No additional feedback provided"}\n\nTime: ${new Date().toLocaleString()}`,
          type: "info",
        }),
      );

      return res.status(200).json({
        success: true,
        feedbackData, // Return this for PostHog tracking in the frontend
      });
    } catch (error) {
      console.error("Error submitting cancellation feedback:", error);
      await log({
        message: `Error submitting cancellation feedback for team ${teamId}: ${error}`,
        type: "error",
      });
      res.status(500).json({ error: "Failed to submit feedback" });
    }
  } else {
    res.setHeader("Allow", ["POST"]);
    res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
