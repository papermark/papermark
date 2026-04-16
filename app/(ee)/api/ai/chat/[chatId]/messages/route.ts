import { NextRequest } from "next/server";

import { generateChatTitle } from "@/ee/features/ai/lib/chat/generate-chat-title";
import { getFilteredDataroomDocumentIds } from "@/ee/features/ai/lib/chat/get-filtered-dataroom-document-ids";
import { sendMessage } from "@/ee/features/ai/lib/chat/send-message";
import { validateChatAccess } from "@/ee/features/ai/lib/permissions/validate-chat-access";
import { sendMessageSchema } from "@/ee/features/ai/schemas/chat";
import { authOptions } from "@/lib/auth/auth-options";
import { getServerSession } from "next-auth";

import { getFeatureFlags } from "@/lib/featureFlags";
import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";

/**
 * POST /api/ai/chat/[chatId]/messages
 * Send a message and get streaming response
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { chatId: string } },
) {
  try {
    const { chatId } = params;
    const body = await req.json();
    const validation = sendMessageSchema.safeParse(body);

    if (!validation.success) {
      return new Response(
        JSON.stringify({
          error: "Invalid request body",
          details: validation.error,
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const {
      content,
      filterDocumentId,
      filterDataroomDocumentIds,
    } = validation.data;

    const session = await getServerSession(authOptions);
    const searchParams = req.nextUrl.searchParams;
    const viewerId = searchParams.get("viewerId");

    let userId: string | undefined;

    if (session) {
      userId = (session.user as CustomUser).id;
    }

    // Validate access
    const hasAccess = await validateChatAccess({
      chatId,
      userId,
      viewerId: viewerId || undefined,
    });

    if (!hasAccess) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Get chat details
    const chat = await prisma.chat.findUnique({
      where: { id: chatId },
      include: {
        messages: {
          take: 1,
        },
      },
    });

    if (!chat) {
      return new Response(JSON.stringify({ error: "Chat not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Check if AI feature is enabled for this team
    const features = await getFeatureFlags({ teamId: chat.teamId });
    if (!features.ai) {
      return new Response(
        JSON.stringify({
          error: "AI features are not available for this team",
        }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      );
    }

    if (!chat.vectorStoreId) {
      return new Response(
        JSON.stringify({
          error: "Vector store not available. Please index documents first.",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    if (
      filterDataroomDocumentIds &&
      filterDataroomDocumentIds.length > 0 &&
      !chat.dataroomId
    ) {
      return new Response(
        JSON.stringify({
          error:
            "Dataroom document filters are only allowed for dataroom chats",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    // Generate title from first message if not set
    if (!chat.title && chat.messages.length === 0) {
      const title = await generateChatTitle(content);
      await prisma.chat.update({
        where: { id: chatId },
        data: { title },
      });
    }

    // Get filtered dataroom document IDs based on permissions
    let filteredDataroomDocumentIds: string[] | undefined;

    if (chat.dataroomId && chat.linkId) {
      filteredDataroomDocumentIds = await getFilteredDataroomDocumentIds(
        chat.dataroomId,
        chat.linkId,
      );
    }

    // Send message and get streaming response
    const { result, referencesForStream } = await sendMessage({
      chatId,
      content,
      vectorStoreId: chat.vectorStoreId,
      filteredDataroomDocumentIds,
      filterDocumentId,
      userSelectedDataroomDocumentIds: filterDataroomDocumentIds,
      dataroomId: chat.dataroomId || undefined,
      linkId: chat.linkId || undefined,
    });

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const chunk of result.textStream) {
            controller.enqueue(encoder.encode(chunk));
          }

          const referencesSection = await Promise.race([
            referencesForStream,
            new Promise<string>((resolve) =>
              setTimeout(() => resolve(""), 5000),
            ),
          ]);

          if (referencesSection) {
            controller.enqueue(encoder.encode(referencesSection));
          }

          controller.close();
        } catch (error) {
          console.error("Error streaming AI response:", error);
          controller.error(error);
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  } catch (error) {
    console.error("Error sending message:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
