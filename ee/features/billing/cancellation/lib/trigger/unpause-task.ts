import { logger, task } from "@trigger.dev/sdk";

export const automaticUnpauseTask = task({
  id: "automatic-unpause-subscription",
  retry: { maxAttempts: 3 },
  run: async (payload: { teamId: string }) => {
    logger.info("Starting automatic unpause", {
      teamId: payload.teamId,
    });

    const internalApiKey = process.env.INTERNAL_API_KEY;
    if (!internalApiKey) {
      logger.error("INTERNAL_API_KEY environment variable not set");
      throw new Error("Internal API key not configured");
    }

    try {
      // Call the internal API endpoint to perform the automatic unpause
      const response = await fetch(
        `${process.env.NEXTAUTH_URL}/api/internal/billing/automatic-unpause`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${internalApiKey}`,
          },
          body: JSON.stringify({
            teamId: payload.teamId,
          }),
        },
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        logger.error("Internal API call failed", {
          teamId: payload.teamId,
          status: response.status,
          statusText: response.statusText,
          errorData,
        });

        // Don't retry if it's a client error (4xx) - these are usually permanent
        if (response.status >= 400 && response.status < 500) {
          logger.info("Skipping retry for client error", {
            teamId: payload.teamId,
            status: response.status,
          });
          return;
        }

        throw new Error(
          `Internal API call failed: ${response.status} ${response.statusText}`,
        );
      }

      const result = await response.json();
      logger.info("Successfully automatically unpaused subscription", {
        teamId: payload.teamId,
        teamName: result.teamName,
      });
    } catch (error) {
      logger.error("Failed to automatically unpause subscription", {
        teamId: payload.teamId,
        error: error instanceof Error ? error.message : String(error),
      });

      throw error; // Re-throw to trigger retry
    }
  },
});
