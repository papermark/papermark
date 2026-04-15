import { NextApiRequest, NextApiResponse } from "next";

import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { runs } from "@trigger.dev/sdk";
import { waitUntil } from "@vercel/functions";
import { getServerSession } from "next-auth/next";

import prisma from "@/lib/prisma";
import { sendConversationMessageNotificationTask } from "@/lib/trigger/conversation-message-notification";
import { CustomUser } from "@/lib/types";

import {
  CreateConversationInput,
  conversationService,
} from "../lib/api/conversations";
import { messageService } from "../lib/api/messages";

// Route mapping object to handle different paths
const routeHandlers = {
  // GET /api/teams/[teamId]/datarooms/[dataroomId]/conversations
  "GET /": async (req: NextApiRequest, res: NextApiResponse) => {
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const userId = (session.user as CustomUser).id;
    const { teamId, id: dataroomId } = req.query as {
      teamId: string;
      id: string;
    };

    try {
      // For team member/admin view
      const dataroom = await prisma.dataroom.findUnique({
        where: {
          id: dataroomId,
          team: {
            id: teamId,
            users: { some: { userId } },
          },
        },
        select: {
          teamId: true,
        },
      });

      if (!dataroom) {
        return res.status(404).json({ error: "Dataroom not found" });
      }

      const conversations = await prisma.conversation.findMany({
        where: {
          dataroomId,
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
          dataroomDocument: {
            include: {
              document: true,
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

      const formattedConversations = conversations.map((conversation: any) => {
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
          dataroomDocumentName: conversation.dataroomDocumentId
            ? conversation.dataroomDocument.document.name
            : undefined,
          documentPageNumber: conversation.dataroomDocumentId
            ? conversation.documentPageNumber
            : undefined,
          documentVersionNumber: conversation.dataroomDocumentId
            ? conversation.documentVersionNumber
            : undefined,
        };
      });

      return res.status(200).json(formattedConversations);
    } catch (error) {
      console.error("Error getting dataroom conversations:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  },

  // POST /api/teams/[teamId]/datarooms/[dataroomId]/conversations
  "POST /": async (req: NextApiRequest, res: NextApiResponse) => {
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { teamId, id: dataroomId } = req.query as {
      teamId: string;
      id: string;
    };

    const { viewId, viewerId, ...data } =
      req.body as CreateConversationInput & {
        viewId: string;
        viewerId?: string;
      };

    const userId = (session?.user as CustomUser).id;

    try {
      const dataroom = await prisma.dataroom.findUnique({
        where: {
          id: dataroomId,
          team: {
            id: teamId,
            users: { some: { userId } },
          },
        },
      });

      if (!dataroom) {
        return res.status(404).json({ error: "Dataroom not found" });
      }

      // Check if conversations are allowed
      const areAllowed = await conversationService.areConversationsAllowed(
        dataroomId,
        data.linkId,
      );

      if (!areAllowed) {
        return res.status(403).json({
          error: "Conversations are disabled for this dataroom or link",
        });
      }

      // Create the conversation
      const conversation = await conversationService.createConversation({
        dataroomId,
        viewId,
        userId,
        data,
        teamId,
      });

      return res.status(201).json(conversation);
    } catch (error) {
      console.error("Error creating conversation:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  },

  // GET /api/teams/[teamId]/datarooms/[dataroomId]/conversations/summaries
  "GET /summaries": async (req: NextApiRequest, res: NextApiResponse) => {
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const userId = (session.user as CustomUser).id;
    const { teamId, id: dataroomId } = req.query as {
      teamId: string;
      id: string;
    };

    if (!teamId || !dataroomId) {
      return res.status(400).json({ message: "Missing required parameters" });
    }

    try {
      // Check if user has access to the dataroom
      const dataroom = await prisma.dataroom.findUnique({
        where: {
          id: dataroomId,
          team: {
            id: teamId,
            users: {
              some: {
                userId,
              },
            },
          },
        },
      });

      if (!dataroom) {
        return res.status(404).json({ message: "Dataroom not found" });
      }

      // Fetch all conversations for the dataroom with minimal data
      const conversations = await prisma.conversation.findMany({
        where: {
          dataroomId: dataroomId as string,
        },
        select: {
          id: true,
          title: true,
          createdAt: true,
          updatedAt: true,
          participants: {
            select: {
              viewerId: true,
            },
          },
          documentPageNumber: true,
          dataroomDocument: {
            select: {
              document: {
                select: {
                  name: true,
                },
              },
            },
          },
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

      // Get viewer emails
      const viewerIds = conversations.flatMap((conv: any) =>
        conv.participants.map((p: any) => p.viewerId),
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

      // Format the response
      const formattedConversations = conversations.map((conversation: any) => {
        const viewer = viewers.find((v: any) => v.id === conversation.viewerId);

        return {
          id: conversation.id,
          title: conversation.title,
          createdAt: conversation.createdAt,
          updatedAt: conversation.updatedAt,
          viewerId: conversation.viewerId,
          viewerEmail: viewer?.email,
          documentPageNumber: conversation.documentPageNumber,
          dataroomDocument: conversation.dataroomDocument,
          unreadCount: conversation._count.messages,
          lastMessage: conversation.messages[0] || null,
        };
      });

      return res.status(200).json(formattedConversations);
    } catch (error) {
      console.error("Error in conversations/summaries API:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  },

  // GET /api/teams/[teamId]/datarooms/[dataroomId]/conversations/[conversationId]
  "GET /[conversationId]": async (
    req: NextApiRequest,
    res: NextApiResponse,
  ) => {
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const {
      teamId,
      id: dataroomId,
      conversations: [conversationId],
    } = req.query as {
      teamId: string;
      id: string;
      conversations: string[];
    };

    const userId = (session.user as CustomUser).id;

    try {
      const dataroom = await prisma.dataroom.findUnique({
        where: {
          id: dataroomId,
          team: {
            users: { some: { userId } },
          },
        },
      });

      if (!dataroom) {
        return res.status(404).json({ error: "Dataroom not found" });
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
          dataroomDocument: {
            include: {
              document: true,
            },
          },
        },
      });

      if (!conversation) {
        return res.status(404).json({ error: "Conversation not found" });
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
      };

      return res.status(200).json(formattedConversation);
    } catch (error) {
      console.error("Error getting conversation:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  },

  // POST /api/teams/[teamId]/datarooms/[dataroomId]/conversations/[conversationId]/read
  "POST /[conversationId]/read": async (
    req: NextApiRequest,
    res: NextApiResponse,
  ) => {
    // Check authentication
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    try {
      const {
        teamId,
        id: dataroomId,
        conversations: [conversationId],
      } = req.query as {
        teamId: string;
        id: string;
        conversations: string[];
      };

      const userId = (session.user as CustomUser).id;

      // Mark all messages as read
      await conversationService.markConversationAsRead(conversationId, userId);

      return res.status(200).json({ success: true });
    } catch (error) {
      console.error("Error marking conversation as read:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  },

  // POST /api/teams/[teamId]/datarooms/[dataroomId]/conversations/[conversationId]/messages
  "POST /[conversationId]/messages": async (
    req: NextApiRequest,
    res: NextApiResponse,
  ) => {
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const {
      teamId,
      id: dataroomId,
      conversations: [conversationId],
    } = req.query as {
      teamId: string;
      id: string;
      conversations: string[];
    };

    const { content } = req.body as {
      content: string;
    };

    if (!content || content.trim() === "") {
      return res.status(400).json({ error: "Message content is required" });
    }

    const userId = (session?.user as CustomUser).id;

    try {
      const dataroom = await prisma.dataroom.findUnique({
        where: {
          id: dataroomId,
          team: {
            id: teamId,
            users: { some: { userId } },
          },
        },
      });

      if (!dataroom) {
        return res.status(404).json({ error: "Dataroom not found" });
      }

      // Create the message
      const message = await messageService.addMessage({
        conversationId,
        content,
        userId,
      });

      // Get all delayed and queued runs for this dataroom
      const allRuns = await runs.list({
        taskIdentifier: ["send-conversation-message-notification"],
        tag: [`conversation_${conversationId}`],
        status: ["DELAYED", "QUEUED"],
        period: "5m",
      });

      // Cancel any existing unsent notification runs for this dataroom
      await Promise.all(allRuns.data.map((run) => runs.cancel(run.id)));

      waitUntil(
        sendConversationMessageNotificationTask.trigger(
          {
            dataroomId,
            messageId: message.id,
            conversationId,
            senderUserId: userId,
            teamId,
          },
          {
            idempotencyKey: `conversation-notification-${teamId}-${dataroomId}-${conversationId}-${message.id}`,
            tags: [
              `team_${teamId}`,
              `dataroom_${dataroomId}`,
              `conversation_${conversationId}`,
            ],
            delay: new Date(Date.now() + 5 * 60 * 1000), // 5 minute delay
          },
        ),
      );

      return res.status(201).json(message);
    } catch (error) {
      console.error("Error adding message:", error);
      if (
        error instanceof Error &&
        error.message.startsWith("Content cannot be")
      ) {
        return res.status(400).json({ error: error.message });
      }
      return res.status(500).json({ error: "Internal server error" });
    }
  },

  // PUT /api/teams/[teamId]/datarooms/[dataroomId]/conversations/[conversationId]/messages/[messageId]/read
  "PUT /[conversationId]/messages/[messageId]/read": async (
    req: NextApiRequest,
    res: NextApiResponse,
  ) => {
    try {
      const {
        teamId,
        id: dataroomId,
        conversations: [conversationId],
        messageId,
      } = req.query as {
        teamId: string;
        id: string;
        conversations: string[];
        messageId: string;
      };

      const message = await messageService.markMessageAsRead(messageId);

      return res.status(200).json(message);
    } catch (error) {
      console.error("Error marking message as read:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  },

  // PATCH /api/teams/[teamId]/datarooms/[dataroomId]/conversations/[conversationId]/toggle
  "PATCH /[conversationId]/toggle": async (
    req: NextApiRequest,
    res: NextApiResponse,
  ) => {
    const session = await getServerSession(req, res, authOptions);
    if (!session?.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    try {
      const {
        teamId,
        id: dataroomId,
        conversations: [conversationId],
      } = req.query as {
        teamId: string;
        id: string;
        conversations: string[];
      };

      const { enabled } = req.body;

      // TODO: Check if user has permission to update this dataroom

      const dataroom = await conversationService.toggleDataroomConversations(
        dataroomId,
        enabled,
      );

      return res.status(200).json(dataroom);
    } catch (error) {
      console.error("Error toggling dataroom conversations:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  },

  // DELETE /api/teams/[teamId]/datarooms/[dataroomId]/conversations/[conversationId]
  "DELETE /[conversationId]": async (
    req: NextApiRequest,
    res: NextApiResponse,
  ) => {
    const session = await getServerSession(req, res, authOptions);
    if (!session) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const {
      teamId,
      id: dataroomId,
      conversations: [conversationId],
    } = req.query as {
      teamId: string;
      id: string;
      conversations: string[];
    };

    const userId = (session.user as CustomUser).id;

    try {
      // Verify user has access to the dataroom
      const dataroom = await prisma.dataroom.findUnique({
        where: {
          id: dataroomId,
          team: {
            id: teamId,
            users: { some: { userId } },
          },
        },
      });

      if (!dataroom) {
        return res.status(404).json({ error: "Dataroom not found" });
      }

      // Delete the conversation using the service
      await conversationService.deleteConversation(
        conversationId,
        userId,
        dataroomId,
        teamId,
      );

      return res.status(200).json({ success: true });
    } catch (error) {
      console.error("Error deleting conversation:", error);
      if (error instanceof Error) {
        if (error.message === "Conversation not found") {
          return res.status(404).json({ error: "Conversation not found" });
        }
        if (error.message === "Unauthorized to delete this conversation") {
          return res
            .status(403)
            .json({ error: "Unauthorized to delete this conversation" });
        }
      }
      return res.status(500).json({ error: "Internal server error" });
    }
  },
};

// Main handler that will be imported by the catchall route
export async function handleRoute(req: NextApiRequest, res: NextApiResponse) {
  const { method, query } = req;

  // Normalize path - if first segment isn't 'summaries', treat it as conversationId
  let path = "";
  if (Array.isArray(query.conversations)) {
    if (query.conversations[0] === "summaries") {
      path = "summaries";
    } else {
      // Replace the ID with [conversationId]
      path =
        "[conversationId]" +
        (query.conversations.slice(1).length > 0
          ? "/" + query.conversations.slice(1).join("/")
          : "");
    }
  }
  const routeKey = `${method} /${path}`;

  // Find matching handler
  const handler = routeHandlers[routeKey as keyof typeof routeHandlers];

  if (!handler) {
    return res.status(404).json({ error: "API endpoint not found" });
  }

  try {
    return await handler(req, res);
  } catch (error) {
    console.error("API Error:", error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Internal server error",
    });
  }
}
