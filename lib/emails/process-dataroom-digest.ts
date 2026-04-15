import prisma from "@/lib/prisma";
import {
  DigestBatch,
  popDigestQueue,
} from "@/lib/redis/dataroom-notification-queue";
import { log } from "@/lib/utils";
import { generateUnsubscribeUrl } from "@/lib/utils/unsubscribe";

import { sendDataroomDigestNotification } from "./send-dataroom-digest-notification";

export async function processDataroomDigest(frequency: "daily" | "weekly") {
  const batches = await popDigestQueue(frequency);

  if (batches.length === 0) {
    return { processed: 0 };
  }

  let processed = 0;

  for (const batch of batches) {
    try {
      await processBatch(batch, frequency);
      processed++;
    } catch (error) {
      await log({
        message: `Failed to process ${frequency} digest for viewer ${batch.viewerId} in dataroom ${batch.dataroomId}. Error: ${(error as Error).message}`,
        type: "error",
        mention: true,
      });
    }
  }

  return { processed };
}

async function processBatch(batch: DigestBatch, frequency: "daily" | "weekly") {
  if (batch.items.length === 0) return;

  const [viewer, dataroom, senderUser] = await Promise.all([
    prisma.viewer.findUnique({
      where: { id: batch.viewerId, teamId: batch.teamId },
      select: {
        email: true,
        views: {
          where: {
            dataroomId: batch.dataroomId,
            viewType: "DATAROOM_VIEW",
            verified: true,
          },
          orderBy: { viewedAt: "desc" },
          take: 1,
          include: {
            link: {
              select: {
                id: true,
                slug: true,
                domainSlug: true,
                domainId: true,
              },
            },
          },
        },
      },
    }),
    prisma.dataroom.findUnique({
      where: { id: batch.dataroomId, teamId: batch.teamId },
      select: { name: true },
    }),
    batch.items[0]?.senderUserId
      ? prisma.user.findUnique({
          where: { id: batch.items[0].senderUserId },
          select: { email: true },
        })
      : null,
  ]);

  if (!viewer?.email) return;

  const uniqueDocIds = [
    ...new Set(batch.items.map((item) => item.dataroomDocumentId)),
  ];

  const dataroomDocuments = await prisma.dataroomDocument.findMany({
    where: { id: { in: uniqueDocIds } },
    select: {
      id: true,
      document: { select: { name: true } },
    },
  });

  const docNameMap = new Map(
    dataroomDocuments.map((dd) => [dd.id, dd.document?.name ?? "Untitled"]),
  );

  const documents = uniqueDocIds.map((id) => ({
    documentName: docNameMap.get(id) ?? "Untitled",
  }));

  const link = viewer.views[0]?.link;
  let linkUrl: string | undefined;
  if (link?.domainId && link.domainSlug && link.slug) {
    linkUrl = `https://${link.domainSlug}/${link.slug}`;
  } else if (link) {
    linkUrl = `${process.env.NEXT_PUBLIC_MARKETING_URL}/view/${link.id}`;
  }

  if (!linkUrl) return;

  const preferencesUrl = generateUnsubscribeUrl({
    viewerId: batch.viewerId,
    dataroomId: batch.dataroomId,
    teamId: batch.teamId,
  });

  try {
    await sendDataroomDigestNotification({
      dataroomName: dataroom?.name ?? "Unknown Dataroom",
      documents,
      senderEmail: senderUser?.email ?? null,
      to: viewer.email,
      url: linkUrl,
      preferencesUrl,
      frequency,
    });
  } catch (error) {
    throw new Error(
      `Failed to send ${frequency} digest for dataroom "${dataroom?.name}" ` +
        `(viewerId: ${batch.viewerId}, dataroomId: ${batch.dataroomId}): ` +
        `${(error as Error).message}`,
    );
  }
}
