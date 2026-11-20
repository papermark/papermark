import { NextRequest, NextResponse } from "next/server";

import {
  UpdateWorkflowRequestSchema,
  formatZodError,
} from "@/ee/features/workflows/lib/validation";
import { authOptions } from "@/lib/auth/auth-options";
import { customAlphabet } from "nanoid";
import { getServerSession } from "next-auth";
import { z } from "zod";

import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";

// GET /app/(ee)/api/workflows/[workflowId]?teamId=xxx - Get single workflow with details
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

    // Validate IDs format
    const idsValidation = z
      .object({
        workflowId: z.string().cuid(),
        teamId: z.string().cuid(),
      })
      .safeParse({ workflowId, teamId });

    if (!idsValidation.success) {
      return NextResponse.json({ error: "Invalid ID format" }, { status: 400 });
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

    // Fetch workflow
    const workflow = await prisma.workflow.findUnique({
      where: {
        id: workflowId,
        teamId: teamId, // Ensure workflow belongs to the team
      },
      include: {
        entryLink: {
          select: {
            id: true,
            slug: true,
            domainSlug: true,
          },
        },
        steps: {
          orderBy: { stepOrder: "asc" },
        },
      },
    });

    if (!workflow) {
      return NextResponse.json(
        { error: "Workflow not found" },
        { status: 404 },
      );
    }

    // Build entry URL
    const entryUrl =
      workflow.entryLink.domainSlug && workflow.entryLink.slug
        ? `https://${workflow.entryLink.domainSlug}/${workflow.entryLink.slug}`
        : `${process.env.NEXT_PUBLIC_MARKETING_URL}/view/${workflow.entryLink.id}`;

    return NextResponse.json({
      ...workflow,
      entryUrl,
    });
  } catch (error) {
    console.error("Error fetching workflow:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// PATCH /app/(ee)/api/workflows/[workflowId]?teamId=xxx - Update workflow
export async function PATCH(
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

    // Validate IDs format
    const idsValidation = z
      .object({
        workflowId: z.string().cuid(),
        teamId: z.string().cuid(),
      })
      .safeParse({ workflowId, teamId });

    if (!idsValidation.success) {
      return NextResponse.json({ error: "Invalid ID format" }, { status: 400 });
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

    const body = await req.json();

    // Validate request body
    const validation = UpdateWorkflowRequestSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        {
          error: "Invalid request data",
          details: formatZodError(validation.error),
        },
        { status: 400 },
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

    // Update workflow
    const updatedWorkflow = await prisma.workflow.update({
      where: { id: workflowId },
      data: validation.data,
      include: {
        entryLink: {
          select: {
            id: true,
            slug: true,
            domainSlug: true,
          },
        },
      },
    });

    return NextResponse.json(updatedWorkflow);
  } catch (error) {
    console.error("Error updating workflow:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// DELETE /app/(ee)/api/workflows/[workflowId]?teamId=xxx - Delete workflow
export async function DELETE(
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

    // Validate IDs format
    const idsValidation = z
      .object({
        workflowId: z.string().cuid(),
        teamId: z.string().cuid(),
      })
      .safeParse({ workflowId, teamId });

    if (!idsValidation.success) {
      return NextResponse.json({ error: "Invalid ID format" }, { status: 400 });
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

    // Fetch workflow to check existence and get entryLinkId
    const workflow = await prisma.workflow.findUnique({
      where: {
        id: workflowId,
        teamId: teamId,
      },
      select: {
        id: true,
        entryLinkId: true,
        entryLink: {
          select: {
            slug: true,
          },
        },
      },
    });

    if (!workflow) {
      return NextResponse.json(
        { error: "Workflow not found" },
        { status: 404 },
      );
    }

    // Generate a random suffix for the deleted slug to free up the original slug
    const generateDeletedSuffix = customAlphabet(
      "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
      6,
    );

    // Delete workflow and entry link in transaction
    // Note: Steps and executions will cascade delete via Prisma relations
    await prisma.$transaction([
      // Delete workflow first (cascade deletes steps and executions)
      prisma.workflow.delete({
        where: { id: workflowId },
      }),
      // Soft delete entry link and rename slug so it can be reused
      prisma.link.update({
        where: { id: workflow.entryLinkId },
        data: {
          deletedAt: new Date(),
          isArchived: true,
          ...(workflow.entryLink?.slug && {
            slug: `${workflow.entryLink.slug}-DELETED-${generateDeletedSuffix()}`,
          }),
        },
      }),
    ]);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting workflow:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
