import { NextApiRequest, NextApiResponse } from "next";

import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { getServerSession } from "next-auth/next";

import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";

import { conversationService } from "@/ee/features/conversations/lib/api/conversations";

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

      // Mark all messages as read
      await conversationService.markConversationAsRead(conversationId, userId);

      return res.status(200).json({ success: true });
    } catch (error) {
      console.error("Error marking conversation as read:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}

