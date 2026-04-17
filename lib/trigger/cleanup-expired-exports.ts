import { logger, schedules } from "@trigger.dev/sdk";
import { del } from "@vercel/blob";

import { jobStore } from "@/lib/redis-job-store";

export const cleanupExpiredExports = schedules.task({
  id: "cleanup-expired-exports",
  // Run daily at 2 AM UTC
  cron: "0 2 * * *",
  run: async (payload) => {
    logger.info("Starting cleanup of expired export blobs", {
      timestamp: payload.timestamp,
    });

    try {
      // Get all blob URLs that are due for cleanup
      const blobsToCleanup = await jobStore.getBlobsForCleanup();

      if (blobsToCleanup.length === 0) {
        logger.info("No blobs due for cleanup");
        return { deletedCount: 0 };
      }

      logger.info(`Found ${blobsToCleanup.length} blobs to delete`);

      // Delete blobs from Vercel Blob
      const deletionResults = await Promise.allSettled(
        blobsToCleanup.map(async (blob) => {
          try {
            await del(blob.blobUrl);

            // Remove from cleanup queue after successful deletion
            await jobStore.removeBlobFromCleanupQueue(blob.blobUrl, blob.jobId);

            logger.info("Successfully deleted blob", {
              blobUrl: blob.blobUrl,
              jobId: blob.jobId,
            });

            return { blob, success: true };
          } catch (error) {
            logger.error("Failed to delete blob", {
              blobUrl: blob.blobUrl,
              jobId: blob.jobId,
              error: error instanceof Error ? error.message : String(error),
            });
            return { blob, success: false, error };
          }
        }),
      );

      const successCount = deletionResults.filter(
        (result) => result.status === "fulfilled" && result.value.success,
      ).length;

      const failureCount = deletionResults.length - successCount;

      logger.info("Cleanup completed", {
        totalBlobs: blobsToCleanup.length,
        successCount,
        failureCount,
      });

      return {
        deletedCount: successCount,
        failureCount,
        totalProcessed: blobsToCleanup.length,
      };
    } catch (error) {
      logger.error("Cleanup task failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
});
