import { NextApiRequest, NextApiResponse } from "next";

import { LinkAudienceType, LinkType } from "@prisma/client";
import { getServerSession } from "next-auth/next";

import { authOptions } from "@/pages/api/auth/[...nextauth]";

import {
  enforceDataroomMemberScope,
  enforceDocumentMemberScope,
  enforceLinkMemberScope,
} from "@/lib/api/rbac/guard";
import { errorhandler } from "@/lib/errorHandler";
import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";
import { decryptEncrpytedPassword } from "@/lib/utils";

/**
 * POST /api/links/:id/transfer
 *
 * Transfers (re-targets) an existing link to a different document or data room.
 *
 * Historical `View` records are intentionally left untouched: each view keeps
 * the `documentId`/`dataroomId` it was recorded against, so analytics for the
 * previous target stay accurate. The link itself simply starts pointing at the
 * new target going forward. Because views are joined to the link by `linkId`,
 * those historical views continue to surface the (possibly renamed) link name —
 * this is expected and keeps the audit trail intact.
 *
 * Both the source link and the destination target must belong to the current
 * team, and dataroom-scoped members may only transfer between rooms/documents
 * they are assigned to.
 */
export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", ["POST"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).end("Unauthorized");
  }

  const userId = (session.user as CustomUser).id;
  const { id } = req.query as { id: string };
  const { teamId, targetType, targetId } = req.body as {
    teamId?: string;
    targetType?: "DOCUMENT" | "DATAROOM";
    targetId?: string;
  };

  if (!teamId) {
    return res.status(400).json({ error: "Missing teamId." });
  }

  if (targetType !== "DOCUMENT" && targetType !== "DATAROOM") {
    return res.status(400).json({ error: "Invalid target type." });
  }

  if (!targetId || typeof targetId !== "string") {
    return res
      .status(400)
      .json({ error: "A destination document or data room is required." });
  }

  try {
    const teamAccess = await prisma.userTeam.findUnique({
      where: { userId_teamId: { userId, teamId } },
      select: { role: true },
    });
    if (!teamAccess) {
      return res.status(401).end("Unauthorized");
    }

    const existingLink = await prisma.link.findUnique({
      where: {
        id,
        teamId,
      },
      select: {
        id: true,
        linkType: true,
        documentId: true,
        dataroomId: true,
        dataroom: { select: { isFrozen: true } },
      },
    });

    if (!existingLink) {
      return res.status(404).json({ error: "Link not found or unauthorized" });
    }

    // Workflow links are not document/dataroom links and cannot be transferred.
    if (
      existingLink.linkType !== LinkType.DOCUMENT_LINK &&
      existingLink.linkType !== LinkType.DATAROOM_LINK
    ) {
      return res
        .status(400)
        .json({ error: "This link type cannot be transferred." });
    }

    // Source access: scoped members may only act on links inside their rooms.
    const sourceDenied = await enforceLinkMemberScope({
      userId,
      teamId,
      linkId: existingLink.id,
      role: teamAccess.role,
      res,
    });
    if (sourceDenied) return;

    if (existingLink.dataroom?.isFrozen) {
      return res.status(403).json({
        error:
          "This data room is frozen. You cannot transfer links out of a frozen data room.",
      });
    }

    const newLinkType =
      targetType === "DATAROOM"
        ? LinkType.DATAROOM_LINK
        : LinkType.DOCUMENT_LINK;

    const currentTargetId =
      existingLink.linkType === LinkType.DATAROOM_LINK
        ? existingLink.dataroomId
        : existingLink.documentId;
    if (existingLink.linkType === newLinkType && currentTargetId === targetId) {
      return res
        .status(400)
        .json({ error: "The link already points to this target." });
    }

    if (targetType === "DOCUMENT") {
      const destinationDocument = await prisma.document.findUnique({
        where: { id: targetId, teamId },
        select: { id: true },
      });
      if (!destinationDocument) {
        return res
          .status(404)
          .json({ error: "Destination document not found." });
      }

      const destinationDenied = await enforceDocumentMemberScope({
        userId,
        teamId,
        documentId: targetId,
        role: teamAccess.role,
        res,
      });
      if (destinationDenied) return;
    } else {
      const destinationDataroom = await prisma.dataroom.findUnique({
        where: { id: targetId, teamId },
        select: { isFrozen: true },
      });
      if (!destinationDataroom) {
        return res
          .status(404)
          .json({ error: "Destination data room not found." });
      }
      if (destinationDataroom.isFrozen) {
        return res.status(403).json({
          error:
            "This data room is frozen. You cannot transfer links into a frozen data room.",
        });
      }

      const destinationDenied = await enforceDataroomMemberScope({
        userId,
        teamId,
        dataroomId: targetId,
        role: teamAccess.role,
        res,
      });
      if (destinationDenied) return;
    }

    const becomingDocumentLink = newLinkType === LinkType.DOCUMENT_LINK;

    const updatedLink = await prisma.$transaction(async (tx) => {
      // Dataroom-scoped bindings (viewer group, permission group, upload
      // folders) belong to the *previous* data room and must be dropped on any
      // transfer so they cannot leak into the new target.
      const link = await tx.link.update({
        where: { id, teamId },
        data: {
          documentId: targetType === "DOCUMENT" ? targetId : null,
          dataroomId: targetType === "DATAROOM" ? targetId : null,
          linkType: newLinkType,
          groupId: null,
          permissionGroupId: null,
          audienceType: LinkAudienceType.GENERAL,
          uploadFolderIds: [],
          // Document links cannot use these data-room-only capabilities.
          ...(becomingDocumentLink && {
            enableUpload: false,
            isFileRequestOnly: false,
            enableIndexFile: false,
            enableConversation: false,
          }),
        },
        include: {
          customFields: true,
          visitorGroups: { select: { visitorGroupId: true } },
          tags: {
            select: {
              tag: {
                select: {
                  id: true,
                  name: true,
                  color: true,
                  description: true,
                },
              },
            },
          },
          views: { orderBy: { viewedAt: "desc" }, take: 1 },
          _count: { select: { views: true } },
        },
      });

      return link;
    });

    // Refresh the cached link payload (covers both the id and domain routes).
    // Revalidation is best-effort: the transfer already succeeded, so bound the
    // request with a timeout and swallow any failure so a slow or unreachable
    // revalidate endpoint can't stall this response.
    await fetch(
      `${process.env.NEXTAUTH_URL}/api/revalidate?secret=${process.env.REVALIDATE_TOKEN}&linkId=${id}&hasDomain=${
        updatedLink.domainId ? "true" : "false"
      }`,
      { signal: AbortSignal.timeout(5000) },
    ).catch(() => {});

    if (updatedLink.password !== null) {
      updatedLink.password = decryptEncrpytedPassword(updatedLink.password);
    }

    const responseLink = {
      ...updatedLink,
      tags: updatedLink.tags.map((t) => t.tag),
    };

    return res.status(200).json(responseLink);
  } catch (error) {
    errorhandler(error, res);
  }
}
