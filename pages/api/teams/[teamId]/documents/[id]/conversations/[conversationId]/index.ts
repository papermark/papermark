import { NextApiRequest, NextApiResponse } from "next";

import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { getServerSession } from "next-auth/next";

import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";

import { conversationService } from "@/ee/features/conversations/lib/api/conversations";
import { messageService } from "@/ee/features/conversations/lib/api/messages";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const userId = (session.user as CustomUser).id;
  const {
    teamId,
    id: documentId,
    conversationId,
  } = req.query as {
    teamId: string;
    id: string;
    conversationId: string;
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
      });

      if (!document) {
        return res.status(404).json({ error: "Document not found" });
      }

      const conversation = await prisma.conversation.findUnique({
        where: {
          id: conversationId,
        },
        include: {
          participants: true,
          messages: {
            orderBy: {
              createdAt: "asc",
            },
            include: {
              user: true,
              viewer: true,
            },
          },
          link: {
            select: {
              document: {
                select: {
                  name: true,
                },
              },
            },
          },
        },
      });

      if (!conversation) {
        return res.status(404).json({ error: "Conversation not found" });
      }

      // Verify conversation belongs to a link of this document
      if (conversation.linkId) {
        const link = await prisma.link.findUnique({
          where: { id: conversation.linkId },
          select: { documentId: true },
        });

        if (!link || link.documentId !== documentId) {
          return res.status(403).json({
            error: "Conversation does not belong to this document",
          });
        }
      }

      let viewers: { id: string; email: string | null }[] = [];
      let users: { id: string; email: string | null }[] = [];
      if (conversation.participants) {
        const viewerIds = conversation.participants
          .map((p) => p.viewerId)
          .filter((id): id is string => id !== null);

        viewers = await prisma.viewer.findMany({
          where: {
            id: { in: viewerIds },
          },
          select: {
            id: true,
            email: true,
          },
        });

        const userIds = conversation.participants
          .map((p) => p.userId)
          .filter((id): id is string => id !== null);

        users = await prisma.user.findMany({
          where: {
            id: { in: userIds },
          },
          select: {
            id: true,
            email: true,
          },
        });
      }

      const formattedConversation = {
        ...conversation,
        participants: [...viewers, ...users],
        documentName: conversation.link?.document?.name || document.name,
      };

      return res.status(200).json(formattedConversation);
    } catch (error) {
      console.error("Error getting conversation:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  if (req.method === "DELETE") {
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
      });

      if (!document) {
        return res.status(404).json({ error: "Document not found" });
      }

      const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { linkId: true },
      });

      if (!conversation) {
        return res.status(404).json({ error: "Conversation not found" });
      }

      // Verify conversation belongs to a link of this document
      if (conversation.linkId) {
        const link = await prisma.link.findUnique({
          where: { id: conversation.linkId },
          select: { documentId: true },
        });

        if (!link || link.documentId !== documentId) {
          return res.status(403).json({
            error: "Conversation does not belong to this document",
          });
        }
      }

      await prisma.conversation.delete({
        where: { id: conversationId },
      });

      return res.status(200).json({ success: true });
    } catch (error) {
      console.error("Error deleting conversation:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}

