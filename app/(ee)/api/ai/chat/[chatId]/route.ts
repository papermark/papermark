import { NextRequest, NextResponse } from "next/server";

import { validateChatAccess } from "@/ee/features/ai/lib/permissions/validate-chat-access";
import { authOptions } from "@/lib/auth/auth-options";
import { getServerSession } from "next-auth";

import { getFeatureFlags } from "@/lib/featureFlags";
import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";

/**
 * GET /api/ai/chat/[chatId]
 * Get chat details with messages
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { chatId: string } },
) {
  try {
    const { chatId } = params;
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
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Fetch chat with messages
    const chat = await prisma.chat.findUnique({
      where: { id: chatId },
      include: {
        messages: {
          orderBy: { createdAt: "asc" },
        },
        document: {
          select: {
            id: true,
            name: true,
          },
        },
        dataroom: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!chat) {
      return NextResponse.json({ error: "Chat not found" }, { status: 404 });
    }

    // Check if AI feature is enabled for this team
    const features = await getFeatureFlags({ teamId: chat.teamId });
    if (!features.ai) {
      return NextResponse.json(
        { error: "AI features are not available for this team" },
        { status: 403 },
      );
    }

    return NextResponse.json(chat);
  } catch (error) {
    console.error("Error fetching chat:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/ai/chat/[chatId]
 * Delete a chat
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: { chatId: string } },
) {
  try {
    const { chatId } = params;
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = (session.user as CustomUser).id;

    // Validate ownership
    const hasAccess = await validateChatAccess({
      chatId,
      userId,
    });

    if (!hasAccess) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Verify user owns this chat
    const chat = await prisma.chat.findUnique({
      where: { id: chatId },
    });

    if (!chat || chat.userId !== userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if AI feature is enabled for this team
    const features = await getFeatureFlags({ teamId: chat.teamId });
    if (!features.ai) {
      return NextResponse.json(
        { error: "AI features are not available for this team" },
        { status: 403 },
      );
    }

    // Delete chat (messages will cascade)
    await prisma.chat.delete({
      where: { id: chatId },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting chat:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
