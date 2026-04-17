import { NextRequest, NextResponse } from "next/server";

import {
  CreateWorkflowRequestSchema,
  formatZodError,
} from "@/ee/features/workflows/lib/validation";
import { authOptions } from "@/lib/auth/auth-options";
import { getServerSession } from "next-auth";
import { z } from "zod";

import { getFeatureFlags } from "@/lib/featureFlags";
import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";

// GET /app/(ee)/api/workflows?teamId=xxx - List all workflows for a team
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const searchParams = req.nextUrl.searchParams;
    const teamId = searchParams.get("teamId");

    if (!teamId) {
      return NextResponse.json(
        { error: "teamId parameter is required" },
        { status: 400 },
      );
    }

    // Validate teamId format
    const teamIdValidation = z.string().cuid().safeParse(teamId);
    if (!teamIdValidation.success) {
      return NextResponse.json(
        { error: "Invalid teamId format" },
        { status: 400 },
      );
    }

    // Check user is part of the team
    const teamAccess = await prisma.userTeam.findUnique({
      where: {
        userId_teamId: {
          userId: (session.user as CustomUser).id,
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

    // Fetch workflows with entry link and step count
    const workflows = await prisma.workflow.findMany({
      where: { teamId },
      include: {
        entryLink: {
          select: {
            id: true,
            slug: true,
            domainSlug: true,
          },
        },
        _count: {
          select: {
            steps: true,
            executions: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(workflows);
  } catch (error) {
    console.error("Error fetching workflows:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// POST /app/(ee)/api/workflows?teamId=xxx - Create a new workflow
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = (session.user as CustomUser).id;
    const searchParams = req.nextUrl.searchParams;
    const teamId = searchParams.get("teamId");

    if (!teamId) {
      return NextResponse.json(
        { error: "teamId parameter is required" },
        { status: 400 },
      );
    }

    // Validate teamId format
    const teamIdValidation = z.string().cuid().safeParse(teamId);
    if (!teamIdValidation.success) {
      return NextResponse.json(
        { error: "Invalid teamId format" },
        { status: 400 },
      );
    }

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
    const validation = CreateWorkflowRequestSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        {
          error: "Invalid request data",
          details: formatZodError(validation.error),
        },
        { status: 400 },
      );
    }

    const { name, description, domain, slug } = validation.data;

    // Get team details for plan check
    const team = await prisma.team.findUnique({
      where: { id: teamId },
      select: {
        id: true,
        plan: true,
      },
    });

    if (!team) {
      return NextResponse.json({ error: "Team not found" }, { status: 404 });
    }

    // Check if workflows feature flag is enabled
    const featureFlags = await getFeatureFlags({ teamId });
    if (!featureFlags.workflows) {
      return NextResponse.json(
        { error: "This feature is not available for your team" },
        { status: 403 },
      );
    }

    // Check plan - require Business or DataRooms plan
    if (team.plan === "free" || team.plan === "pro") {
      return NextResponse.json(
        {
          error: "Workflows require a Business or Data Rooms plan",
          requiresUpgrade: true,
        },
        { status: 403 },
      );
    }

    // Validate domain and slug
    let domainId: string | null = null;
    let domainSlug: string | null = null;

    if (domain && slug) {
      // Check if domain exists and belongs to team
      const domainRecord = await prisma.domain.findUnique({
        where: {
          slug: domain,
          teamId: teamId,
        },
        select: { id: true, slug: true },
      });

      if (!domainRecord) {
        return NextResponse.json(
          { error: "Domain not found or not associated with this team" },
          { status: 400 },
        );
      }

      domainId = domainRecord.id;
      domainSlug = domainRecord.slug;

      // Check if slug is already in use on this domain
      const existingLink = await prisma.link.findUnique({
        where: {
          domainSlug_slug: {
            slug: slug,
            domainSlug: domain,
          },
        },
      });

      if (existingLink) {
        return NextResponse.json(
          { error: "This slug is already in use on the selected domain" },
          { status: 400 },
        );
      }
    }

    // Create workflow with entry link in a transaction
    const workflow = await prisma.$transaction(async (tx) => {
      // Create entry link
      const entryLink = await tx.link.create({
        data: {
          linkType: "WORKFLOW_LINK",
          teamId,
          ownerId: userId,
          name: `${name} - Entry Link`,
          slug: slug || null,
          domainId: domainId,
          domainSlug: domainSlug,
          emailProtected: true, // Workflows always require email
          emailAuthenticated: true, // Workflows always require OTP
          allowDownload: false,
          enableNotification: false,
        },
      });

      // Create workflow
      const newWorkflow = await tx.workflow.create({
        data: {
          name,
          description,
          teamId,
          entryLinkId: entryLink.id,
          isActive: true,
        },
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

      return newWorkflow;
    });

    // Build entry URL
    const entryUrl =
      workflow.entryLink.domainSlug && workflow.entryLink.slug
        ? `https://${workflow.entryLink.domainSlug}/${workflow.entryLink.slug}`
        : `${process.env.NEXT_PUBLIC_MARKETING_URL}/view/${workflow.entryLink.id}`;

    return NextResponse.json(
      {
        ...workflow,
        entryUrl,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Error creating workflow:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
