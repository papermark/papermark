import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/auth-options";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";

// GET /app/(ee)/api/workflows/[workflowId]/executions?teamId=xxx - List workflow executions
export async function GET(
  req: NextRequest,
  { params }: { params: { workflowId: string } },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { workflowId } = params;
    const searchParams = req.nextUrl.searchParams;
    const teamId = searchParams.get("teamId");

    if (!teamId) {
      return NextResponse.json(
        { error: "teamId parameter is required" },
        { status: 400 },
      );
    }

    // Parse and validate pagination parameters
    const rawPage = Number.parseInt(searchParams.get("page") || "1", 10);
    const rawLimit = Number.parseInt(searchParams.get("limit") || "20", 10);

    // Apply defaults for invalid values and enforce constraints
    const page = Number.isNaN(rawPage) || rawPage < 1 ? 1 : rawPage;
    const limit = Number.isNaN(rawLimit) || rawLimit < 1 
      ? 20 
      : Math.min(Math.max(rawLimit, 1), 100); // Min 1, Max 100
    const skip = (page - 1) * limit;

    // Validate IDs format
    const idsValidation = z.object({
      workflowId: z.string().cuid(),
      teamId: z.string().cuid(),
    }).safeParse({ workflowId, teamId });

    if (!idsValidation.success) {
      return NextResponse.json(
        { error: "Invalid ID format" },
        { status: 400 },
      );
    }

    const userId = (session.user as CustomUser).id;

    // Check user is part of the team using userTeam table
    const teamAccess = await prisma.userTeam.findUnique({
      where: {
        userId_teamId: {
          userId: userId,
          teamId: teamId,
        },
      },
    });

    if (!teamAccess) {
      return NextResponse.json(
        { error: "Unauthorized to access this team" },
        { status: 403 },
      );
    }

    // Check workflow exists and belongs to team
    const workflow = await prisma.workflow.findUnique({
      where: {
        id: workflowId,
        teamId: teamId,
      },
      select: {
        id: true,
      },
    });

    if (!workflow) {
      return NextResponse.json(
        { error: "Workflow not found" },
        { status: 404 },
      );
    }

    // Fetch executions with pagination
    const [executions, totalCount] = await Promise.all([
      prisma.workflowExecution.findMany({
        where: { workflowId },
        include: {
          stepLogs: {
            select: {
              id: true,
              workflowStepId: true,
              conditionsMatched: true,
              executedAt: true,
              duration: true,
              error: true,
            },
            orderBy: { executedAt: "asc" },
          },
        },
        orderBy: { startedAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.workflowExecution.count({
        where: { workflowId },
      }),
    ]);

    return NextResponse.json({
      executions,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
      },
    });
  } catch (error) {
    console.error("Error fetching workflow executions:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

