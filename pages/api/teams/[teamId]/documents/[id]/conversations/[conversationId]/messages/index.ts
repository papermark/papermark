import { NextApiRequest, NextApiResponse } from "next";

import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { waitUntil } from "@vercel/functions";
import { getServerSession } from "next-auth/next";

import prisma from "@/lib/prisma";
import { sendConversationMessageNotificationTask } from "@/lib/trigger/conversation-message-notification";
import { CustomUser } from "@/lib/types";

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

  if (req.method === "POST") {
    try {
      const { content } = req.body as { content: string };

      if (!content || !content.trim()) {
        return res.status(400).json({ error: "Message content is required" });
      }

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

      // Create the message
      const message = await messageService.createMessage({
        conversationId,
        content: content.trim(),
        userId,
      });

      // Send notification asynchronously
      waitUntil(
        sendConversationMessageNotificationTask.trigger({
          conversationId,
          messageId: message.id,
          senderId: userId,
        }),
      );

      return res.status(201).json(message);
    } catch (error) {
      console.error("Error creating message:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}

