import { ConversationVisibility, ParticipantRole } from "@prisma/client";

import prisma from "@/lib/prisma";
import { validateContent } from "@/lib/utils/sanitize-html";

export type CreateConversationInput = {
  title?: string;
  dataroomDocumentId?: string;
  documentPageNumber?: number;
  documentVersionNumber?: number;
  linkId?: string;
  viewerGroupId?: string;
  initialMessage?: string;
};

export const conversationService = {
  // Check if conversations are allowed for a link/dataroom
  async areConversationsAllowed(
    dataroomId: string,
    linkId?: string,
  ): Promise<boolean> {
    // Get dataroom settings
    const dataroom = await prisma.dataroom.findUnique({
      where: { id: dataroomId },
      select: { conversationsEnabled: true },
    });

    if (!dataroom?.conversationsEnabled) {
      return false;
    }

    // If link is specified, check link-specific settings
    if (linkId) {
      const link = await prisma.link.findUnique({
        where: { id: linkId },
        select: { enableConversation: true },
      });

      return !!link?.enableConversation;
    }

    return true;
  },

  // Create a new conversation
  async createConversation({
    dataroomId,
    viewId,
    data,
    teamId,
    viewerId,
    userId,
  }: {
    dataroomId?: string;
    viewId: string;
    data: CreateConversationInput;
    teamId: string;
    viewerId?: string;
    userId?: string;
  }) {
    // Only one of viewerId or userId should be provided
    if ((!viewerId && !userId) || (viewerId && userId)) {
      throw new Error(
        "Either viewerId or userId must be provided, but not both",
      );
    }

    const sanitizedInitialMessage = validateContent(data.initialMessage || "");

    return prisma.conversation.create({
      data: {
        title: data.title || sanitizedInitialMessage.slice(0, 20),
        ...(dataroomId ? { dataroomId } : {}),
        teamId,
        dataroomDocumentId: data.dataroomDocumentId,
        documentPageNumber: data.documentPageNumber,
        documentVersionNumber: data.documentVersionNumber,
        linkId: data.linkId,
        viewerGroupId: data.viewerGroupId,
        initialViewId: viewId,
        visibilityMode: "PRIVATE" as ConversationVisibility,
        lastMessageAt: new Date(),
        participants: {
          create: {
            viewerId,
            userId,
            role: "OWNER" as ParticipantRole,
            receiveNotifications: true,
          },
        },
        messages: data.initialMessage
          ? {
              create: {
                content: sanitizedInitialMessage,
                viewerId,
                userId,
                viewId,
              },
            }
          : undefined,
        views: {
          create: {
            viewId,
          },
        },
      },
      include: {
        participants: true,
        messages: true,
        views: true,
        ...(dataroomId ? { dataroom: true } : {}),
        dataroomDocument: {
          include: {
            document: true,
          },
        },
      },
    });
  },

  // Get conversations for a dataroom
  async getConversationsForDataroom({
    dataroomId,
    viewerId,
    userId,
    includeMessages = false,
  }: {
    dataroomId: string;
    viewerId?: string;
    userId?: string;
    includeMessages?: boolean;
  }) {
    // Different queries for admin vs viewer
    if (userId) {
      // Admin/team member can see all conversations for the dataroom
      return prisma.conversation.findMany({
        where: {
          dataroomId,
        },
        include: {
          participants: true,
          messages: includeMessages,
          dataroom: true,
          dataroomDocument: {
            include: {
              document: true,
            },
          },
        },
        orderBy: {
          updatedAt: "desc",
        },
      });
    } else if (viewerId) {
      // Viewer can only see their own private conversations and public ones
      return prisma.conversation.findMany({
        where: {
          dataroomId,
          OR: [
            // Private conversations where they are a participant
            {
              visibilityMode: "PRIVATE",
              participants: {
                some: {
                  viewerId,
                },
              },
            },
            // Public conversations
            {
              visibilityMode: {
                in: ["PUBLIC_LINK", "PUBLIC_DOCUMENT", "PUBLIC_DATAROOM"],
              },
            },
          ],
        },
        include: {
          participants: true,
          messages: includeMessages,
          dataroom: true,
          dataroomDocument: {
            include: {
              document: true,
            },
          },
        },
        orderBy: {
          updatedAt: "desc",
        },
      });
    }

    return [];
  },

  // Toggle conversation enabled status for dataroom
  async toggleDataroomConversations(dataroomId: string, enabled: boolean) {
    return prisma.dataroom.update({
      where: { id: dataroomId },
      data: { conversationsEnabled: enabled },
    });
  },

  // Toggle conversation enabled status for link
  async toggleLinkConversations(linkId: string, enabled: boolean) {
    return prisma.link.update({
      where: { id: linkId },
      data: { enableConversation: enabled },
    });
  },

  // Get a single conversation with messages
  async getConversation(
    conversationId: string,
    viewerId?: string,
    userId?: string,
  ) {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
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
        dataroom: true,
        dataroomDocument: true,
      },
    });

    if (!conversation) {
      return null;
    }

    // Check permissions
    if (userId) {
      // Team members can access all conversations in their datarooms
      // You might want to add a check here to ensure the user has access to this dataroom
      return conversation;
    } else if (viewerId) {
      // Viewers can only access conversations they're part of or public ones
      const canAccess =
        conversation.visibilityMode !== "PRIVATE" ||
        conversation.participants.some((p) => p.viewerId === viewerId);

      if (!canAccess) {
        return null;
      }

      return conversation;
    }

    return null;
  },

  // Mark all messages in a conversation as read
  async markConversationAsRead(conversationId: string, userId: string) {
    // Get conversation to verify access
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        messages: {
          where: {
            isRead: false,
            viewerId: { not: null }, // Only mark viewer messages as read
          },
          select: {
            id: true,
          },
        },
      },
    });

    if (!conversation) {
      throw new Error("Conversation not found");
    }

    // Mark all unread messages as read
    if (conversation.messages.length > 0) {
      await prisma.message.updateMany({
        where: {
          id: {
            in: conversation.messages.map((m) => m.id),
          },
        },
        data: {
          isRead: true,
        },
      });
    }

    return { success: true, markedCount: conversation.messages.length };
  },

  // Delete a conversation and all related data
  async deleteConversation(
    conversationId: string,
    userId: string,
    dataroomId: string,
    teamId: string,
  ) {
    // First verify the conversation exists and user has access
    const conversation = await prisma.conversation.findUnique({
      where: {
        id: conversationId,
        dataroomId,
        teamId,
        team: { users: { some: { userId } } },
      },
    });

    if (!conversation) {
      throw new Error("Conversation not found");
    }

    // Delete the conversation (cascade will handle related data like messages, participants, etc.)
    await prisma.conversation.delete({
      where: { id: conversationId },
    });

    return { success: true };
  },
};
