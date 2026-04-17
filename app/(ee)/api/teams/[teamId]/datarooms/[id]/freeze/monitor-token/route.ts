import { NextRequest, NextResponse } from "next/server";

import { runs } from "@trigger.dev/sdk";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth/auth-options";

import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";
import { generateTriggerPublicAccessToken } from "@/lib/utils/generate-trigger-auth-token";

export async function GET(
  _request: NextRequest,
  { params }: { params: { teamId: string; id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { teamId, id: dataroomId } = params;
  const userId = (session.user as CustomUser).id;

  try {
    const teamAccess = await prisma.userTeam.findUnique({
      where: { userId_teamId: { userId, teamId } },
      select: { role: true },
    });

    if (!teamAccess) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const dataroom = await prisma.dataroom.findUnique({
      where: { id: dataroomId, teamId },
      select: {
        isFrozen: true,
        frozenAt: true,
        freezeArchiveUrl: true,
      },
    });

    if (!dataroom) {
      return NextResponse.json(
        { error: "Dataroom not found" },
        { status: 404 },
      );
    }

    if (!dataroom.isFrozen || dataroom.freezeArchiveUrl || !dataroom.frozenAt) {
      return NextResponse.json(
        { error: "No active freeze archive generation in progress" },
        { status: 400 },
      );
    }

    const tag = `freeze:${dataroomId}:${dataroom.frozenAt.getTime()}`;

    let hasRuns = false;
    try {
      const result = await runs.list({
        tag: [tag],
        taskIdentifier: ["dataroom-freeze-archive"],
        limit: 1,
      });
      hasRuns = result.data.length > 0;
    } catch (err) {
      console.error("Failed to list freeze runs", err);
    }

    const publicAccessToken = await generateTriggerPublicAccessToken(tag);

    return NextResponse.json({ publicAccessToken, hasRuns });
  } catch (error) {
    console.error("Error generating freeze monitor token:", error);
    return NextResponse.json(
      { message: "Internal Server Error" },
      { status: 500 },
    );
  }
}
