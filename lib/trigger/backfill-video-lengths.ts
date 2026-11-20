import { logger, task } from "@trigger.dev/sdk";

import prisma from "@/lib/prisma";
import { processVideo } from "@/lib/trigger/optimize-video-files";

type BackfillVideoLengthsPayload = {
  dryRun?: boolean;
};

type BackfillVideoLengthsResult = {
  enqueued: number;
  dryRun: boolean;
};

const PAGE_SIZE = 500;

export const backfillVideoLengths = task({
  id: "backfill-video-lengths",
  run: async ({
    dryRun = false,
  }: BackfillVideoLengthsPayload): Promise<BackfillVideoLengthsResult> => {
    let lastId: string | undefined;
    let page = 0;
    let total = 0;

    while (true) {
      const versions = await prisma.documentVersion.findMany({
        where: {
          type: "video",
          OR: [{ length: null }, { length: { lte: 0 } }],
          ...(lastId ? { id: { gt: lastId } } : {}),
        },
        take: PAGE_SIZE,
        orderBy: { id: "asc" },
        select: {
          id: true,
          document: {
            select: {
              teamId: true,
            },
          },
        },
      });

      page += 1;
      total += versions.length;

      if (!dryRun && versions.length > 0) {
        await processVideo.batchTrigger(
          versions.map((version) => ({
            payload: {
              documentVersionId: version.id,
              mode: "probe",
            },
            options: {
              idempotencyKey: `backfill-video-length-${version.id}`,
              queue: "video-length-backfill",
              concurrencyKey: version.document.teamId,
              tags: [
                `team_${version.document.teamId}`,
                `version:${version.id}`,
                "video-length-backfill",
              ],
            },
          })),
        );
      }

      logger.info("Processed video length backfill page", {
        page,
        total,
        dryRun,
      });

      const lastVersion = versions.at(-1);
      if (!lastVersion || versions.length < PAGE_SIZE) {
        return { enqueued: total, dryRun };
      }

      lastId = lastVersion.id;
    }
  },
});
