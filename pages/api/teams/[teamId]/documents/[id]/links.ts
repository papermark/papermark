import { NextApiRequest, NextApiResponse } from "next";

import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { getServerSession } from "next-auth/next";

import { enforceDocumentMemberScope } from "@/lib/api/rbac/guard";
import { errorhandler } from "@/lib/errorHandler";
import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";
import { decryptEncrpytedPassword, log } from "@/lib/utils";

export default async function handle(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "GET") {
    // GET /api/teams/:teamId/documents/:id/links
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      return res.status(401).end("Unauthorized");
    }

    const { teamId, id: docId } = req.query as { teamId: string; id: string };
    const userId = (session.user as CustomUser).id;

    if (
      await enforceDocumentMemberScope({ userId, teamId, documentId: docId, res })
    ) {
      return;
    }

    try {
      // First, ensure the requester belongs to the team
      const teamHasUser = await prisma.team.findFirst({
        where: { id: teamId, users: { some: { userId } } },
        select: { id: true },
      });
      if (!teamHasUser) {
        return res.status(401).end("Unauthorized");
      }
      // Then check if document has any links to avoid expensive query
      const document = await prisma.document.findUnique({
        where: {
          id: docId,
          teamId,
        },
        select: {
          id: true,
          ownerId: true,
          _count: {
            select: {
              links: true,
            },
          },
        },
      });

      if (!document) {
        return res.status(404).json({ error: "Document not found" });
      }

      // Early return for documents with no links
      if (document._count.links === 0) {
        return res.status(200).json([]);
      }

      // Only fetch full link data if we have links (target only this document)
      // Optimized: Only fetch the most recent view per link instead of all views
      const docWithLinks = await prisma.document.findUnique({
        where: { id: docId, teamId },
        select: {
          id: true,
          ownerId: true,
          links: {
            where: { deletedAt: null }, // exclude deleted links
            orderBy: { createdAt: "desc" },
            include: {
              // Only fetch the most recent view (needed for "last viewed" display)
              views: {
                orderBy: { viewedAt: "desc" },
                take: 1,
              },
              feedback: { select: { id: true, data: true } },
              customFields: {
                select: {
                  orderIndex: true,
                  label: true,
                  identifier: true,
                  placeholder: true,
                  type: true,
                  required: true,
                },
                orderBy: { orderIndex: "asc" },
              },
              visitorGroups: {
                select: { visitorGroupId: true },
              },
              _count: { select: { views: true } },
            },
          },
        },
      });

      const links = docWithLinks!.links;

      // Early return if no links found
      if (!links || links.length === 0) {
        return res.status(200).json([]);
      }

      // Collect all link IDs for batch tag query
      const linkIds = links.map((link) => link.id);

      // Batch fetch all tags for all links in a single query (fixes N+1 problem)
      const tagItems = await prisma.tagItem.findMany({
        where: {
          linkId: { in: linkIds },
          itemType: "LINK_TAG",
        },
        select: {
          linkId: true,
          tag: {
            select: {
              id: true,
              name: true,
              color: true,
              description: true,
            },
          },
        },
      });

      // Group tags by linkId for O(1) lookup
      const tagsByLinkId = tagItems.reduce(
        (acc, item) => {
          if (item.linkId) {
            if (!acc[item.linkId]) {
              acc[item.linkId] = [];
            }
            acc[item.linkId].push(item.tag);
          }
          return acc;
        },
        {} as Record<string, (typeof tagItems)[0]["tag"][]>,
      );

      // Map links with decrypted passwords and tags
      const linksWithTags = links.map((link) => {
        // Decrypt the password if it exists
        const decryptedPassword =
          link.password !== null
            ? decryptEncrpytedPassword(link.password)
            : null;

        return {
          ...link,
          password: decryptedPassword,
          tags: tagsByLinkId[link.id] || [],
        };
      });

      return res.status(200).json(linksWithTags);
    } catch (error) {
      log({
        message: `Failed to get links for document: _${docId}_. \n\n ${error} \n\n*Metadata*: \`{teamId: ${teamId}, userId: ${userId}}\``,
        type: "error",
      });
      errorhandler(error, res);
    }
  } else {
    // We only allow GET requests
    res.setHeader("Allow", ["GET"]);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
