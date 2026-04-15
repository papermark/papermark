import { Link } from "@prisma/client";

import { dispatchNotification } from "@/lib/notifications/dispatch";
import prisma from "@/lib/prisma";

import { sendBlockedEmailAttemptNotification } from "./send-blocked-email-attempt";

export async function reportDeniedAccessAttempt(
  link: Partial<Link>,
  email: string,
  accessType: "global" | "allow" | "deny" = "global",
) {
  if (!link || !link.teamId) return;

  let resourceType: "dataroom" | "document" = "dataroom";
  let resourceName = "Dataroom";
  let documentOwnerId: string | null = null;

  if (link.documentId) {
    resourceType = "document";
    const document = await prisma.document.findUnique({
      where: { id: link.documentId },
      select: { name: true, ownerId: true },
    });
    resourceName = document?.name || "Document";
    documentOwnerId = document?.ownerId || null;
  } else if (link.dataroomId) {
    const dataroom = await prisma.dataroom.findUnique({
      where: { id: link.dataroomId },
      select: { name: true },
    });
    resourceName = dataroom?.name || "Dataroom";
  }

  const linkName = link.name || `Link #${link.id?.slice(-5)}`;
  const timestamp = new Date().toLocaleString();

  const recipients = await dispatchNotification({
    teamId: link.teamId,
    notificationType: "BLOCKED_ACCESS",
    linkOwnerId: link.ownerId,
    documentOwnerId,
  });

  if (recipients.length > 0) {
    const [to, ...cc] = recipients.map((r) => r.email);
    await sendBlockedEmailAttemptNotification({
      to,
      cc: cc.length > 0 ? cc : undefined,
      blockedEmail: email,
      linkName,
      resourceName,
      resourceType,
      timestamp,
      accessType,
    });
  }
}
