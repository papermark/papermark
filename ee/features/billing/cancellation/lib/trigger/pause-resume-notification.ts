import { logger, task } from "@trigger.dev/sdk";

import prisma from "@/lib/prisma";

type PauseResumeNotificationPayload = {
  teamId: string;
};

export const sendPauseResumeNotificationTask = task({
  id: "send-pause-resume-notification",
  retry: { maxAttempts: 3 },
  run: async (payload: PauseResumeNotificationPayload) => {
    logger.info("Starting pause resume notification", {
      teamId: payload.teamId,
    });

    // Verify the team is still paused and get team details
    const team = await prisma.team.findUnique({
      where: {
        id: payload.teamId,
      },
      select: {
        id: true,
        name: true,
        plan: true,
        pauseEndsAt: true,
        pausedAt: true,
        users: {
          where: {
            role: {
              in: ["ADMIN", "MANAGER"],
            },
            // Only active team members (not blocked)
            blockedAt: null,
          },
          select: {
            userId: true,
            role: true,
          },
        },
      },
    });

    if (!team) {
      logger.error("Team not found for pause resume notification", {
        teamId: payload.teamId,
      });
      return;
    }

    // Check if team is still paused
    if (!team.pausedAt || !team.pauseEndsAt) {
      logger.info("Team is no longer paused, skipping notification", {
        teamId: payload.teamId,
        pausedAt: team.pausedAt,
        pauseEndsAt: team.pauseEndsAt,
      });
      return;
    }

    if (team.users.length === 0) {
      logger.info("No admin/manager users found for team", {
        teamId: payload.teamId,
        teamName: team.name,
      });
      return;
    }

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BASE_URL}/api/jobs/send-pause-resume-notification`,
        {
          method: "POST",
          body: JSON.stringify({
            teamId: payload.teamId,
          }),
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.INTERNAL_API_KEY}`,
          },
        },
      );

      if (!response.ok) {
        logger.error("Failed to send pause resume notification", {
          teamId: payload.teamId,
          error: await response.text(),
        });
      }

      const { message } = (await response.json()) as { message: string };
      logger.info("Pause resume notification sent successfully", {
        teamId: payload.teamId,
        message,
      });
    } catch (error) {
      logger.error("Error sending pause resume notification", {
        teamId: payload.teamId,
        error,
      });
    }

    logger.info("Completed pause resume notifications", {
      teamId: payload.teamId,
    });

    return;
  },
});
