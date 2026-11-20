import type { TeamNotificationType } from "@/lib/zod/schemas/notifications";

import {
  type NotificationRecipient,
  resolveRecipients,
} from "./resolve-recipients";

export async function dispatchNotification({
  teamId,
  notificationType,
  linkOwnerId,
  documentOwnerId,
  taskOwnerId,
}: {
  teamId: string;
  notificationType: TeamNotificationType;
  linkOwnerId?: string | null;
  documentOwnerId?: string | null;
  taskOwnerId?: string | null;
}): Promise<NotificationRecipient[]> {
  return resolveRecipients({
    teamId,
    notificationType,
    linkOwnerId,
    documentOwnerId,
    taskOwnerId,
  });
}
