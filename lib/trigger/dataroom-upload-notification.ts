import { logger, task } from "@trigger.dev/sdk";

import { dispatchNotification } from "@/lib/notifications/dispatch";
import prisma from "@/lib/prisma";

type UploadNotificationPayload = {
  dataroomId: string;
  linkId: string;
  viewerId: string;
  teamId: string;
};

export const sendDataroomUploadNotificationTask = task({
  id: "send-dataroom-upload-notification",
  retry: { maxAttempts: 3 },
  run: async (payload: UploadNotificationPayload) => {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

    const recentUploads = await prisma.documentUpload.findMany({
      where: {
        dataroomId: payload.dataroomId,
        linkId: payload.linkId,
        viewerId: payload.viewerId,
        uploadedAt: {
          gte: tenMinutesAgo,
        },
      },
      select: {
        originalFilename: true,
        viewer: {
          select: {
            email: true,
          },
        },
      },
      orderBy: {
        uploadedAt: "desc",
      },
    });

    if (!recentUploads || recentUploads.length === 0) {
      logger.info("No recent uploads found for this dataroom link", {
        dataroomId: payload.dataroomId,
        linkId: payload.linkId,
      });
      return;
    }

    const [dataroom, link] = await Promise.all([
      prisma.dataroom.findUnique({
        where: { id: payload.dataroomId },
        select: { name: true, teamId: true },
      }),
      prisma.link.findUnique({
        where: { id: payload.linkId },
        select: { name: true, ownerId: true },
      }),
    ]);

    if (!dataroom) {
      logger.error("Dataroom not found", {
        dataroomId: payload.dataroomId,
      });
      return;
    }

    const documentNames = recentUploads.map(
      (upload) => upload.originalFilename || "Untitled document",
    );
    const uploaderEmail = recentUploads[0]?.viewer?.email || null;
    const linkName = link?.name || `Link #${payload.linkId.slice(-5)}`;

    const recipients = await dispatchNotification({
      teamId: payload.teamId,
      notificationType: "DATAROOM_UPLOAD",
      linkOwnerId: link?.ownerId,
    });

    if (recipients.length === 0) {
      logger.info("No recipients for upload notification", {
        dataroomId: payload.dataroomId,
      });
      return;
    }

    const primaryRecipient = recipients[0];
    const ccRecipients = recipients.slice(1).map((r) => r.email);

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BASE_URL}/api/jobs/send-dataroom-upload-notification`,
        {
          method: "POST",
          body: JSON.stringify({
            dataroomId: payload.dataroomId,
            dataroomName: dataroom.name,
            uploaderEmail,
            documentNames,
            linkName,
            ownerEmail: primaryRecipient.email,
            teamMembers: ccRecipients,
            teamId: payload.teamId,
          }),
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.INTERNAL_API_KEY}`,
          },
        },
      );

      if (!response.ok) {
        logger.error("Failed to send dataroom upload notification", {
          dataroomId: payload.dataroomId,
          linkId: payload.linkId,
          error: await response.text(),
        });
        return;
      }

      const { message } = (await response.json()) as { message: string };
      logger.info("Upload notification sent successfully", {
        dataroomId: payload.dataroomId,
        linkId: payload.linkId,
        message,
        uploadCount: recentUploads.length,
      });
    } catch (error) {
      logger.error("Error sending upload notification", {
        dataroomId: payload.dataroomId,
        linkId: payload.linkId,
        error,
      });
    }
  },
});
