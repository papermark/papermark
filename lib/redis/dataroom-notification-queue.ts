import { redis } from "@/lib/redis";

const ITEM_TTL_SECONDS = 8 * 24 * 60 * 60; // 8 days

type QueueItem = {
  dataroomDocumentId: string;
  senderUserId: string | null;
  queuedAt: number;
};

type DigestViewerEntry = {
  viewerId: string;
  dataroomId: string;
  teamId: string;
};

function itemsKey(viewerId: string, dataroomId: string) {
  return `dataroom_digest_items:${viewerId}:${dataroomId}`;
}

function viewerSetKey(frequency: "daily" | "weekly") {
  return `dataroom_digest_viewers:${frequency}`;
}

function encodeViewerEntry(entry: DigestViewerEntry): string {
  return `${entry.viewerId}:${entry.dataroomId}:${entry.teamId}`;
}

function decodeViewerEntry(encoded: string): DigestViewerEntry {
  const [viewerId, dataroomId, teamId] = encoded.split(":");
  return { viewerId, dataroomId, teamId };
}

export async function queueNotification({
  frequency,
  viewerId,
  dataroomId,
  teamId,
  dataroomDocumentId,
  senderUserId,
}: {
  frequency: "daily" | "weekly";
  viewerId: string;
  dataroomId: string;
  teamId: string;
  dataroomDocumentId: string;
  senderUserId: string | null;
}) {
  const key = itemsKey(viewerId, dataroomId);
  const item: QueueItem = {
    dataroomDocumentId,
    senderUserId,
    queuedAt: Date.now(),
  };

  const pipeline = redis.pipeline();
  pipeline.rpush(key, JSON.stringify(item));
  pipeline.expire(key, ITEM_TTL_SECONDS);
  pipeline.sadd(
    viewerSetKey(frequency),
    encodeViewerEntry({ viewerId, dataroomId, teamId }),
  );
  await pipeline.exec();
}

export type DigestBatch = {
  viewerId: string;
  dataroomId: string;
  teamId: string;
  items: QueueItem[];
};

export async function popDigestQueue(
  frequency: "daily" | "weekly",
): Promise<DigestBatch[]> {
  const setKey = viewerSetKey(frequency);

  const members = await redis.smembers(setKey);
  if (!members || members.length === 0) return [];

  // Remove the entire set atomically
  await redis.del(setKey);

  const batches: DigestBatch[] = [];

  for (const member of members) {
    const entry = decodeViewerEntry(member);
    const key = itemsKey(entry.viewerId, entry.dataroomId);

    // Get all items then delete the list
    const rawItems = await redis.lrange(key, 0, -1);
    await redis.del(key);

    if (!rawItems || rawItems.length === 0) continue;

    const items: QueueItem[] = rawItems
      .map((raw) => {
        try {
          return typeof raw === "string"
            ? (JSON.parse(raw) as QueueItem)
            : (raw as QueueItem);
        } catch (error) {
          console.warn(
            `[dataroom-digest] Skipping corrupted queue item for viewer=${entry.viewerId} dataroom=${entry.dataroomId}:`,
            { raw, error },
          );
          return null;
        }
      })
      .filter((item): item is QueueItem => item !== null);

    batches.push({
      viewerId: entry.viewerId,
      dataroomId: entry.dataroomId,
      teamId: entry.teamId,
      items,
    });
  }

  return batches;
}
