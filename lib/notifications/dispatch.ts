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
}: {
  teamId: string;
  notificationType: TeamNotificationType;
  linkOwnerId?: string | null;
  documentOwnerId?: string | null;
}): Promise<NotificationRecipient[]> {
  return resolveRecipients({
    teamId,
    notificationType,
    linkOwnerId,
    documentOwnerId,
  });
}
