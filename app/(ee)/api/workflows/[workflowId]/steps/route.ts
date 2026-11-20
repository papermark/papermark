import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/auth-options";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { CustomUser } from "@/lib/types";
import {
  CreateWorkflowStepRequestSchema,
  ReorderStepsRequestSchema,
  formatZodError,
  validateConditions,
  validateActions,
} from "@/ee/features/workflows/lib/validation";
import { ReorderStepsRequest } from "@/ee/features/workflows/lib/types";

// GET /app/(ee)/api/workflows/[workflowId]/steps?teamId=xxx - List all steps
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

    // Fetch steps
    const steps = await prisma.workflowStep.findMany({
      where: { workflowId },
      orderBy: { stepOrder: "asc" },
    });

    // Enrich steps with target link details
    const enrichedSteps = await Promise.all(
      steps.map(async (step) => {
        const actions = step.actions as any[];
        const routeAction = actions.find((a) => a.type === "route");

        if (routeAction && routeAction.targetLinkId) {
          const targetLink = await prisma.link.findUnique({
            where: { id: routeAction.targetLinkId },
            select: {
              id: true,
              name: true,
              slug: true,
              domainSlug: true,
              linkType: true,
            },
          });

          return {
            ...step,
            targetLink,
          };
        }

        return step;
      }),
    );

    return NextResponse.json(enrichedSteps);
  } catch (error) {
    console.error("Error fetching workflow steps:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// POST /app/(ee)/api/workflows/[workflowId]/steps?teamId=xxx - Create a new step
export async function POST(
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

    const body = await req.json();

    // Validate request body
    const validation = CreateWorkflowStepRequestSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        {
          error: "Invalid request data",
          details: formatZodError(validation.error),
        },
        { status: 400 },
      );
    }

    const { name, conditions, actions } = validation.data;

    // Validate conditions and actions
    const conditionsValidation = validateConditions(conditions);
    if (!conditionsValidation.valid) {
      return NextResponse.json(
        { error: conditionsValidation.error },
        { status: 400 },
      );
    }

    const actionsValidation = validateActions(actions);
    if (!actionsValidation.valid) {
      return NextResponse.json(
        { error: actionsValidation.error },
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
        teamId: true,
        steps: {
          select: { stepOrder: true },
          orderBy: { stepOrder: "desc" },
          take: 1,
        },
      },
    });

    if (!workflow) {
      return NextResponse.json(
        { error: "Workflow not found" },
        { status: 404 },
      );
    }

    // Validate target link exists and belongs to the team
    // Use actionsValidation.data so enrichment persists
    const routeAction = actionsValidation.data.find((a) => a.type === "route");
    if (routeAction && routeAction.targetLinkId) {
      const targetLink = await prisma.link.findUnique({
        where: {
          id: routeAction.targetLinkId,
          teamId: workflow.teamId,
        },
      });

      if (!targetLink) {
        return NextResponse.json(
          { error: "Target link not found or not accessible" },
          { status: 400 },
        );
      }

      // Update action with target details (mutates actionsValidation.data)
      if (targetLink.linkType === "DOCUMENT_LINK" && targetLink.documentId) {
        routeAction.targetDocumentId = targetLink.documentId;
      } else if (
        targetLink.linkType === "DATAROOM_LINK" &&
        targetLink.dataroomId
      ) {
        routeAction.targetDataroomId = targetLink.dataroomId;
      }
    }

    // Calculate next step order
    const maxStepOrder = workflow.steps[0]?.stepOrder ?? -1;
    const nextStepOrder = maxStepOrder + 1;

    // Extract emails and domains from conditions to sync with link allowList
    const allowListItems: string[] = [];
    if (conditionsValidation.data.items) {
      conditionsValidation.data.items.forEach((condition: any) => {
        const values = Array.isArray(condition.value)
          ? condition.value
          : [condition.value];
        if (condition.type === "domain") {
          // Add @ prefix for domains in allowList
          allowListItems.push(...values.map((v: string) => `@${v}`));
        } else if (condition.type === "email") {
          allowListItems.push(...values);
        }
      });
    }

    // Create step and conditionally update target link's allowList in transaction
    const transactionSteps: any[] = [
      prisma.workflowStep.create({
        data: {
          workflowId,
          name,
          stepOrder: nextStepOrder,
          stepType: "ROUTER",
          conditions: conditionsValidation.data as any,
          actions: actionsValidation.data as any,
        },
      }),
    ];

    // Only update link allowList if we have a route action with a target link
    if (routeAction && routeAction.targetLinkId) {
      transactionSteps.push(
        prisma.link.update({
          where: { id: routeAction.targetLinkId },
          data: {
            allowList: allowListItems,
          },
        }),
      );
    }

    const [newStep] = await prisma.$transaction(transactionSteps);

    return NextResponse.json(newStep, { status: 201 });
  } catch (error) {
    console.error("Error creating workflow step:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// PUT /app/(ee)/api/workflows/[workflowId]/steps?teamId=xxx - Reorder steps
export async function PUT(
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

    const body = await req.json();

    // Validate request body
    const validation = ReorderStepsRequestSchema.safeParse(body);
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

    // Update step orders in a transaction
    await prisma.$transaction(
      validation.data.steps.map((step) =>
        prisma.workflowStep.update({
          where: {
            id: step.stepId,
            workflowId, // Ensure step belongs to this workflow
          },
          data: {
            stepOrder: step.stepOrder,
          },
        }),
      ),
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error reordering workflow steps:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

