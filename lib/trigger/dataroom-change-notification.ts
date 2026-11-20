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

    // Folder → parent map for walking a document's ancestor chain. Viewer-side
    // visibility (getFilteredDataroomDocumentIds) treats a document as visible
    // when any ancestor folder grants access, so checking the immediate folder
    // alone would miss documents nested below the granted folder.
    const folders = await prisma.dataroomFolder.findMany({
      where: { dataroomId: payload.dataroomId },
      select: { id: true, parentId: true },
    });
    const folderParentById = new Map<string, string | null>(
      folders.map((folder) => [folder.id, folder.parentId]),
    );

    const accessCache = new Map<string, boolean | null>();

    // Reads one ACL row's canView. Returns null when no row exists so the
    // caller can distinguish "explicitly denied" from "no explicit grant".
    const lookupCanView = async (
      groupId: string | null | undefined,
      permissionGroupId: string | null | undefined,
      itemId: string,
    ): Promise<boolean | null> => {
      if (groupId) {
        const cacheKey = `viewer-group:${groupId}:${itemId}`;
        if (accessCache.has(cacheKey)) {
          return accessCache.get(cacheKey)!;
        }
        const ac = await prisma.viewerGroupAccessControls.findUnique({
          where: {
            groupId_itemId: { groupId, itemId },
          },
          select: { canView: true },
        });
        const result = ac ? ac.canView : null;
        accessCache.set(cacheKey, result);
        return result;
      }

      if (permissionGroupId) {
        const cacheKey = `permission-group:${permissionGroupId}:${itemId}`;
        if (accessCache.has(cacheKey)) {
          return accessCache.get(cacheKey)!;
        }
        const ac = await prisma.permissionGroupAccessControls.findUnique({
          where: {
            groupId_itemId: { groupId: permissionGroupId, itemId },
          },
          select: { canView: true },
        });
        const result = ac ? ac.canView : null;
        accessCache.set(cacheKey, result);
        return result;
      }

      return null;
    };

    // Mirrors the viewer-side visibility rules: the document's own ACL row
    // wins (an explicit deny blocks inherited folder access); without a row
    // the document is visible through a viewable ancestor folder anywhere up
    // the tree. Previously this gated on the immediate folder alone, which
    // skipped documents nested below a granted folder.
    const canViewDocument = async (
      groupId: string | null | undefined,
      permissionGroupId: string | null | undefined,
      doc: { id: string; folderId: string | null },
    ): Promise<boolean> => {
      if (!groupId && !permissionGroupId) {
        return true;
      }

      const docCanView = await lookupCanView(
        groupId,
        permissionGroupId,
        doc.id,
      );
      if (docCanView !== null) {
        return docCanView;
      }

      if (!doc.folderId) {
        // Root-level document without an explicit grant is not visible.
        return false;
      }

      // Walk up the ancestor chain: the nearest folder with an explicit ACL
      // row decides visibility (an explicit deny blocks inherited access from
      // folders higher up). The visited guard protects against malformed
      // parent cycles.
      const visited = new Set<string>();
      let currentFolderId: string | null = doc.folderId;
      while (currentFolderId && !visited.has(currentFolderId)) {
        visited.add(currentFolderId);
        const folderCanView = await lookupCanView(
          groupId,
          permissionGroupId,
          currentFolderId,
        );
        if (folderCanView !== null) {
          return folderCanView;
        }
        currentFolderId = folderParentById.get(currentFolderId) ?? null;
      }

      return false;
    };

    const viewerResults = await Promise.all(
      viewers.map(async (viewer) => {
        // TODO: KNOWN LIMITATION: Only the most recent view (views[0]) is checked for
        // folder access. A viewer with multiple verified links may be
        // incorrectly skipped if views[0]'s link lacks access but another
        // link in viewer.views does grant it via canViewDocument(). The fix
        // is to iterate over all viewer.views and pick any link where
        // canViewDocument(link.groupId, link.permissionGroupId, doc) returns
        // true before deciding to skip.
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
          const hasAccess = await canViewDocument(
            link.groupId,
            link.permissionGroupId,
            doc,
          );
          if (hasAccess) {
            accessibleDocIds.push(doc.id);
          } else {
            logger.info(
              "Skipping document for viewer: link group lacks document access",
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
