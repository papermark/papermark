import { NextApiRequest, NextApiResponse } from "next";

import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { getServerSession } from "next-auth/next";

import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";

import {
  CreateConversationInput,
  conversationService,
} from "@/ee/features/conversations/lib/api/conversations";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const userId = (session.user as CustomUser).id;
  const { teamId, id: documentId } = req.query as {
    teamId: string;
    id: string;
  };

  if (req.method === "GET") {
    try {
      // Verify user has access to the document
      const document = await prisma.document.findUnique({
        where: {
          id: documentId,
          team: {
            id: teamId,
            users: { some: { userId } },
          },
        },
        select: {
          teamId: true,
          name: true,
        },
      });

      if (!document) {
        return res.status(404).json({ error: "Document not found" });
      }

      // Get all links for this document (to find conversations)
      // We get all links, not just those with conversations enabled,
      // because conversations might have been created when enabled but the setting might have changed
      const links = await prisma.link.findMany({
        where: {
          documentId,
        },
        select: {
          id: true,
        },
      });

      const linkIds = links.map((link) => link.id);

      if (linkIds.length === 0) {
        return res.status(200).json([]);
      }

      // Get conversations for all links of this document
      const conversations = await prisma.conversation.findMany({
        where: {
          linkId: {
            in: linkIds,
          },
          teamId: document.teamId, // Ensure conversations belong to the same team
        },
        include: {
          participants: true,
          messages: {
            orderBy: {
              createdAt: "desc",
            },
            take: 1,
            select: {
              content: true,
              createdAt: true,
            },
          },
          link: {
            select: {
              id: true,
              document: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
          _count: {
            select: {
              messages: {
                where: {
                  isRead: false,
                  viewerId: {
                    not: null,
                  },
                },
              },
            },
          },
        },
        orderBy: {
          updatedAt: "desc",
        },
      });

      const viewerIds = conversations.flatMap((conv: any) =>
        conv.participants
          .map((p: any) => p.viewerId)
          .filter((id: any): id is string => id !== null),
      );

      const viewers = await prisma.viewer.findMany({
        where: {
          id: {
            in: viewerIds,
          },
        },
        select: {
          id: true,
          email: true,
        },
      });

      // Filter out conversations where link doesn't exist or doesn't belong to this document
      // This handles edge cases where links might have been deleted
      const validConversations = conversations.filter((conv: any) => {
        if (!conv.linkId) return false;
        if (!conv.link) return false;
        return conv.link.document?.id === documentId;
      });

      const formattedConversations = validConversations.map((conversation: any) => {
        const participants = conversation.participants.map(
          (p: any) => p.viewerId,
        );

        const viewer = viewers.find((v: any) => participants.includes(v.id));

        return {
          id: conversation.id,
          title: conversation.title,
          createdAt: conversation.createdAt,
          updatedAt: conversation.updatedAt,
          viewerId: viewer?.id,
          viewerEmail: viewer?.email,
          unreadCount: conversation._count.messages,
          lastMessage: conversation.messages[0] || null,
          documentName: conversation.link?.document?.name || document.name,
          documentPageNumber: conversation.documentPageNumber,
          documentVersionNumber: conversation.documentVersionNumber,
        };
      });

      return res.status(200).json(formattedConversations);
    } catch (error) {
      console.error("Error getting document conversations:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  if (req.method === "POST") {
    try {
      // Verify user has access to the document
      const document = await prisma.document.findUnique({
        where: {
          id: documentId,
          team: {
            id: teamId,
            users: { some: { userId } },
          },
        },
        select: {
          teamId: true,
        },
      });

      if (!document) {
        return res.status(404).json({ error: "Document not found" });
      }

      const { viewId, viewerId, linkId, ...data } =
        req.body as CreateConversationInput & {
          viewId: string;
          viewerId?: string;
          linkId?: string;
        };

      // If linkId is provided, verify it belongs to this document and has conversations enabled
      if (linkId) {
        const link = await prisma.link.findFirst({
          where: {
            id: linkId,
            documentId,
            enableConversation: true,
          },
        });

        if (!link) {
          return res.status(403).json({
            error: "Link not found or conversations disabled for this link",
          });
        }
      }

      // Create the conversation
      const conversation = await conversationService.createConversation({
        viewId,
        userId,
        data: {
          ...data,
          linkId,
        },
        teamId,
      });

      return res.status(201).json(conversation);
    } catch (error) {
      console.error("Error creating conversation:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}

