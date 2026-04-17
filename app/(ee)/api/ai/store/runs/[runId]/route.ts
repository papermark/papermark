import { NextRequest, NextResponse } from "next/server";

import { authOptions } from "@/lib/auth/auth-options";
import { runs } from "@trigger.dev/sdk";
import { getServerSession } from "next-auth";

import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";

/**
 * GET /api/ai/store/runs/[runId]
 * Get the status of a Trigger.dev run for polling
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { runId: string } },
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { runId } = params;

    const run = await runs.retrieve(runId);

    // Verify the user is authorized to access this run
    const runTeamId = run.metadata?.teamId as string | undefined;
    const userTeams = await prisma.userTeam.findMany({
      where: { userId: (session.user as CustomUser).id },
      select: { teamId: true },
    });
    const userTeamIds = userTeams.map((ut) => ut.teamId);

    if (!runTeamId || !userTeamIds.includes(runTeamId)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    return NextResponse.json({
      id: run.id,
      status: run.status,
      metadata: run.metadata,
      isCompleted: run.isCompleted,
      isFailed: run.isFailed,
      output: run.output,
    });
  } catch (error) {
    console.error("Error retrieving run status:", error);
    return NextResponse.json(
      { error: "Failed to retrieve run status" },
      { status: 500 },
    );
  }
}
