import { NextRequest, NextResponse } from "next/server";

import { getVectorStoreInfo } from "@/ee/features/ai/lib/vector-stores/get-vector-store-info";
import { authOptions } from "@/lib/auth/auth-options";
import { getServerSession } from "next-auth";

import { getFeatureFlags } from "@/lib/featureFlags";
import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";

/**
 * GET /api/ai/store/teams/[teamId]
 * Get team vector store information
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { teamId: string } },
) {
  try {
    const { teamId } = params;
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = (session.user as CustomUser).id;

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

    // Get team with vector store ID
    const team = await prisma.team.findUnique({
      where: { id: teamId },
      select: {
        vectorStoreId: true,
        agentsEnabled: true,
      },
    });

    if (!team) {
      return NextResponse.json({ error: "Team not found" }, { status: 404 });
    }

    if (!team.vectorStoreId) {
      return NextResponse.json({
        agentsEnabled: team.agentsEnabled,
        vectorStoreId: null,
        info: null,
      });
    }

    // Get vector store info
    const info = await getVectorStoreInfo(team.vectorStoreId);

    return NextResponse.json({
      agentsEnabled: team.agentsEnabled,
      vectorStoreId: team.vectorStoreId,
      info,
    });
  } catch (error) {
    console.error("Error fetching team vector store info:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
