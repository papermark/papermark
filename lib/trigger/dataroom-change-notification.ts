import { logger, schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";

import prisma from "@/lib/prisma";
import { queueNotification } from "@/lib/redis/dataroom-notification-queue";
import { ZViewerNotificationPreferencesSchema } from "@/lib/zod/schemas/notifications";

const NotificationPayloadSchema = z.object({
  dataroomId: z.string().cuid(),
  dataroomDocumentIds: z.array(z.string().cuid()).min(1),
  senderUserId: z.string().cuid().nullable(),
  teamId: z.string().cuid(),
  excludeViewerId: z.string().cuid().optional(),
});

export const sendDataroomChangeNotificationTask = schemaTask({
  id: "send-dataroom-change-notification",
  schema: NotificationPayloadSchema,
  retry: { maxAttempts: 3 },
  run: async (payload) => {
    const dataroomDocuments = await prisma.dataroomDocument.findMany({
      where: {
        id: { in: payload.dataroomDocumentIds },
        dataroomId: payload.dataroomId,
      },
      select: { id: true, folderId: true },
    });

    if (dataroomDocuments.length === 0) {
      logger.error("Dataroom documents not found", {
        dataroomDocumentIds: payload.dataroomDocumentIds,
      });
      return;
    }

    const viewers = await prisma.viewer.findMany({
      where: {
        teamId: payload.teamId,
        ...(payload.excludeViewerId && {
          id: { not: payload.excludeViewerId },
        }),
        views: {
          some: {
            dataroomId: payload.dataroomId,
            viewType: "DATAROOM_VIEW",
            verified: true,
          },
        },
      },
      select: {
        id: true,
        notificationPreferences: true,
        views: {
          where: {
            dataroomId: payload.dataroomId,
            viewType: "DATAROOM_VIEW",
            verified: true,
          },
          orderBy: {
            viewedAt: "desc",
          },
          take: 1,
          include: {
            link: {
              select: {
                id: true,
                slug: true,
                domainSlug: true,
                domainId: true,
                isArchived: true,
                expiresAt: true,
                groupId: true,
                permissionGroupId: true,
              },
            },
          },
        },
      },
    });

    if (!viewers || viewers.length === 0) {
      logger.info("No verified viewers found for this dataroom", {
        dataroomId: payload.dataroomId,
      });
      return;
    }

    const folderAccessCache = new Map<string, boolean>();

    const canViewFolder = async (
      groupId: string | null | undefined,
      permissionGroupId: string | null | undefined,
      folderId: string | null,
    ): Promise<boolean> => {
      if (!groupId && !permissionGroupId) {
        return true;
      }

      if (!folderId) {
        return true;
      }

      if (groupId) {
        const cacheKey = `viewer-group:${groupId}:${folderId}`;
        if (folderAccessCache.has(cacheKey)) {
          return folderAccessCache.get(cacheKey)!;
        }
        const ac = await prisma.viewerGroupAccessControls.findUnique({
          where: {
            groupId_itemId: { groupId, itemId: folderId },
          },
          select: { canView: true },
        });
        const result = ac?.canView === true;
        folderAccessCache.set(cacheKey, result);
        return result;
      }

      if (permissionGroupId) {
        const cacheKey = `permission-group:${permissionGroupId}:${folderId}`;
        if (folderAccessCache.has(cacheKey)) {
          return folderAccessCache.get(cacheKey)!;
        }
        const ac = await prisma.permissionGroupAccessControls.findUnique({
          where: {
            groupId_itemId: { groupId: permissionGroupId, itemId: folderId },
          },
          select: { canView: true },
        });
        const result = ac?.canView === true;
        folderAccessCache.set(cacheKey, result);
        return result;
      }

      return false;
    };

    const viewerResults = await Promise.all(
      viewers.map(async (viewer) => {
        // TODO: KNOWN LIMITATION: Only the most recent view (views[0]) is checked for
        // folder access. A viewer with multiple verified links may be
        // incorrectly skipped if views[0]'s link lacks access but another
        // link in viewer.views does grant it via canViewFolder(). The fix is
        // to iterate over all viewer.views and pick any link where
        // canViewFolder(link.groupId, link.permissionGroupId) returns true
        // for dataroomDocument.folderId before deciding to skip.
        const view = viewer.views[0];
        const link = view?.link;

        if (
          !link ||
          link.isArchived ||
          (link.expiresAt && new Date(link.expiresAt) < new Date())
        ) {
          return null;
        }

        const accessibleDocIds: string[] = [];
        for (const doc of dataroomDocuments) {
          const hasAccess = await canViewFolder(
            link.groupId,
            link.permissionGroupId,
            doc.folderId,
          );
          if (hasAccess) {
            accessibleDocIds.push(doc.id);
          } else {
            logger.info(
              "Skipping document for viewer: link group lacks folder access",
              {
                viewerId: viewer.id,
                linkId: link.id,
                dataroomDocumentId: doc.id,
                folderId: doc.folderId,
              },
            );
          }
        }

        if (accessibleDocIds.length === 0) {
          return null;
        }

        const parsedPreferences =
          ZViewerNotificationPreferencesSchema.safeParse(
            viewer.notificationPreferences,
          );

        if (
          parsedPreferences.success &&
          parsedPreferences.data.dataroom[payload.dataroomId]?.enabled === false
        ) {
          return null;
        }

        const frequency = parsedPreferences.success
          ? (parsedPreferences.data.dataroom[payload.dataroomId]?.frequency ??
            "instant")
          : "instant";

        let linkUrl = "";
        if (link.domainId && link.domainSlug && link.slug) {
          linkUrl = `https://${link.domainSlug}/${link.slug}`;
        } else {
          linkUrl = `${process.env.NEXT_PUBLIC_MARKETING_URL}/view/${link.id}`;
        }

        return {
          id: viewer.id,
          linkUrl,
          frequency,
          accessibleDocIds,
        };
      }),
    );

    const viewersWithLinks = viewerResults.filter(
      (
        viewer,
      ): viewer is {
        id: string;
        linkUrl: string;
        frequency: "instant" | "daily" | "weekly";
        accessibleDocIds: string[];
      } => viewer !== null,
    );

    logger.info("Processed viewer links", {
      viewerCount: viewersWithLinks.length,
      documentCount: dataroomDocuments.length,
    });

    for (const viewer of viewersWithLinks) {
      try {
        if (viewer.frequency === "daily" || viewer.frequency === "weekly") {
          for (const docId of viewer.accessibleDocIds) {
            await queueNotification({
              frequency: viewer.frequency,
              viewerId: viewer.id,
              dataroomId: payload.dataroomId,
              teamId: payload.teamId,
              dataroomDocumentId: docId,
              senderUserId: payload.senderUserId,
            });
          }

          logger.info("Queued notifications for digest", {
            viewerId: viewer.id,
            frequency: viewer.frequency,
            documentCount: viewer.accessibleDocIds.length,
          });
          continue;
        }

        const response = await fetch(
          `${process.env.NEXT_PUBLIC_BASE_URL}/api/jobs/send-dataroom-new-document-notification`,
          {
            method: "POST",
            body: JSON.stringify({
              dataroomId: payload.dataroomId,
              linkUrl: viewer.linkUrl,
              dataroomDocumentIds: viewer.accessibleDocIds,
              viewerId: viewer.id,
              senderUserId: payload.senderUserId,
              teamId: payload.teamId,
            }),
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${process.env.INTERNAL_API_KEY}`,
            },
          },
        );

        if (!response.ok) {
          logger.error("Failed to send dataroom notification", {
            viewerId: viewer.id,
            dataroomId: payload.dataroomId,
            error: await response.text(),
          });
          continue;
        }

        const { message } = (await response.json()) as { message: string };
        logger.info("Notification sent successfully", {
          viewerId: viewer.id,
          message,
          documentCount: viewer.accessibleDocIds.length,
        });
      } catch (error) {
        logger.error("Error sending notification", {
          viewerId: viewer.id,
          error,
        });
      }
    }

    logger.info("Completed sending notifications", {
      dataroomId: payload.dataroomId,
      viewerCount: viewers.length,
      documentCount: dataroomDocuments.length,
    });
    return;
  },
});
