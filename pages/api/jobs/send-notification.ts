import { NextApiRequest, NextApiResponse } from "next";

import { isTeamPausedById } from "@/ee/features/billing/cancellation/lib/is-team-paused";

import { sendViewedDataroomEmail } from "@/lib/emails/send-viewed-dataroom";
import { sendViewedDataroomPausedEmail } from "@/lib/emails/send-viewed-dataroom-paused";
import { sendViewedDocumentEmail } from "@/lib/emails/send-viewed-document";
import { sendViewedDocumentPausedEmail } from "@/lib/emails/send-viewed-document-paused";
import { dispatchNotification } from "@/lib/notifications/dispatch";
import type { NotificationRecipient } from "@/lib/notifications/resolve-recipients";
import prisma from "@/lib/prisma";
import { log } from "@/lib/utils";
import type { TeamNotificationType } from "@/lib/zod/schemas/notifications";

export const config = {
  maxDuration: 60,
};

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    res.status(405).json({ message: "Method Not Allowed" });
    return;
  }

  const authHeader = req.headers.authorization;
  const token = authHeader?.split(" ")[1];

  if (token !== process.env.INTERNAL_API_KEY) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  const { viewId, locationData } = req.body as {
    viewId: string;
    locationData: {
      continent: string | null;
      country: string;
      region: string;
      city: string;
    };
  };

  let view: {
    viewType: "DOCUMENT_VIEW" | "DATAROOM_VIEW";
    viewerEmail: string | null;
    linkId: string;
    link: { name: string | null; ownerId: string | null } | null;
    document: {
      teamId: string | null;
      id: string;
      name: string;
      ownerId: string | null;
    } | null;
    dataroom: {
      teamId: string | null;
      id: string;
      name: string;
    } | null;
    team: {
      plan: string | null;
      ignoredDomains: string[] | null;
      pauseStartsAt: Date | null;
    } | null;
  } | null;

  try {
    view = await prisma.view.findUnique({
      where: { id: viewId },
      select: {
        viewType: true,
        viewerEmail: true,
        linkId: true,
        link: { select: { name: true, ownerId: true } },
        document: {
          select: { teamId: true, id: true, name: true, ownerId: true },
        },
        dataroom: { select: { teamId: true, id: true, name: true } },
        team: {
          select: { plan: true, ignoredDomains: true, pauseStartsAt: true },
        },
      },
    });

    if (!view) {
      res.status(404).json({ message: "View not found." });
      return;
    }
  } catch (error) {
    log({
      message: `Failed to find document / dataroom view for viewId: ${viewId}. \n\n Error: ${error}`,
      type: "error",
      mention: true,
    });
    res.status(500).json({ message: (error as Error).message });
    return;
  }

  const teamId =
    view.viewType === "DOCUMENT_VIEW"
      ? view.document!.teamId!
      : view.dataroom!.teamId!;

  if (view.viewerEmail) {
    const viewerDomain = view.viewerEmail.split("@").pop();
    if (viewerDomain && view?.team?.ignoredDomains) {
      const ignoredDomainList = view.team.ignoredDomains.map((d) =>
        d.startsWith("@") ? d.substring(1) : d,
      );
      if (ignoredDomainList.includes(viewerDomain)) {
        return res.status(200).json({
          message: "Notification skipped for ignored domain.",
          viewId,
        });
      }
    }
  }

  const notificationType: TeamNotificationType =
    view.viewType === "DOCUMENT_VIEW" ? "DOCUMENT_VIEW" : "DATAROOM_VIEW";

  const linkName = view.link!.name || `Link #${view.linkId.slice(-5)}`;

  const includeLocation =
    !view.team?.plan?.includes("free") &&
    !view.team?.plan?.includes("starter") &&
    !view.team?.plan?.includes("pro");

  const locationString =
    locationData.country === "US"
      ? `${locationData.city}, ${locationData.region}, ${locationData.country}`
      : `${locationData.city}, ${locationData.country}`;

  try {
    const recipients = await dispatchNotification({
      teamId,
      notificationType,
      linkOwnerId: view.link?.ownerId,
      documentOwnerId: view.document?.ownerId,
    });

    if (recipients.length === 0) {
      return res
        .status(200)
        .json({ message: "No recipients", viewId });
    }

    const teamIsPaused = await isTeamPausedById(teamId);
    const primaryRecipient = recipients[0];
    const ccRecipients = recipients
      .slice(1)
      .map((r) => r.email);

    await sendImmediateEmail({
      view,
      teamIsPaused,
      primaryRecipient,
      ccRecipients,
      linkName,
      includeLocation,
      locationString,
    });

    res.status(200).json({ message: "Successfully sent notification", viewId });
    return;
  } catch (error) {
    log({
      message: `Failed to send email in _/api/views_ route for linkId: ${view.linkId}. \n\n Error: ${error} \n\n*Metadata*: \`{teamId: ${teamId}, viewId: ${viewId}}\``,
      type: "error",
      mention: true,
    });
    return res.status(500).json({ message: (error as Error).message });
  }
}

async function sendImmediateEmail({
  view,
  teamIsPaused,
  primaryRecipient,
  ccRecipients,
  linkName,
  includeLocation,
  locationString,
}: {
  view: {
    viewType: string;
    viewerEmail: string | null;
    linkId: string;
    document: { id: string; name: string } | null;
    dataroom: { id: string; name: string } | null;
  };
  teamIsPaused: boolean;
  primaryRecipient: NotificationRecipient;
  ccRecipients: string[];
  linkName: string;
  includeLocation: boolean;
  locationString: string;
}) {
  if (view.viewType === "DOCUMENT_VIEW") {
    if (teamIsPaused) {
      await sendViewedDocumentPausedEmail({
        ownerEmail: primaryRecipient.email,
        documentName: view.document!.name,
        linkName,
        teamMembers: ccRecipients,
      });
    } else {
      await sendViewedDocumentEmail({
        ownerEmail: primaryRecipient.email,
        documentId: view.document!.id,
        documentName: view.document!.name,
        linkName,
        viewerEmail: view.viewerEmail,
        teamMembers: ccRecipients,
        locationString: includeLocation ? locationString : undefined,
      });
    }
  } else {
    if (teamIsPaused) {
      await sendViewedDataroomPausedEmail({
        ownerEmail: primaryRecipient.email,
        dataroomName: view.dataroom!.name,
        linkName,
        teamMembers: ccRecipients,
      });
    } else {
      await sendViewedDataroomEmail({
        ownerEmail: primaryRecipient.email,
        dataroomId: view.dataroom!.id,
        dataroomName: view.dataroom!.name,
        viewerEmail: view.viewerEmail,
        linkName,
        teamMembers: ccRecipients,
        locationString: includeLocation ? locationString : undefined,
      });
    }
  }
}
