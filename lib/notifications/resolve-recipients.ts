import { Role } from "@prisma/client";

import prisma from "@/lib/prisma";
import {
  DEFAULT_ADMIN_PREFERENCES,
  DEFAULT_MEMBER_PREFERENCES,
  type TeamNotificationScope,
  type TeamNotificationType,
} from "@/lib/zod/schemas/notifications";

export type NotificationRecipient = {
  userId: string;
  email: string;
  scope: TeamNotificationScope;
  role: Role;
};

export async function resolveRecipients({
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
  const teamMembers = await prisma.userTeam.findMany({
    where: {
      teamId,
      status: "ACTIVE",
    },
    select: {
      userId: true,
      role: true,
      user: {
        select: {
          email: true,
        },
      },
    },
  });

  const ownerIds = new Set(
    [linkOwnerId, documentOwnerId].filter(Boolean) as string[],
  );

  const eligibleMembers = teamMembers.filter((member) => {
    if (member.role === "ADMIN" || member.role === "MANAGER") return true;
    return ownerIds.has(member.userId);
  });

  if (eligibleMembers.length === 0) return [];

  const userIds = eligibleMembers.map((m) => m.userId);
  const preferences = await prisma.notificationPreference.findMany({
    where: {
      userId: { in: userIds },
      teamId,
      type: notificationType,
    },
  });

  const prefMap = new Map(
    preferences.map((p) => [
      p.userId,
      { frequency: p.frequency, scope: p.scope },
    ]),
  );

  return eligibleMembers
    .map((member) => {
      const stored = prefMap.get(member.userId);
      const defaultPrefs =
        member.role === "MEMBER"
          ? DEFAULT_MEMBER_PREFERENCES
          : DEFAULT_ADMIN_PREFERENCES;
      const defaults = defaultPrefs[notificationType];

      const frequency = stored?.frequency ?? defaults.frequency;
      const scope = (stored?.scope ??
        defaults.scope) as TeamNotificationScope;

      return {
        userId: member.userId,
        email: member.user.email!,
        enabled: frequency !== "NEVER",
        scope,
        role: member.role,
      };
    })
    .filter((r) => {
      if (!r.email || !r.enabled) return false;
      if (r.scope === "MINE_ONLY" && !ownerIds.has(r.userId)) return false;
      return true;
    });
}
