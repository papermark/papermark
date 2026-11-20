import { NextRequest, NextResponse } from "next/server";

import { createChat } from "@/ee/features/ai/lib/chat/create-chat";
import { createChatSchema } from "@/ee/features/ai/schemas/chat";
import { authOptions } from "@/lib/auth/auth-options";
import { getServerSession } from "next-auth";
import { z } from "zod";

import { verifyDataroomSession } from "@/lib/auth/dataroom-auth";
import { getFeatureFlags } from "@/lib/featureFlags";
import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";

/**
 * POST /api/ai/chat
 * Create a new chat session
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const validation = createChatSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: validation.error },
        { status: 400 },
      );
    }

    const { documentId, dataroomId, linkId, viewId, title, viewerId } =
      validation.data;

    // Check for either internal user or external viewer authentication
    const session = await getServerSession(authOptions);

    let userId: string | undefined;
    let teamId: string;

    // Internal user flow
    if (session) {
      userId = (session.user as CustomUser).id;

      // Get team ID from document or dataroom
      if (dataroomId) {
        const dataroom = await prisma.dataroom.findUnique({
          where: { id: dataroomId },
          select: {
            teamId: true,
            agentsEnabled: true,
            vectorStoreId: true,
            team: {
              select: {
                agentsEnabled: true,
              },
            },
          },
        });

        if (!dataroom) {
          return NextResponse.json(
            { error: "Dataroom not found" },
            { status: 404 },
          );
        }

        // Check if team has AI enabled first
        if (!dataroom.team?.agentsEnabled) {
          return NextResponse.json(
            { error: "AI agents are not enabled for this team" },
            { status: 403 },
          );
        }

        if (!dataroom.agentsEnabled) {
          return NextResponse.json(
            { error: "AI agents are not enabled for this dataroom" },
            { status: 403 },
          );
        }

        teamId = dataroom.teamId;

        // Verify user is member of team
        const userTeam = await prisma.userTeam.findUnique({
          where: {
            userId_teamId: {
              userId,
              teamId,
            },
          },
        });

        if (!userTeam) {
          return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
      } else if (documentId) {
        const document = await prisma.document.findUnique({
          where: { id: documentId },
          select: {
            teamId: true,
            agentsEnabled: true,
            team: {
              select: {
                agentsEnabled: true,
              },
            },
          },
        });

        if (!document) {
          return NextResponse.json(
            { error: "Document not found" },
            { status: 404 },
          );
        }

        // Check if team has AI enabled first
        if (!document.team?.agentsEnabled) {
          return NextResponse.json(
            { error: "AI agents are not enabled for this team" },
            { status: 403 },
          );
        }

        if (!document.agentsEnabled) {
          return NextResponse.json(
            { error: "AI agents are not enabled for this document" },
            { status: 403 },
          );
        }

        teamId = document.teamId;

        // Verify user is member of team
        const userTeam = await prisma.userTeam.findUnique({
          where: {
            userId_teamId: {
              userId,
              teamId,
            },
          },
        });

        if (!userTeam) {
          return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
      } else {
        return NextResponse.json(
          { error: "Either documentId or dataroomId is required" },
          { status: 400 },
        );
      }
    }
    // External viewer flow
    else if (linkId && viewId && viewerId) {
      // Verify dataroom session if this is a dataroom link
      if (dataroomId) {
        const dataroomSession = await verifyDataroomSession(
          req,
          linkId,
          dataroomId,
        );

        if (!dataroomSession || dataroomSession.viewerId !== viewerId) {
          return NextResponse.json(
            { error: "Unauthorized - invalid session" },
            { status: 401 },
          );
        }

        // Verify link has AI enabled
        const link = await prisma.link.findUnique({
          where: { id: linkId, dataroomId },
          select: {
            enableAIAgents: true,
            isArchived: true,
            dataroom: { select: { teamId: true, agentsEnabled: true } },
            team: { select: { agentsEnabled: true } },
          },
        });

        if (!link) {
          return NextResponse.json(
            { error: "Link not found" },
            { status: 404 },
          );
        }

        if (link?.isArchived) {
          return NextResponse.json(
            { error: "Link is archived" },
            { status: 403 },
          );
        }

        if (!link?.enableAIAgents) {
          return NextResponse.json(
            { error: "AI agents are not enabled for this link" },
            { status: 403 },
          );
        }

        if (!link?.dataroom) {
          return NextResponse.json(
            { error: "Dataroom not found" },
            { status: 404 },
          );
        }

        if (!link?.dataroom?.agentsEnabled) {
          return NextResponse.json(
            { error: "AI agents are not enabled for this dataroom" },
            { status: 403 },
          );
        }

        if (!link?.team?.agentsEnabled) {
          return NextResponse.json(
            { error: "AI agents are not enabled" },
            { status: 403 },
          );
        }

        teamId = link?.dataroom?.teamId;
      } else if (documentId) {
        // Verify link access for document
        const link = await prisma.link.findUnique({
          where: { id: linkId, documentId },
          select: {
            enableAIAgents: true,
            isArchived: true,
            document: { select: { teamId: true, agentsEnabled: true } },
            team: { select: { agentsEnabled: true } },
          },
        });

        if (!link) {
          return NextResponse.json(
            { error: "Link not found" },
            { status: 404 },
          );
        }

        if (link?.isArchived) {
          return NextResponse.json(
            { error: "Link is archived" },
            { status: 403 },
          );
        }

        // Check if link has AI enabled
        if (!link.enableAIAgents) {
          return NextResponse.json(
            { error: "AI agents are not enabled for this link" },
            { status: 403 },
          );
        }

        if (!link.document?.agentsEnabled) {
          return NextResponse.json(
            { error: "AI agents are not enabled for this document" },
            { status: 403 },
          );
        }

        if (!link?.team?.agentsEnabled) {
          return NextResponse.json(
            { error: "AI agents are not enabled" },
            { status: 403 },
          );
        }

        if (!link.document || !link.document?.teamId) {
          return NextResponse.json(
            { error: "Document not found" },
            { status: 400 },
          );
        }

        teamId = link.document?.teamId;
      } else {
        return NextResponse.json(
          { error: "Either documentId or dataroomId is required" },
          { status: 400 },
        );
      }

      // Verify viewer exists
      const viewer = await prisma.viewer.findUnique({
        where: { id: viewerId, teamId },
      });

      if (!viewer) {
        return NextResponse.json(
          { error: "Viewer not found" },
          { status: 404 },
        );
      }
    } else {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 },
      );
    }

    // Check if AI feature is enabled for this team
    const features = await getFeatureFlags({ teamId });
    if (!features.ai) {
      return NextResponse.json(
        { error: "AI features are not available for this team" },
        { status: 403 },
      );
    }

    // Get vector store ID
    let vectorStoreId: string | undefined;

    if (dataroomId) {
      const dataroom = await prisma.dataroom.findUnique({
        where: { id: dataroomId },
        select: { vectorStoreId: true },
      });
      vectorStoreId = dataroom?.vectorStoreId || undefined;
    } else if (documentId) {
      const team = await prisma.team.findUnique({
        where: { id: teamId },
        select: { vectorStoreId: true },
      });
      vectorStoreId = team?.vectorStoreId || undefined;
    }

    // Create the chat
    const chat = await createChat({
      teamId,
      documentId,
      dataroomId,
      linkId,
      viewId,
      userId,
      viewerId,
      vectorStoreId,
      title,
    });

    return NextResponse.json(chat, { status: 201 });
  } catch (error) {
    console.error("Error creating chat:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

/**
 * GET /api/ai/chat
 * List chats with filters
 * Supports both internal users (via session) and external viewers (via viewerId param)
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const searchParams = req.nextUrl.searchParams;

    const chatListQuerySchema = z.object({
      viewerId: z.string().cuid().optional(),
      teamId: z.string().cuid().optional(),
      documentId: z.string().cuid().optional(),
      dataroomId: z.string().cuid().optional(),
      linkId: z.string().cuid().optional(),
      viewId: z.string().cuid().optional(),
    });

    const queryObj = {
      viewerId: searchParams.get("viewerId") ?? undefined,
      teamId: searchParams.get("teamId") ?? undefined,
      documentId: searchParams.get("documentId") ?? undefined,
      dataroomId: searchParams.get("dataroomId") ?? undefined,
      linkId: searchParams.get("linkId") ?? undefined,
      viewId: searchParams.get("viewId") ?? undefined,
    };

    const { viewerId, teamId, documentId, dataroomId, linkId, viewId } =
      chatListQuerySchema.parse(queryObj);

    // Combined flow: logged-in user with viewerId
    // This handles the case where a team member is also viewing as a viewer
    if (session && viewerId && (dataroomId || documentId)) {
      const userId = (session.user as CustomUser).id;

      // Verify viewer exists
      const viewer = await prisma.viewer.findUnique({
        where: { id: viewerId },
        select: {
          teamId: true,
        },
      });

      if (!viewer) {
        return NextResponse.json(
          { error: "Viewer not found" },
          { status: 404 },
        );
      }

      // Verify user is member of team that the viewer is associated with
      const userTeam = await prisma.userTeam.findUnique({
        where: {
          userId_teamId: {
            userId,
            teamId: viewer.teamId,
          },
        },
      });

      if (!userTeam) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      // Check if AI feature is enabled for this team
      const features = await getFeatureFlags({ teamId: viewer.teamId });
      if (!features.ai) {
        return NextResponse.json(
          { error: "AI features are not available for this team" },
          { status: 403 },
        );
      }

      // Build where clause - find chats with this userId OR viewerId
      const baseWhere: any = {};

      if (documentId) {
        baseWhere.documentId = documentId;
      }

      if (dataroomId) {
        baseWhere.dataroomId = dataroomId;
      }

      if (linkId) {
        baseWhere.linkId = linkId;
      }

      // Fetch chats that belong to either userId or viewerId
      const chats = await prisma.chat.findMany({
        where: {
          ...baseWhere,
          OR: [{ userId }, { viewerId }],
        },
        orderBy: {
          createdAt: "desc",
        },
        take: 50,
      });

      return NextResponse.json(chats);
    }

    // External viewer flow (not logged in)
    if (viewerId && linkId && viewId) {
      // Build where clause for viewer's chats
      const where: any = {
        viewerId,
        linkId,
      };

      if (dataroomId) {
        // verify dataroom session
        const dataroomSession = await verifyDataroomSession(
          req,
          linkId,
          dataroomId,
        );

        if (!dataroomSession || dataroomSession.viewerId !== viewerId) {
          return NextResponse.json(
            { error: "Unauthorized - invalid session" },
            { status: 401 },
          );
        }

        where.dataroomId = dataroomId;
      }

      if (documentId) {
        // verify document session
        const view = await prisma.view.findUnique({
          where: { id: viewId, linkId, documentId },
          select: {
            viewerId: true,
          },
        });

        if (!view || view.viewerId !== viewerId) {
          return NextResponse.json(
            { error: "Unauthorized - invalid session" },
            { status: 401 },
          );
        }

        where.documentId = documentId;
      }

      // Fetch viewer's chats
      const chats = await prisma.chat.findMany({
        where,
        orderBy: {
          createdAt: "desc",
        },
        take: 50,
        select: {
          id: true,
          title: true,
          createdAt: true,
          lastMessageAt: true,
        },
      });

      return NextResponse.json(chats);
    }

    // Internal user flow (logged in, no viewerId)
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = (session.user as CustomUser).id;

    if (!teamId) {
      return NextResponse.json(
        { error: "teamId is required" },
        { status: 400 },
      );
    }

    // Verify user is member of team
    const userTeam = await prisma.userTeam.findUnique({
      where: {
        userId_teamId: {
          userId,
          teamId,
        },
      },
    });

    if (!userTeam) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if AI feature is enabled for this team
    const features = await getFeatureFlags({ teamId });
    if (!features.ai) {
      return NextResponse.json(
        { error: "AI features are not available for this team" },
        { status: 403 },
      );
    }

    // Build where clause
    const where: any = {
      teamId,
      userId, // Only show user's own chats
    };

    if (documentId) {
      where.documentId = documentId;
    }

    if (dataroomId) {
      where.dataroomId = dataroomId;
    }

    // Fetch chats
    const chats = await prisma.chat.findMany({
      where,
      orderBy: {
        createdAt: "desc",
      },
      take: 50,
    });

    return NextResponse.json(chats);
  } catch (error) {
    console.error("Error fetching chats:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
