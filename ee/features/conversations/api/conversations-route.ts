import { NextApiRequest, NextApiResponse } from "next";

import { runs } from "@trigger.dev/sdk";
import { waitUntil } from "@vercel/functions";

import prisma from "@/lib/prisma";

import {
  CreateConversationInput,
  conversationService,
} from "../lib/api/conversations";
import { messageService } from "../lib/api/messages";
import { notificationService } from "../lib/api/notifications";
import { sendConversationTeamMemberNotificationTask } from "../lib/trigger/conversation-message-notification";

// Route mapping object to handle different paths
const routeHandlers = {
  // GET /api/conversations
  "GET /": async (req: NextApiRequest, res: NextApiResponse) => {
    // Handle listing conversations
    const { dataroomId, linkId, viewerId } = req.query as {
      dataroomId?: string;
      linkId?: string;
      viewerId?: string;
    };

    if (!dataroomId && !linkId) {
      return res.status(400).json({ error: "Missing dataroomId or linkId" });
    }

    // For datarooms, viewerId is required
    if (dataroomId && !viewerId) {
      return res.status(400).json({ error: "Missing viewerId" });
    }

    // For document links, show all conversations (public) if no viewerId
    // Otherwise show only conversations where the viewer is a participant
    const conversations = await prisma.conversation.findMany({
      where: {
        ...(dataroomId ? { dataroomId } : { linkId }),
        ...(viewerId
          ? {
              participants: {
                some: {
                  viewerId,
                },
              },
            }
          : {
              // For document links without viewerId, show all conversations
              // (they can be filtered by visibility mode if needed)
            }),
      },
      include: {
        messages: {
          orderBy: {
            createdAt: "asc",
          },
        },
        dataroom: true,
        dataroomDocument: {
          include: {
            document: true,
          },
        },
        participants: viewerId
          ? {
              where: {
                viewerId,
              },
              select: {
                receiveNotifications: true,
              },
              take: 1,
            }
          : {
              select: {
                receiveNotifications: true,
              },
              take: 1,
            },
      },
      orderBy: {
        updatedAt: "desc",
      },
    });

    const conversationsWithNotifications = conversations.map(
      (conversation) => ({
        ...conversation,
        receiveNotifications: conversation.participants[0]?.receiveNotifications ?? false,
      }),
    );

    return res.status(200).json(conversationsWithNotifications);
  },

  // POST /api/conversations
  "POST /": async (req: NextApiRequest, res: NextApiResponse) => {
    let { dataroomId, viewId, viewerId, documentId, pageNumber, linkId, ...data } =
      req.body as CreateConversationInput & {
        dataroomId?: string;
        viewId: string;
        viewerId?: string;
        documentId?: string;
        pageNumber?: number;
        linkId?: string;
      };

    // Get team from either dataroom or link first (needed for anonymous viewer creation)
    let team;
    if (dataroomId) {
      // Check if conversations are allowed for dataroom
      const areAllowed = await conversationService.areConversationsAllowed(
        dataroomId,
        linkId,
      );

      if (!areAllowed) {
        return res.status(403).json({
          error: "Conversations are disabled for this dataroom or link",
        });
      }

      team = await prisma.team.findFirst({
        where: {
          datarooms: {
            some: {
              id: dataroomId,
            },
          },
        },
        select: {
          id: true,
        },
      });
    } else if (linkId) {
      // For document links, check link.enableConversation and get team from link
      const link = await prisma.link.findUnique({
        where: { id: linkId },
        select: {
          enableConversation: true,
          teamId: true,
          document: {
            select: {
              teamId: true,
            },
          },
        },
      });

      if (!link || !link.enableConversation) {
        return res.status(403).json({
          error: "Conversations are disabled for this link",
        });
      }

      team = await prisma.team.findUnique({
        where: { id: link.teamId || link.document?.teamId },
        select: {
          id: true,
        },
      });
    }

    if (!team) {
      return res.status(400).json({ error: "Team not found" });
    }

    // For document links, create anonymous viewer if viewerId is not provided
    if (!viewerId && !dataroomId) {
      // Get IP address from request for anonymous viewer creation
      const ipAddress = req.headers["x-forwarded-for"] || req.headers["x-real-ip"] || req.socket.remoteAddress || "unknown";
      const anonymousEmail = `anonymous-${String(ipAddress).replace(/\./g, '-')}-${Date.now()}@anonymous.papermark.com`;
      
      // Create anonymous viewer
      const anonymousViewer = await prisma.viewer.create({
        data: {
          email: anonymousEmail,
          verified: false,
          teamId: team.id,
        },
        select: { id: true },
      });
      
      // Use the anonymous viewer ID
      viewerId = anonymousViewer.id;
    } else if (!viewerId && dataroomId) {
      return res.status(400).json({ error: "Viewer is required" });
    }

    // Map documentId to dataroomDocumentId and get version info if provided
    // Make sure linkId is included in enhancedData (it was extracted earlier)
    let enhancedData = { ...data, linkId };
    if (documentId) {
      if (dataroomId) {
        // For dataroom documents
        const dataroomDocument = await prisma.dataroomDocument.findFirst({
          where: {
            dataroomId,
            documentId,
          },
          include: {
            document: {
              include: {
                versions: {
                  where: { isPrimary: true },
                  select: { versionNumber: true },
                },
              },
            },
          },
        });

        if (dataroomDocument) {
          enhancedData.dataroomDocumentId = dataroomDocument.id;

          // Set page number if provided
          if (pageNumber) {
            enhancedData.documentPageNumber = pageNumber;
          }

          // Set document version number from the primary version
          if (dataroomDocument.document.versions[0]?.versionNumber) {
            enhancedData.documentVersionNumber =
              dataroomDocument.document.versions[0].versionNumber;
          }
        }
      } else {
        // For document links, get version info directly from document
        const document = await prisma.document.findUnique({
          where: { id: documentId },
          include: {
            versions: {
              where: { isPrimary: true },
              select: { versionNumber: true },
            },
          },
        });

        if (document) {
          // Set page number if provided
          if (pageNumber) {
            enhancedData.documentPageNumber = pageNumber;
          }

          // Set document version number from the primary version
          if (document.versions[0]?.versionNumber) {
            enhancedData.documentVersionNumber =
              document.versions[0].versionNumber;
          }
        }
      }
    }

    // Create the conversation
    const conversation = await conversationService.createConversation({
      dataroomId: dataroomId || undefined,
      viewerId,
      viewId,
      teamId: team.id,
      data: enhancedData,
    });

    // Get all delayed and queued runs for this dataroom
    const allRuns = await runs.list({
      taskIdentifier: ["send-conversation-team-member-notification"],
      tag: [`conversation_${conversation.id}`],
      status: ["DELAYED", "QUEUED"],
      period: "5m",
    });

    // Cancel any existing unsent notification runs for this dataroom
    await Promise.all(allRuns.data.map((run) => runs.cancel(run.id)));

    if (dataroomId) {
      waitUntil(
        sendConversationTeamMemberNotificationTask.trigger(
          {
            dataroomId,
            messageId: conversation.messages[0].id,
            conversationId: conversation.id,
            senderUserId: viewerId,
            teamId: team.id,
          },
          {
            idempotencyKey: `conversation-notification-${team.id}-${dataroomId}-${conversation.id}-${conversation.messages[0].id}`,
            tags: [
              `team_${team.id}`,
              `dataroom_${dataroomId}`,
              `conversation_${conversation.id}`,
            ],
            delay: new Date(Date.now() + 5 * 60 * 1000), // 5 minute delay
          },
        ),
      );
    }

    return res.status(201).json(conversation);
  },

  // POST /api/conversations/messages
  "POST /messages": async (req: NextApiRequest, res: NextApiResponse) => {
    const { content, viewId, viewerId, conversationId } = req.body as {
      content: string;
      viewId: string;
      viewerId: string;
      conversationId: string;
    };

    if (!content || content.trim() === "") {
      return res.status(400).json({ error: "Message content is required" });
    }

    // Create the message
    const message = await messageService.addMessage({
      conversationId,
      content,
      viewId,
      viewerId,
    });

    // Get all delayed and queued runs for this conversation
    const allRuns = await runs.list({
      taskIdentifier: ["send-conversation-team-member-notification"],
      tag: [`conversation_${message.conversationId}`],
      status: ["DELAYED", "QUEUED"],
      period: "5m",
    });

    // Cancel any existing unsent notification runs for this conversation
    await Promise.all(allRuns.data.map((run) => runs.cancel(run.id)));

    if (message.conversation.dataroomId) {
      waitUntil(
        sendConversationTeamMemberNotificationTask.trigger(
          {
            dataroomId: message.conversation.dataroomId,
            messageId: message.id,
            conversationId: message.conversationId,
            senderUserId: viewerId,
            teamId: message.conversation.teamId,
          },
          {
            idempotencyKey: `conversation-notification-${message.conversation.teamId}-${message.conversation.dataroomId}-${message.conversationId}-${message.id}`,
            tags: [
              `team_${message.conversation.teamId}`,
              `dataroom_${message.conversation.dataroomId}`,
              `conversation_${message.conversationId}`,
            ],
            delay: new Date(Date.now() + 5 * 60 * 1000), // 5 minute delay
          },
        ),
      );
    }

    return res.status(201).json(message);
  },

  // POST /api/conversations/notifications
  "POST /notifications": async (req: NextApiRequest, res: NextApiResponse) => {
    const { enabled, viewerId, conversationId } = req.body as {
      enabled: boolean;
      viewerId: string;
      conversationId: string;
    };

    await notificationService.toggleNotificationsForConversation({
      conversationId,
      viewerId,
      enabled,
    });

    return res.status(200).json({ success: true });
  },
};

// Main handler that will be imported by the catchall route
export async function handleRoute(req: NextApiRequest, res: NextApiResponse) {
  const { method, query } = req;

  // Construct route key from method and path
  const path = Array.isArray(query.conversations)
    ? query.conversations.join("/")
    : "";
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
